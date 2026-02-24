/**
 * Command Handlers — thin CLI delegation layer.
 *
 * Commands:
 *   - aspectcode.setup          → opens terminal with `aspectcode init`
 *   - aspectcode.generate       → runs `aspectcode generate` via CLI
 *   - aspectcode.optimize       → runs `aspectcode optimize` via CLI
 *   - aspectcode.toggleExtensionEnabled → stops/starts watch daemon
 */

import * as vscode from 'vscode';
import {
  cliGenerate,
  cliOptimize,
  cliInit,
} from './services/CliAdapter';
import {
  getExtensionEnabledSetting,
  setExtensionEnabledSetting,
} from './services/aspectSettings';

export interface DaemonState {
  running: boolean;
  statusBarState: string;
}

/**
 * Activate commands.
 * Called from the main extension activate function.
 */
export function activateCommands(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  onStatusBarUpdate?: () => Promise<void>,
): void {
  const getWorkspaceRoot = (): vscode.Uri | undefined =>
    vscode.workspace.workspaceFolders?.[0]?.uri;

  // ── Register commands ─────────────────────────────────────────────────

  context.subscriptions.push(
    // ── Setup (interactive init in terminal) ──────────────────────────
    vscode.commands.registerCommand('aspectcode.setup', () => {
      const root = getWorkspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }
      cliInit(root.fsPath, { outputChannel });
    }),

    // ── Toggle enabled ───────────────────────────────────────────────
    vscode.commands.registerCommand('aspectcode.toggleExtensionEnabled', async () => {
      const root = getWorkspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const enabled = await getExtensionEnabledSetting(root);
      const nextEnabled = !enabled;

      await setExtensionEnabledSetting(root, nextEnabled, { createIfMissing: false });

      if (nextEnabled) {
        // Restart daemon
        const { restartDaemon } = await import('./extension');
        restartDaemon(root.fsPath);
      } else {
        // Stop daemon
        const { stopDaemon } = await import('./extension');
        stopDaemon();
      }

      vscode.window.showInformationMessage(
        nextEnabled ? 'Aspect Code enabled' : 'Aspect Code disabled',
      );
      void onStatusBarUpdate?.();
    }),

    // ── Generate ─────────────────────────────────────────────────────
    vscode.commands.registerCommand('aspectcode.generate', async () => {
      const root = getWorkspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Aspect Code: Generating…',
          cancellable: true,
        },
        async (_progress, token) => {
          const result = await cliGenerate(root.fsPath, {
            outputChannel,
            token,
            extraArgs: ['--detect-tools'],
          });

          if (result.exitCode === 0 && result.data) {
            vscode.window.showInformationMessage(
              `Aspect Code: wrote ${result.data.wrote.length} file(s)`,
            );
          } else {
            const msg = result.stderr || `CLI exited with code ${result.exitCode}`;
            vscode.window.showErrorMessage(`Generate failed: ${msg}`);
          }
        },
      );

      void onStatusBarUpdate?.();
    }),

    // ── Optimize ─────────────────────────────────────────────────────
    vscode.commands.registerCommand('aspectcode.optimize', async () => {
      const root = getWorkspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      // Pre-flight: check AGENTS.md exists
      const agentsUri = vscode.Uri.joinPath(root, 'AGENTS.md');
      try {
        await vscode.workspace.fs.stat(agentsUri);
      } catch {
        const action = await vscode.window.showWarningMessage(
          'AGENTS.md not found. Run Generate first to create it.',
          'Generate Now',
        );
        if (action === 'Generate Now') {
          await vscode.commands.executeCommand('aspectcode.generate');
        }
        return;
      }

      // Pre-flight: check API key
      const envUri = vscode.Uri.joinPath(root, '.env');
      let hasApiKey = false;
      try {
        const envContent = Buffer.from(
          await vscode.workspace.fs.readFile(envUri),
        ).toString('utf8');
        hasApiKey =
          envContent.includes('OPENAI_API_KEY=') ||
          envContent.includes('ANTHROPIC_API_KEY=');
      } catch {
        // .env doesn't exist
      }

      if (!hasApiKey) {
        const action = await vscode.window.showWarningMessage(
          'No LLM API key found. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to a .env file.',
          'Set Up API Key',
        );
        if (action === 'Set Up API Key') {
          await promptAndSaveApiKey(root, envUri, outputChannel);
        }
        return;
      }

      // Read optimize settings from VS Code config
      const vsConfig = vscode.workspace.getConfiguration('aspectcode.optimize');
      const maxIterations = vsConfig.get<number>('maxIterations');
      const provider = vsConfig.get<string>('provider');
      const model = vsConfig.get<string>('model');
      const acceptThreshold = vsConfig.get<number>('acceptThreshold');

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Aspect Code: Optimizing instructions…',
          cancellable: true,
        },
        async (progress, token) => {
          outputChannel.appendLine('[Optimize] Starting LLM optimization…');
          progress.report({ message: 'Connecting to LLM provider…' });

          const result = await cliOptimize(root.fsPath, {
            outputChannel,
            token,
            maxIterations,
            provider,
            model,
            acceptThreshold,
          });

          if (result.exitCode === 0 && result.data) {
            const { iterations, elapsedMs } = result.data;
            const seconds = ((elapsedMs ?? 0) / 1000).toFixed(1);
            vscode.window.showInformationMessage(
              `Instructions optimized (${iterations} iteration${iterations === 1 ? '' : 's'}, ${seconds}s)`,
            );
          } else {
            const errMsg = result.stderr || 'Unknown error';
            vscode.window.showErrorMessage(`Optimize failed: ${errMsg}`);
          }
        },
      );
    }),
  );

  // ── File watchers ─────────────────────────────────────────────────────
  // Watch AGENTS.md and .aspect/ for deletions → update status bar
  const aspectWatcher = vscode.workspace.createFileSystemWatcher('**/.aspect{,/**}');
  aspectWatcher.onDidCreate(() => void onStatusBarUpdate?.());
  aspectWatcher.onDidDelete(() => void onStatusBarUpdate?.());
  context.subscriptions.push(aspectWatcher);

  const agentsWatcher = vscode.workspace.createFileSystemWatcher('**/AGENTS.md');
  agentsWatcher.onDidCreate(() => void onStatusBarUpdate?.());
  agentsWatcher.onDidDelete(() => void onStatusBarUpdate?.());
  context.subscriptions.push(agentsWatcher);
}

// ============================================================================
// Helpers
// ============================================================================

async function promptAndSaveApiKey(
  root: vscode.Uri,
  envUri: vscode.Uri,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  const provider = await vscode.window.showQuickPick(
    ['OpenAI', 'Anthropic'],
    { placeHolder: 'Select your LLM provider' },
  );
  if (!provider) return;

  const keyName = provider === 'OpenAI' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  const key = await vscode.window.showInputBox({
    prompt: `Enter your ${provider} API key`,
    placeHolder: provider === 'OpenAI' ? 'sk-...' : 'sk-ant-...',
    password: true,
    ignoreFocusOut: true,
  });
  if (!key) return;

  let existingContent = '';
  try {
    existingContent = Buffer.from(
      await vscode.workspace.fs.readFile(envUri),
    ).toString('utf8');
  } catch {
    // File doesn't exist yet
  }

  const newContent = existingContent
    ? `${existingContent.trimEnd()}\n${keyName}=${key}\n`
    : `${keyName}=${key}\n`;
  await vscode.workspace.fs.writeFile(envUri, Buffer.from(newContent, 'utf8'));
  outputChannel.appendLine(`[Optimize] API key saved to .env`);
}
