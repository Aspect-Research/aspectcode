/**
 * Aspect Code VS Code Extension — thin launcher.
 *
 * All heavy lifting lives in the CLI (`@aspectcode/cli`). This extension:
 *   1. Auto-starts `aspectcode watch` when a workspace has `aspectcode.json`.
 *   2. Provides a handful of commands (generate, optimize, setup, toggle).
 *   3. Shows a status bar item reflecting the daemon state.
 *
 * No tree-sitter, no in-process analysis, no emitters.
 */

import * as vscode from 'vscode';
import { detectAssistants } from './assistants/detection';
import { activateCommands, type DaemonState } from './commandHandlers';
import {
  setExtensionPath,
  cliWatchDaemon,
  type WatchDaemonHandle,
} from './services/CliAdapter';
import {
  getExtensionEnabledSetting,
  readAspectSettings,
} from './services/aspectSettings';

// ============================================================================
// Module-level state
// ============================================================================

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let watchDaemon: WatchDaemonHandle | null = null;

// ============================================================================
// Status Bar
// ============================================================================

type StatusBarState = 'running' | 'stopped' | 'error' | 'uninitialized' | 'disabled';
let currentStatusBarState: StatusBarState = 'uninitialized';

export function getDaemonState(): DaemonState {
  return {
    running: watchDaemon?.running ?? false,
    statusBarState: currentStatusBarState,
  };
}

async function updateStatusBar(): Promise<void> {
  if (!statusBarItem) return;

  const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!rootUri) {
    statusBarItem.hide();
    return;
  }

  // Check enabled
  let enabled = true;
  try {
    enabled = await getExtensionEnabledSetting(rootUri);
  } catch {
    /* default to true */
  }

  if (!enabled) {
    currentStatusBarState = 'disabled';
    statusBarItem.text = '$(beaker)';
    statusBarItem.tooltip = 'Aspect Code: Disabled — click to enable';
    statusBarItem.command = 'aspectcode.toggleExtensionEnabled';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBarItem.show();
    return;
  }

  // Check if artifacts exist
  const detected = await detectAssistants(rootUri);
  const hasAnything = detected.size > 0;

  if (!hasAnything) {
    currentStatusBarState = 'uninitialized';
    statusBarItem.text = '$(beaker)';
    statusBarItem.tooltip = 'Aspect Code: Not configured — click to set up';
    statusBarItem.command = 'aspectcode.setup';
    statusBarItem.backgroundColor = undefined;
    statusBarItem.show();
    return;
  }

  if (watchDaemon?.running) {
    currentStatusBarState = 'running';
    statusBarItem.text = '$(beaker)';
    statusBarItem.tooltip = 'Aspect Code: Watching for changes';
    statusBarItem.command = 'aspectcode.generate';
    statusBarItem.backgroundColor = undefined;
    statusBarItem.show();
    return;
  }

  currentStatusBarState = 'stopped';
  statusBarItem.text = '$(beaker)';
  statusBarItem.tooltip = 'Aspect Code: Watch stopped — click to generate';
  statusBarItem.command = 'aspectcode.generate';
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  statusBarItem.show();
}

// ============================================================================
// Watch daemon lifecycle
// ============================================================================

function startDaemon(root: string): void {
  if (watchDaemon?.running) return;

  outputChannel.appendLine('[Daemon] Starting watch daemon…');
  watchDaemon = cliWatchDaemon(root, {
    outputChannel,
    onExit(code) {
      outputChannel.appendLine(`[Daemon] Watch daemon exited (code=${code})`);
      void updateStatusBar();
    },
  });
  void updateStatusBar();
}

export function stopDaemon(): void {
  if (!watchDaemon?.running) return;
  watchDaemon.stop();
  watchDaemon = null;
  void updateStatusBar();
}

export function restartDaemon(root: string): void {
  stopDaemon();
  startDaemon(root);
}

// ============================================================================
// First-open prompt
// ============================================================================

const DISMISSED_REPOS_KEY = 'aspectcode.dismissedRepos';

async function maybeShowSetupPrompt(
  context: vscode.ExtensionContext,
  rootUri: vscode.Uri,
): Promise<void> {
  const globalSuppressed = vscode.workspace
    .getConfiguration()
    .get<boolean>('aspectcode.suppressSetupPrompt', false);
  if (globalSuppressed) return;

  const dismissedRepos = context.globalState.get<string[]>(DISMISSED_REPOS_KEY, []);
  const repoKey = rootUri.toString();
  if (dismissedRepos.includes(repoKey)) return;

  // Skip if artifacts already exist
  const detected = await detectAssistants(rootUri);
  if (detected.size > 0) return;

  // Skip if aspectcode.json exists (CLI-initialized)
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(rootUri, 'aspectcode.json'));
    return;
  } catch {
    /* file doesn't exist — proceed with prompt */
  }

  const action = await vscode.window.showInformationMessage(
    "This repo doesn't have Aspect Code configured. Set up AI assistant context?",
    'Set Up',
    'Not for This Repo',
    'Never Ask',
  );

  if (action === 'Set Up') {
    void vscode.commands.executeCommand('aspectcode.setup');
  } else if (action === 'Not for This Repo') {
    const updated = [...dismissedRepos, repoKey];
    await context.globalState.update(DISMISSED_REPOS_KEY, updated);
  } else if (action === 'Never Ask') {
    await vscode.workspace
      .getConfiguration()
      .update('aspectcode.suppressSetupPrompt', true, vscode.ConfigurationTarget.Global);
  }
}

// ============================================================================
// Activation
// ============================================================================

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Aspect Code');

  const extensionVersion = getExtensionVersion(context);
  outputChannel.appendLine(`[Startup] Aspect Code v${extensionVersion}`);

  // Tell CliAdapter where the bundled CLI lives.
  setExtensionPath(context.extensionPath);

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, -100);
  statusBarItem.text = '$(beaker)';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem, outputChannel);

  // Register commands
  activateCommands(context, outputChannel, updateStatusBar);

  // Auto-start watch daemon if workspace has aspectcode.json
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    try {
      const settings = await readAspectSettings(vscode.Uri.file(workspaceRoot));
      const hasConfig = settings !== undefined && Object.keys(settings).length > 0;
      const enabled = await getExtensionEnabledSetting(vscode.Uri.file(workspaceRoot));

      if (hasConfig && enabled) {
        startDaemon(workspaceRoot);
      }
    } catch {
      outputChannel.appendLine('[Startup] No aspectcode.json found — skipping auto-start');
    }

    // Watch aspectcode.json for changes (e.g. CLI `init` creates it)
    const configWatcher = vscode.workspace.createFileSystemWatcher('**/aspectcode.json');
    configWatcher.onDidCreate(() => {
      outputChannel.appendLine('[Watcher] aspectcode.json created');
      if (!watchDaemon?.running && workspaceRoot) {
        startDaemon(workspaceRoot);
      }
      void updateStatusBar();
    });
    configWatcher.onDidChange(() => void updateStatusBar());
    configWatcher.onDidDelete(() => {
      outputChannel.appendLine('[Watcher] aspectcode.json deleted');
      stopDaemon();
      void updateStatusBar();
    });
    context.subscriptions.push(configWatcher);
  }

  // Initial status bar
  void updateStatusBar();

  // First-open prompt (delayed)
  const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (rootUri) {
    setTimeout(() => void maybeShowSetupPrompt(context, rootUri), 2000);
  }
}

export function deactivate() {
  stopDaemon();
}

// ============================================================================
// Helpers
// ============================================================================

function getExtensionVersion(context: vscode.ExtensionContext): string {
  try {
    return (context.extension.packageJSON as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
