/**
 * Command Handlers
 *
 * This module registers and handles all extension commands.
 * Commands: toggleExtensionEnabled, generate, optimize
 */

import * as vscode from 'vscode';
import { AspectCodeState } from './state';
import { detectAssistants } from './assistants/detection';
import { generateKnowledgeBase } from './assistants/kb';

import {
  getInstructionsModeSetting,
  getExtensionEnabledSetting,
  setExtensionEnabledSetting,
  setUpdateRateSetting,
} from './services/aspectSettings';
import { cancelAndResetAllInFlightWork } from './services/enablementCancellation';
import { cliGenerate, cliOptimize } from './services/CliAdapter';

/**
 * Activate commands and file watchers.
 * Called from the main extension activate function.
 *
 * @param onStatusBarUpdate callback to refresh the status bar after state changes
 */
export function activateCommands(
  context: vscode.ExtensionContext,
  state: AspectCodeState,
  outputChannel?: vscode.OutputChannel,
  onStatusBarUpdate?: () => Promise<void>,
): void {
  const channel = outputChannel ?? vscode.window.createOutputChannel('Aspect Code');

  const getWorkspaceRoot = (): vscode.Uri | undefined =>
    vscode.workspace.workspaceFolders?.[0]?.uri;

  const isExtensionEnabled = async (): Promise<boolean> => {
    const root = getWorkspaceRoot();
    if (!root) return true;
    try {
      return await getExtensionEnabledSetting(root);
    } catch {
      return true;
    }
  };

  const requireExtensionEnabled = async (): Promise<boolean> => {
    if (await isExtensionEnabled()) return true;
    void vscode.window.showInformationMessage('Aspect Code is disabled.', 'Enable').then((sel) => {
      if (sel === 'Enable')
        void vscode.commands.executeCommand('aspectcode.toggleExtensionEnabled');
    });
    return false;
  };

  // ── Register commands ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('aspectcode.toggleExtensionEnabled', async () => {
      const root = getWorkspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const enabled = await getExtensionEnabledSetting(root);
      const nextEnabled = !enabled;

      // Only persist if aspectcode.json already exists
      await setExtensionEnabledSetting(root, nextEnabled, { createIfMissing: false });

      if (!nextEnabled) {
        cancelAndResetAllInFlightWork();
        state.update({ busy: false, error: undefined });
      }

      vscode.window.showInformationMessage(
        nextEnabled ? 'Aspect Code enabled' : 'Aspect Code disabled',
      );
      void onStatusBarUpdate?.();
    }),

    vscode.commands.registerCommand('aspectcode.generate', async () => {
      if (!(await requireExtensionEnabled())) return;
      return await handleGenerate(state, channel, context, onStatusBarUpdate);
    }),

    vscode.commands.registerCommand('aspectcode.optimize', async () => {
      if (!(await requireExtensionEnabled())) return;
      return await handleOptimize(channel);
    }),
  );

  // ── Deletion notifications ────────────────────────────────────────────
  let lastNotificationTime = 0;
  const NOTIFICATION_DEBOUNCE_MS = 5000;
  const SUPPRESS_DELETED_NOTIFICATION_KEY = 'aspectcode.suppressDeletedNotification';

  const updateInstructionFilesStatus = async (showNotificationOnMissing: boolean = false) => {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return;

    const detected = await detectAssistants(workspaceRoot);
    const hasAspectKB = detected.has('aspectKB');
    const hasAgentsMd = detected.has('agentsMd');
    const setupComplete = hasAspectKB && hasAgentsMd;

    if (showNotificationOnMissing && !setupComplete) {
      const isSuppressed = context.workspaceState.get<boolean>(
        SUPPRESS_DELETED_NOTIFICATION_KEY,
        false,
      );
      if (isSuppressed) {
        channel.appendLine('[Watcher] Deleted notification suppressed for this workspace');
        return;
      }

      const now = Date.now();
      if (now - lastNotificationTime > NOTIFICATION_DEBOUNCE_MS) {
        lastNotificationTime = now;
        channel.appendLine(
          `[Watcher] Detected missing files: aspectKB=${hasAspectKB}, agentsMd=${hasAgentsMd}`,
        );
        const message = !hasAspectKB
          ? 'Aspect Code: Knowledge base (.aspect/) was deleted.'
          : 'Aspect Code: AI instruction files were deleted.';
        const action = await vscode.window.showWarningMessage(
          message + ' Regenerate to restore AI assistant context.',
          'Regenerate',
          "Don't Show Again",
        );
        if (action === 'Regenerate') {
          void vscode.commands.executeCommand('aspectcode.generate');
        } else if (action === "Don't Show Again") {
          await context.workspaceState.update(SUPPRESS_DELETED_NOTIFICATION_KEY, true);
          channel.appendLine('[Watcher] User suppressed deleted notification for this workspace');
        }
      }
    }
  };

  let instructionUpdateTimeout: NodeJS.Timeout | undefined;
  const debouncedInstructionUpdate = (showNotification: boolean = false) => {
    if (instructionUpdateTimeout) clearTimeout(instructionUpdateTimeout);
    instructionUpdateTimeout = setTimeout(() => {
      void updateInstructionFilesStatus(showNotification);
    }, 500);
  };

  // ── File Watchers ─────────────────────────────────────────────────────

  // .aspect/ folder and contents
  const aspectWatcher = vscode.workspace.createFileSystemWatcher('**/.aspect{,/**}');
  aspectWatcher.onDidCreate((uri) => {
    channel.appendLine(`[Watcher] .aspect created: ${uri.fsPath}`);
    debouncedInstructionUpdate(false);
    void onStatusBarUpdate?.();
  });
  aspectWatcher.onDidChange(async (uri) => {
    // When .aspect/instructions.md changes, regenerate AGENTS.md
    // so the custom content flows through.
    if (uri.fsPath.endsWith('instructions.md')) {
      const workspaceRoot = getWorkspaceRoot();
      if (workspaceRoot) {
        try {
          const mode = await getInstructionsModeSetting(workspaceRoot, channel);
          if (mode === 'custom') {
            channel.appendLine(
              '[Instructions] Custom instructions.md changed — regenerating AGENTS.md',
            );
            await cliGenerate(workspaceRoot.fsPath, { outputChannel: channel });
          }
        } catch {
          /* ignore */
        }
      }
    }
  });
  aspectWatcher.onDidDelete((uri) => {
    channel.appendLine(`[Watcher] .aspect deleted: ${uri.fsPath}`);
    debouncedInstructionUpdate(true);
    void onStatusBarUpdate?.();
  });
  context.subscriptions.push(aspectWatcher);

  // AGENTS.md watcher
  const instructionFilesWatcher = vscode.workspace.createFileSystemWatcher('**/AGENTS.md');
  instructionFilesWatcher.onDidCreate(() => debouncedInstructionUpdate(false));
  instructionFilesWatcher.onDidDelete(() => debouncedInstructionUpdate(true));
  context.subscriptions.push(instructionFilesWatcher);
}

