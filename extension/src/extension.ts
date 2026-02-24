/**
 * Aspect Code VS Code Extension — ultra-thin CLI launcher.
 *
 * Two commands: start / stop. Spawns `aspectcode --root <workspace>`.
 * Shows status in the status bar. That's it.
 */

import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// State
// ============================================================================

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let cliProcess: ChildProcess | null = null;
let isRunning = false;

// ============================================================================
// CLI Resolution
// ============================================================================

function resolveCliBin(
  workspaceRoot: string,
  extensionPath: string,
): { node: string; script: string } | { bin: string } {
  // 1. Bundled inside extension
  const bundledScript = path.join(extensionPath, 'cli-bundle', 'bin', 'aspectcode.js');
  try {
    fs.accessSync(bundledScript);
    return { node: process.execPath, script: bundledScript };
  } catch {
    /* not found */
  }

  // 2. Workspace-local (monorepo dev)
  const localScript = path.join(workspaceRoot, 'packages', 'cli', 'bin', 'aspectcode.js');
  try {
    fs.accessSync(localScript);
    return { node: process.execPath, script: localScript };
  } catch {
    /* not found */
  }

  // 3. Global fallback
  return { bin: 'aspectcode' };
}

// ============================================================================
// Process Management
// ============================================================================

function startCli(root: string, extensionPath: string): void {
  if (isRunning) return;

  const resolved = resolveCliBin(root, extensionPath);
  let command: string;
  let args: string[];

  if ('script' in resolved) {
    command = resolved.node;
    args = [resolved.script, '--root', root];
  } else {
    command = resolved.bin;
    args = ['--root', root];
  }

  outputChannel.appendLine(`[AspectCode] Starting: ${command} ${args.join(' ')}`);

  try {
    cliProcess = spawn(command, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: !('script' in resolved),
      env: { ...process.env, NODE_OPTIONS: '' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`[AspectCode] Failed to start: ${msg}`);
    updateStatusBar();
    return;
  }

  isRunning = true;

  cliProcess.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      outputChannel.appendLine(line);
    }
  });

  cliProcess.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      outputChannel.appendLine(`[err] ${line}`);
    }
  });

  cliProcess.on('close', (code) => {
    outputChannel.appendLine(`[AspectCode] Process exited (code=${code})`);
    isRunning = false;
    cliProcess = null;
    updateStatusBar();
    if (code !== 0 && code !== null) {
      vscode.window
        .showWarningMessage(
          `Aspect Code exited with code ${code}. Check the output channel for details.`,
          'Show Output',
        )
        .then((choice) => {
          if (choice === 'Show Output') outputChannel.show();
        });
    }
  });

  cliProcess.on('error', (err) => {
    outputChannel.appendLine(`[AspectCode] Process error: ${err.message}`);
    isRunning = false;
    cliProcess = null;
    updateStatusBar();
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      vscode.window
        .showErrorMessage(
          'Aspect Code CLI not found. Install it with: npm install -g aspectcode',
          'Install',
        )
        .then((choice) => {
          if (choice === 'Install') {
            const term = vscode.window.createTerminal('Install Aspect Code');
            term.show();
            term.sendText('npm install -g aspectcode');
          }
        });
    } else {
      vscode.window.showErrorMessage(`Aspect Code failed to start: ${err.message}`);
    }
  });

  updateStatusBar();
}

function stopCli(): void {
  if (!cliProcess || !isRunning) return;
  outputChannel.appendLine('[AspectCode] Stopping…');
  cliProcess.kill('SIGTERM');
  setTimeout(() => {
    if (isRunning && cliProcess) {
      cliProcess.kill('SIGKILL');
    }
  }, 3000);
}

// ============================================================================
// Status Bar
// ============================================================================

function updateStatusBar(): void {
  if (!statusBarItem) return;

  if (isRunning) {
    statusBarItem.text = '$(beaker~spin) Aspect Code';
    statusBarItem.tooltip = 'Aspect Code: Running — click to stop';
    statusBarItem.command = 'aspectcode.stop';
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = '$(beaker) Aspect Code';
    statusBarItem.tooltip = 'Aspect Code: Stopped — click to start';
    statusBarItem.command = 'aspectcode.start';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  statusBarItem.show();
}

// ============================================================================
// Activation
// ============================================================================

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Aspect Code');
  context.subscriptions.push(outputChannel);

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, -100);
  context.subscriptions.push(statusBarItem);
  updateStatusBar();

  const getRoot = (): string | undefined => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // ── Commands: start / stop ───────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('aspectcode.start', () => {
      const root = getRoot();
      if (!root) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }
      if (isRunning) {
        vscode.window.showInformationMessage('Aspect Code is already running');
        return;
      }
      startCli(root, context.extensionPath);
    }),

    vscode.commands.registerCommand('aspectcode.stop', () => {
      if (!isRunning) {
        vscode.window.showInformationMessage('Aspect Code is not running');
        return;
      }
      stopCli();
    }),
  );

  // Show status bar — user clicks to start
  updateStatusBar();
}

export function deactivate() {
  stopCli();
}
