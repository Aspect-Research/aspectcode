import * as vscode from 'vscode';
import * as path from 'path';
import { SUPPORTED_EXTENSIONS } from '@aspectcode/core';
import { loadGrammarsOnce, getLoadedGrammarsSummary } from './tsParser';
import { AspectCodeState } from './state';
import { activateCommands } from './commandHandlers';
import { WorkspaceFingerprint } from './services/WorkspaceFingerprint';
import {
  getUpdateRateSetting,
  migrateAspectSettingsFromVSCode,
  readAspectSettings,
  setUpdateRateSetting,
  getExtensionEnabledSetting,
} from './services/aspectSettings';
import {
  initFileDiscoveryService,
  disposeFileDiscoveryService,
} from './services/FileDiscoveryService';
import { detectAssistants } from './assistants/detection';

// ============================================================================
// Module-level state
// ============================================================================

const diag = vscode.languages.createDiagnosticCollection('aspectcode');
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let workspaceFingerprint: WorkspaceFingerprint | null = null;

/** Status bar visual states. */
type StatusBarState = 'uninitialized' | 'fresh' | 'stale' | 'disabled';
let currentStatusBarState: StatusBarState = 'uninitialized';

export function getWorkspaceFingerprint(): WorkspaceFingerprint | null {
  return workspaceFingerprint;
}

