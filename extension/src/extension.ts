import * as vscode from 'vscode';
import * as path from 'path';
import { SUPPORTED_EXTENSIONS } from '@aspectcode/core';
import { loadGrammarsOnce, getLoadedGrammarsSummary } from './tsParser';
import { AspectCodeState } from './state';
import { activateCommands } from './commandHandlers';
import { WorkspaceFingerprint } from './services/WorkspaceFingerprint';
import { computeImpactSummaryForFile } from './assistants/kb';
import {
  getAutoRegenerateKbSetting,
  migrateAspectSettingsFromVSCode,
  readAspectSettings,
  setAutoRegenerateKbSetting,
  getExtensionEnabledSetting,
} from './services/aspectSettings';
import {
  initFileDiscoveryService,
  disposeFileDiscoveryService,
} from './services/FileDiscoveryService';

// ============================================================================
// Module-level state
// ============================================================================

const diag = vscode.languages.createDiagnosticCollection('aspectcode');
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let workspaceFingerprint: WorkspaceFingerprint | null = null;
const EXTENSION_VERSION = '0.0.1';

export function getWorkspaceFingerprint(): WorkspaceFingerprint | null {
  return workspaceFingerprint;
}

async function getWorkspaceRoot(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

// ============================================================================
// Activation
// ============================================================================

export async function activate(context: vscode.ExtensionContext) {
  // Initialize output channel
  outputChannel = vscode.window.createOutputChannel('Aspect Code');

  // Create status bar item immediately on activation (icon only)
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, -100);
  statusBarItem.command = 'aspectcode.generateKB';
  statusBarItem.tooltip = 'Regenerate Aspect Code Knowledge Base';
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

      await migrateAspectSettingsFromVSCode(rootUri, outputChannel);

      // Ensure a default updateRate is present in aspectcode.json.
      const settings = await readAspectSettings(rootUri);
      if (settings.updateRate === undefined && settings.autoRegenerateKb === undefined) {
        await setAutoRegenerateKbSetting(rootUri, 'onChange');
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

    workspaceFingerprint = new WorkspaceFingerprint(
      workspaceRoot,
      EXTENSION_VERSION,
      outputChannel,
    );
    context.subscriptions.push(workspaceFingerprint);

    // Initialize fingerprint service with project-local mode and keep it updated.
    try {
      const mode = await getAutoRegenerateKbSetting(vscode.Uri.file(workspaceRoot), outputChannel);
      workspaceFingerprint.setAutoRegenerateKbMode(mode);
    } catch {}

    // Watch aspectcode.json for settings changes.
    const aspectSettingsWatcher = vscode.workspace.createFileSystemWatcher('**/aspectcode.json');
    const refreshKbMode = () => {
      void (async () => {
        try {
          const mode = await getAutoRegenerateKbSetting(
            vscode.Uri.file(workspaceRoot),
            outputChannel,
          );
          workspaceFingerprint?.setAutoRegenerateKbMode(mode);
        } catch {
          // Ignore
        }
      })();
    };
    aspectSettingsWatcher.onDidChange(refreshKbMode);
    aspectSettingsWatcher.onDidCreate(refreshKbMode);
    aspectSettingsWatcher.onDidDelete(() => {
      workspaceFingerprint?.setAutoRegenerateKbMode('onChange');
    });
    context.subscriptions.push(aspectSettingsWatcher);

    // Track staleness transitions.
    workspaceFingerprint.onStaleStateChanged((stale) => {
      outputChannel.appendLine(`[KB] stale=${stale}`);
    });

    // Set up KB regeneration callback for idle/onChange auto-regeneration
    workspaceFingerprint.setKbRegenerateCallback(async () => {
      try {
        const regenStart = Date.now();
        outputChannel.appendLine('[KB] Auto-regenerating KB...');

        // KB generation works offline (uses local dependency analysis)
        const { regenerateEverything } = await import('./assistants/kb');
        const result = await regenerateEverything(state, outputChannel, context);

        if (result.regenerated) {
          // Pass the discovered files to markKbFresh to avoid rediscovery
          await workspaceFingerprint?.markKbFresh(result.files);

          outputChannel.appendLine(
            `[KB] Auto-regeneration complete in ${Date.now() - regenStart}ms`,
          );
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

  // ===== CORE COMMANDS =====

  // Generate/refresh KB files (.aspect/*.md) based on current state.
  context.subscriptions.push(
    vscode.commands.registerCommand('aspectcode.generateKB', async () => {
      const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!rootUri) {
        vscode.window.showWarningMessage('No workspace folder open.');
        return;
      }

      const enabled = await getExtensionEnabledSetting(rootUri);
      if (!enabled) {
        vscode.window.showInformationMessage('Aspect Code is disabled.', 'Enable').then((sel) => {
          if (sel === 'Enable')
            void vscode.commands.executeCommand('aspectcode.toggleExtensionEnabled');
        });
        return;
      }

      try {
        const regenStart = Date.now();
        outputChannel?.appendLine('=== REGENERATE KB: Using regenerateEverything() ===');

        const { regenerateEverything } = await import('./assistants/kb');
        const result = await regenerateEverything(state, outputChannel!, context);

        if (result.regenerated) {
          await workspaceFingerprint?.markKbFresh(result.files);

          outputChannel?.appendLine(
            `=== REGENERATE KB: Complete (${Date.now() - regenStart}ms) ===`,
          );
          vscode.window.showInformationMessage('Knowledge base regenerated successfully.');
        } else {
          outputChannel?.appendLine('=== REGENERATE KB: Skipped (.aspect/ not yet created) ===');
          vscode.window.showInformationMessage(
            'Knowledge base not yet initialized. Run "Aspect Code: Configure AI Assistants" first.',
          );
        }
      } catch (e) {
        outputChannel?.appendLine(`REGENERATE KB ERROR: ${e}`);
        vscode.window.showErrorMessage(`KB regeneration failed: ${e}`);
      }
    }),
  );

  // Copy a short impact summary for the current file to clipboard.
  context.subscriptions.push(
    vscode.commands.registerCommand('aspectcode.copyImpactAnalysisCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active file.');
        return;
      }

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('No workspace folder open.');
        return;
      }

      const wsRoot = workspaceFolders[0].uri;
      const absPath = editor.document.uri.fsPath;

      const channel = outputChannel ?? vscode.window.createOutputChannel('Aspect Code');
      channel.appendLine(`[Impact] Computing impact for: ${absPath}`);

      const summary = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Aspect Code: Computing impact analysis...',
          cancellable: false,
        },
        async () => computeImpactSummaryForFile(wsRoot, absPath, channel),
      );

      if (!summary) {
        vscode.window.showWarningMessage(
          'Impact analysis unavailable. Try running "Aspect Code: Examine" first.',
        );
        return;
      }

      const lines: string[] = [];
      lines.push('Aspect Code — Impact Analysis');
      lines.push(`File: ${summary.file}`);
      lines.push(`Dependents: ${summary.dependents_count}`);
      if (summary.top_dependents.length > 0) {
        lines.push('Top dependents:');
        for (const dep of summary.top_dependents) {
          lines.push(`- ${dep.file} (${dep.dependent_count} dependents)`);
        }
      } else {
        lines.push('Top dependents: (none found)');
      }
      lines.push(`Generated: ${summary.generated_at}`);

      await vscode.env.clipboard.writeText(lines.join('\n'));
      vscode.window.showInformationMessage('Impact analysis copied to clipboard.');
    }),
  );

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
      '/node_modules/', '/.git/', '/__pycache__/', '/.venv/', '/venv/',
      '/build/', '/dist/', '/target/', '/coverage/', '/.next/',
      '/.pytest_cache/', '/.mypy_cache/', '/.tox/', '/htmlcov/', '/.aspect/',
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
          ? await getAutoRegenerateKbSetting(vscode.Uri.file(workspaceRoot))
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

  // Activate command handlers
  activateCommands(context, state, outputChannel);
}

export function deactivate() {
  diag.dispose();
}