// =====================================================================
// Command Implementations
// =====================================================================

/**
 * Unified generate command.
 * Generates KB files (if missing) and AGENTS.md.
 * Uses fully local analysis (tree-sitter + dependency analysis) — no server required.
 */
async function handleGenerate(
  state: AspectCodeState,
  outputChannel: vscode.OutputChannel,
  context?: vscode.ExtensionContext,
  onStatusBarUpdate?: () => Promise<void>,
): Promise<void> {
  try {
    const perfEnabled = vscode.workspace
      .getConfiguration()
      .get<boolean>('aspectcode.devLogs', false);
    const tStart = Date.now();
    if (perfEnabled) outputChannel.appendLine('[Perf][Generate][cmd] start');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    const workspaceRoot = workspaceFolders[0].uri;

    // Always ensure KB exists — generate if missing
    const aspectDir = vscode.Uri.joinPath(workspaceRoot, '.aspect');
    const architectureFile = vscode.Uri.joinPath(aspectDir, 'architecture.md');
    let needsKbGeneration = false;
    try {
      await vscode.workspace.fs.stat(architectureFile);
    } catch {
      needsKbGeneration = true;
    }

    if (needsKbGeneration) {
      outputChannel.appendLine('[Generate] KB files not found, generating...');
      await generateKnowledgeBase(workspaceRoot, state, outputChannel, context);
    }

    // Generate AGENTS.md via CLI (marker-based, idempotent)
    const tGen = Date.now();
    const cliResult = await cliGenerate(workspaceRoot.fsPath, { outputChannel });
    if (cliResult.exitCode === 0 && cliResult.data) {
      outputChannel.appendLine(
        `[Generate] CLI wrote ${cliResult.data.wrote.length} file(s)`,
      );
    } else {
      outputChannel.appendLine(
        `[Generate] CLI exited with code ${cliResult.exitCode}: ${cliResult.stderr ?? ''}`,
      );
    }
    if (perfEnabled) {
      outputChannel.appendLine(
        `[Perf][Generate][cmd] cliGenerate tookMs=${Date.now() - tGen}`,
      );
    }

    // Mark KB as fresh
    try {
      const { getWorkspaceFingerprint } = await import('./extension');
      const fingerprint = getWorkspaceFingerprint();
      if (fingerprint) {
        await fingerprint.markKbFresh();
        outputChannel.appendLine('[KB] Marked KB as fresh');
      }
    } catch (e) {
      outputChannel.appendLine(`[KB] Failed to mark KB fresh (non-critical): ${e}`);
    }

    // After first-ever generation, show update-rate prompt instead of the
    // generic success toast so VS Code doesn't stack two competing notifications.
    // workspaceState so each repo gets the prompt once (not global forever).
    const UPDATE_RATE_PROMPTED_KEY = 'aspectcode.updateRatePrompted';
    const isFirstGeneration =
      context !== undefined &&
      !context.workspaceState.get<boolean>(UPDATE_RATE_PROMPTED_KEY, false);

    if (isFirstGeneration) {
      await context.workspaceState.update(UPDATE_RATE_PROMPTED_KEY, true);
      outputChannel.appendLine('[Settings] First generation — showing update-rate prompt');

      const choice = await vscode.window.showInformationMessage(
        'Aspect Code generated! How should it stay up to date?',
        { modal: false },
        'On Change (recommended)',
        'On Idle',
        'Manual Only',
      );

      if (choice) {
        const modeMap: Record<string, 'onChange' | 'idle' | 'manual'> = {
          'On Change (recommended)': 'onChange',
          'On Idle': 'idle',
          'Manual Only': 'manual',
        };
        const mode = modeMap[choice] ?? 'onChange';
        await setUpdateRateSetting(workspaceRoot, mode);
        outputChannel.appendLine(`[Settings] User chose update rate: ${mode}`);
      }
    } else {
      vscode.window.showInformationMessage('Aspect Code updated.');
    }

    void onStatusBarUpdate?.();

    if (perfEnabled) {
      outputChannel.appendLine(`[Perf][Generate][cmd] end tookMs=${Date.now() - tStart}`);
    }
  } catch (error) {
    outputChannel.appendLine(`[Generate] Error: ${error}`);
    vscode.window.showErrorMessage(`Failed to generate: ${error}`);
  }
}