async function getWorkspaceRoot(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

/**
 * Read the extension version from package.json at runtime so the fingerprint
 * version-mismatch detection actually works.
 */
function getExtensionVersion(context: vscode.ExtensionContext): string {
  try {
    return (context.extension.packageJSON as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ============================================================================
// Status Bar
// ============================================================================

/**
 * Update the status bar icon, tooltip, and command to reflect extension state.
 */
async function updateStatusBar(): Promise<void> {
  if (!statusBarItem) return;

  const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!rootUri) {
    statusBarItem.hide();
    return;
  }

  // 1. Check enabled
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

  // 2. Check if kb.md or instruction files exist
  const detected = await detectAssistants(rootUri);
  const hasKB = detected.has('aspectKB');
  const hasInstructions = detected.size > (hasKB ? 1 : 0);

  if (!hasKB && !hasInstructions) {
    currentStatusBarState = 'uninitialized';
    statusBarItem.text = '$(beaker)';
    statusBarItem.tooltip = 'Aspect Code: Not configured — click to set up';
    statusBarItem.command = 'aspectcode.generate';
    statusBarItem.backgroundColor = undefined;
    statusBarItem.show();
    return;
  }

  // 3. Check staleness
  const isStale = (await workspaceFingerprint?.isKbStale()) ?? false;
  if (isStale) {
    currentStatusBarState = 'stale';
    statusBarItem.text = '$(beaker)';
    statusBarItem.tooltip = 'Aspect Code: KB is stale — click to regenerate';
    statusBarItem.command = 'aspectcode.generate';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBarItem.show();
    return;
  }

  // 4. Fresh
  currentStatusBarState = 'fresh';
  statusBarItem.text = '$(beaker)';
  statusBarItem.tooltip = 'Aspect Code: Up to date';
  statusBarItem.command = 'aspectcode.generate';
  statusBarItem.backgroundColor = undefined;
  statusBarItem.show();
}

// ============================================================================
// First-open prompt
// ============================================================================

const DISMISSED_REPOS_KEY = 'aspectcode.dismissedRepos';

async function maybeShowSetupPrompt(
  context: vscode.ExtensionContext,
  rootUri: vscode.Uri,
): Promise<void> {
  // Global suppression via VS Code setting
  const globalSuppressed = vscode.workspace
    .getConfiguration()
    .get<boolean>('aspectcode.suppressSetupPrompt', false);
  if (globalSuppressed) return;

  // Per-repo suppression via globalState
  const dismissedRepos = context.globalState.get<string[]>(DISMISSED_REPOS_KEY, []);
  const repoKey = rootUri.toString();
  if (dismissedRepos.includes(repoKey)) return;

  // Check if repo already has Aspect Code artifacts
  const detected = await detectAssistants(rootUri);
  if (detected.size > 0) return; // has kb.md or instruction files

  // Also skip if aspectcode.json exists (may have been CLI-initialized)
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
    void vscode.commands.executeCommand('aspectcode.generate');
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
  // Initialize output channel
  outputChannel = vscode.window.createOutputChannel('Aspect Code');

  const extensionVersion = getExtensionVersion(context);
  outputChannel.appendLine(`[Startup] Aspect Code v${extensionVersion}`);

  // Create status bar item (updated to reflect state below)
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, -100);
  statusBarItem.text = '$(beaker)';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Initialize state
  const state = new AspectCodeState(context);
  state.load();

  // Migrate project-scoped Aspect Code settings from .vscode/settings.json (if present)
  // into aspectcode.json, and ensure reasonable defaults exist there.
  try {
    const root = await getWorkspaceRoot();
    if (root) {
      const rootUri = vscode.Uri.file(root);

      await migrateAspectSettingsFromVSCode(rootUri, outputChannel, context.globalState);

      // Ensure a default updateRate is present — but only if aspectcode.json
      // already exists.  Creating it here would suppress the first-open
      // setup prompt that checks for its absence.
      const settings = await readAspectSettings(rootUri);
      if (settings.updateRate === undefined && settings.autoRegenerateKb === undefined) {
        await setUpdateRateSetting(rootUri, 'onChange', { createIfMissing: false });
      }
    }
  } catch (e) {
    outputChannel.appendLine(`[Settings] Failed to migrate project settings: ${e}`);
  }

  // Initialize workspace fingerprint for KB staleness detection
  const workspaceRoot = await getWorkspaceRoot();
  if (workspaceRoot) {
    // Initialize FileDiscoveryService singleton FIRST (used by other services)
    const workspaceRootUri = vscode.Uri.file(workspaceRoot);
    initFileDiscoveryService(workspaceRootUri, outputChannel);
    context.subscriptions.push({ dispose: () => disposeFileDiscoveryService() });
    outputChannel.appendLine('[Startup] FileDiscoveryService initialized');

    workspaceFingerprint = new WorkspaceFingerprint(workspaceRoot, extensionVersion, outputChannel);
    context.subscriptions.push(workspaceFingerprint);

    // Initialize fingerprint service with project-local mode and keep it updated.
    try {
      const mode = await getUpdateRateSetting(vscode.Uri.file(workspaceRoot), outputChannel);
      workspaceFingerprint.setAutoRegenerateKbMode(mode);
    } catch {}

    // ── Watch aspectcode.json for settings changes ──────────────────────
    const aspectSettingsWatcher = vscode.workspace.createFileSystemWatcher('**/aspectcode.json');

    const refreshFromAspectSettings = async () => {
      try {
        const mode = await getUpdateRateSetting(vscode.Uri.file(workspaceRoot), outputChannel);
        workspaceFingerprint?.setAutoRegenerateKbMode(mode);
      } catch {
        /* Ignore */
      }
      void updateStatusBar();
    };

    aspectSettingsWatcher.onDidChange(() => {
      outputChannel.appendLine('[Watcher] aspectcode.json changed');
      void refreshFromAspectSettings();
    });
    aspectSettingsWatcher.onDidCreate(() => {
      outputChannel.appendLine('[Watcher] aspectcode.json created');
      void refreshFromAspectSettings();
    });
    aspectSettingsWatcher.onDidDelete(() => {
      outputChannel.appendLine('[Watcher] aspectcode.json deleted');
      workspaceFingerprint?.setAutoRegenerateKbMode('onChange');
      void updateStatusBar();
    });
    context.subscriptions.push(aspectSettingsWatcher);

    // Track staleness transitions → update status bar.
    workspaceFingerprint.onStaleStateChanged((stale) => {
      outputChannel.appendLine(`[KB] stale=${stale}`);
      void updateStatusBar();
    });

    // Set up KB regeneration callback for idle/onChange auto-regeneration
    workspaceFingerprint.setKbRegenerateCallback(async () => {
      try {
        const regenStart = Date.now();
        outputChannel.appendLine('[KB] Auto-regenerating KB...');

        const { regenerateEverything } = await import('./assistants/kb');
        const result = await regenerateEverything(state, outputChannel, context);

        if (result.regenerated) {
          await workspaceFingerprint?.markKbFresh(result.files);
          outputChannel.appendLine(
            `[KB] Auto-regeneration complete in ${Date.now() - regenStart}ms`,
          );
          void updateStatusBar();
        }
      } catch (e) {
        outputChannel.appendLine(`[KB] Auto-regeneration failed: ${e}`);
      }
    });

    // Check KB staleness on startup
    const isStale = await workspaceFingerprint.isKbStale();
    if (isStale) {
      outputChannel.appendLine('[Startup] KB may be stale - will auto-regenerate if configured');
    } else {
      outputChannel.appendLine('[Startup] KB is up to date');
    }
  }

  // ===== EXTENSION SETUP =====
  outputChannel.appendLine('Aspect Code extension activated');

  // Load tree-sitter grammars for local parsing
  loadGrammarsOnce(context, outputChannel)
    .then(() => {
      const summary = getLoadedGrammarsSummary();
      const statusParts = Object.entries(summary)
        .filter(([lang]) => lang !== 'initFailed')
        .map(([lang, ok]) => `${lang}=${ok ? 'OK' : 'MISSING'}`);
      if (summary.initFailed) {
        statusParts.unshift('init=FAILED');
      }
      outputChannel.appendLine(`Tree-sitter loaded: ${statusParts.join(' ')}`);
    })
    .catch((error) => {
      outputChannel.appendLine(`Tree-sitter initialization failed: ${error}`);
    });

  const shouldTrackFileForKb = (filePath: string): boolean => {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return false;
    }

    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    const excludedSegments = [
      '/node_modules/',
      '/.git/',
      '/__pycache__/',
      '/.venv/',
      '/venv/',
      '/build/',
      '/dist/',
      '/target/',
      '/coverage/',
      '/.next/',
      '/.pytest_cache/',
      '/.mypy_cache/',
      '/.tox/',
      '/htmlcov/',
    ];
    return !excludedSegments.some((seg) => normalized.includes(seg));
  };

  const isBulkEdit = (changes: readonly vscode.TextDocumentContentChangeEvent[]): boolean => {
    if (!changes || changes.length === 0) return false;
    if (changes.length >= 2) return true;
    const c = changes[0];
    const insertedLen = (c.text || '').length;
    const insertedLines = (c.text || '').split(/\r?\n/).length - 1;
    const replacedLen = c.rangeLength ?? 0;
    return insertedLen >= 200 || insertedLines >= 8 || replacedLen >= 400;
  };

  // Hook into file change events for KB staleness detection
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async (event) => {
      const filePath = event.document.fileName;
      if (!shouldTrackFileForKb(filePath)) return;

      if (event.contentChanges.length > 0) {
        workspaceFingerprint?.onFileEdited();

        const autoRegen = workspaceRoot
          ? await getUpdateRateSetting(vscode.Uri.file(workspaceRoot))
          : 'onChange';
        if (autoRegen === 'onChange' && isBulkEdit(event.contentChanges)) {
          workspaceFingerprint?.onFileSaved(filePath);
        }
      }
    }),
  );

  // Also mark stale on save.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const filePath = doc.fileName;
      if (!shouldTrackFileForKb(filePath)) return;
      workspaceFingerprint?.onFileSaved(filePath);
    }),
  );

  // Watch for on-disk changes (git revert/checkout, bulk updates).
  const kbFsWatcher = vscode.workspace.createFileSystemWatcher(
    '**/*.{py,ts,tsx,js,jsx,mjs,cjs,java,cpp,c,cs,go,rs}',
  );
  kbFsWatcher.onDidChange((uri) => {
    if (!shouldTrackFileForKb(uri.fsPath)) return;
    workspaceFingerprint?.onFileSaved(uri.fsPath);
  });
  kbFsWatcher.onDidCreate((uri) => {
    if (!shouldTrackFileForKb(uri.fsPath)) return;
    workspaceFingerprint?.onFileSaved(uri.fsPath);
  });
  kbFsWatcher.onDidDelete((uri) => {
    if (!shouldTrackFileForKb(uri.fsPath)) return;
    workspaceFingerprint?.onFileSaved(uri.fsPath);
  });
  context.subscriptions.push(kbFsWatcher);

  context.subscriptions.push(diag, outputChannel);

  // Activate command handlers (registers remaining commands + watchers)
  activateCommands(context, state, outputChannel, updateStatusBar);

  // Initial status bar update
  void updateStatusBar();

  // First-open prompt (delayed slightly to avoid startup noise)
  const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (rootUri) {
    setTimeout(() => void maybeShowSetupPrompt(context, rootUri), 2000);
  }
}

export function deactivate() {
  diag.dispose();
}