/**
 * Optimize AGENTS.md instructions via LLM.
 * Delegates to the CLI `optimize` command.
 *
 * Pre-flight checks:
 * - AGENTS.md must exist (otherwise prompt to generate first)
 * - An API key must be configured in .env (otherwise prompt to set one up)
 *
 * Reads optimize settings from VS Code configuration (aspectcode.optimize.*).
 */
async function handleOptimize(
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  const root = workspaceFolders[0].uri.fsPath;

  // ── Pre-flight: check AGENTS.md exists ─────────────────
  const agentsUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'AGENTS.md');
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

  // ── Pre-flight: check API key exists in .env ───────────
  const envUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.env');
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
      'No LLM API key found. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to a .env file in your workspace root.',
      'Set Up API Key',
    );
    if (action === 'Set Up API Key') {
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

      // Write or append to .env
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
    } else {
      return;
    }
  }

  // ── Read optimize settings from VS Code config ─────────
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

      const result = await cliOptimize(root, {
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
        progress.report({ message: `Done — ${iterations} iteration${iterations === 1 ? '' : 's'}` });
        vscode.window.showInformationMessage(
          `Instructions optimized (${iterations} iteration${iterations === 1 ? '' : 's'}, ${seconds}s)`,
        );
        outputChannel.appendLine(
          `[Optimize] Complete: ${iterations} iterations, ${seconds}s`,
        );
      } else {
        const errMsg = result.stderr || 'Unknown error';
        vscode.window.showErrorMessage(`Optimize failed: ${errMsg}`);
        outputChannel.appendLine(`[Optimize] Failed: ${errMsg}`);
      }
    },
  );
}
