/**
 * Command Handlers
 *
 * This module registers and handles all extension commands.
 * Commands: toggleExtensionEnabled, generate, generateKb
 */

import * as vscode from 'vscode';
import type { AnalysisModel } from '@aspectcode/core';
import { createInstructionsEmitter } from '@aspectcode/emitters';
import { AspectCodeState } from './state';
import { detectAssistants } from './assistants/detection';
import { generateKnowledgeBase } from './assistants/kb';
import { createVsCodeEmitterHost } from './services/vscodeEmitterHost';
import {
  getInstructionsModeSetting,
  getGenerateKbSetting,
  updateAspectSettings,
  getExtensionEnabledSetting,
  setExtensionEnabledSetting,
  setUpdateRateSetting,
} from './services/aspectSettings';
import { cancelAndResetAllInFlightWork } from './services/enablementCancellation';
import { cliGenerateWithInstructions } from './services/CliAdapter';

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

    vscode.commands.registerCommand('aspectcode.generateKb', async () => {
      if (!(await requireExtensionEnabled())) return;
      return await handleGenerateKb(state, channel, context, onStatusBarUpdate);
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

    const instructionAssistants = new Set(detected);
    instructionAssistants.delete('aspectKB');
    const hasInstructionFiles = instructionAssistants.size > 0;

    if (showNotificationOnMissing && !hasInstructionFiles) {
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
        channel.appendLine(`[Watcher] Detected missing instruction files`);
        const message = 'Aspect Code: AI instruction files were deleted.';
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

  // kb.md at workspace root
  const kbFileWatcher = vscode.workspace.createFileSystemWatcher('**/kb.md');
  kbFileWatcher.onDidCreate(() => {
    channel.appendLine('[Watcher] kb.md created');
    debouncedInstructionUpdate(false);
    void onStatusBarUpdate?.();
  });
  kbFileWatcher.onDidDelete(() => {
    channel.appendLine('[Watcher] kb.md deleted');
    debouncedInstructionUpdate(false);
    void onStatusBarUpdate?.();
  });
  context.subscriptions.push(kbFileWatcher);

  // AGENTS.md instruction file
  const instructionFilesWatcher = vscode.workspace.createFileSystemWatcher('**/AGENTS.md');
  instructionFilesWatcher.onDidCreate(() => debouncedInstructionUpdate(false));
  instructionFilesWatcher.onDidDelete(() => debouncedInstructionUpdate(true));
  context.subscriptions.push(instructionFilesWatcher);
}

// =====================================================================
// Command Implementations
// =====================================================================

/**
 * Emit instruction files (AGENTS.md) via CLI (preferred) or in-process fallback.
 */
async function emitInstructionFilesOnlyViaEmitters(
  workspaceRoot: vscode.Uri,
  outputChannel: vscode.OutputChannel,
): Promise<number> {
  const mode = await getInstructionsModeSetting(workspaceRoot, outputChannel);
  const generateKbEnabled = await getGenerateKbSetting(workspaceRoot);

  // Check if kb.md exists to pass context to instruction content generators
  let kbExists = false;
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(workspaceRoot, 'kb.md'));
    kbExists = true;
  } catch {
    /* kb.md doesn't exist */
  }

  // ── Try CLI subprocess first ──────────────────────────────
  const cliResult = await cliGenerateWithInstructions(workspaceRoot.fsPath, {
    outputChannel,
    instructionsMode: mode,
  });

  if (cliResult.exitCode === 0 && cliResult.data) {
    outputChannel.appendLine(
      `[Instructions] CLI generated ${cliResult.data.wrote.length} file(s) (mode=${mode})`,
    );
    return cliResult.data.wrote.length;
  }

  // ── In-process fallback ───────────────────────────────────
  outputChannel.appendLine(
    `[Instructions] CLI unavailable (exit=${cliResult.exitCode}), falling back to in-process`,
  );

  const generatedAt = new Date().toISOString();
  const model: AnalysisModel = {
    schemaVersion: '0.1',
    generatedAt,
    repo: { root: workspaceRoot.fsPath },
    files: [],
    symbols: [],
    graph: { nodes: [], edges: [] },
    metrics: { hubs: [] },
  };

  const host = createVsCodeEmitterHost();
  const emitter = createInstructionsEmitter();
  const result = await emitter.emit(model, host, {
    workspaceRoot: workspaceRoot.fsPath,
    outDir: workspaceRoot.fsPath,
    generatedAt,
    instructionsMode: mode,
    generateKb: generateKbEnabled || kbExists,
  });

  outputChannel.appendLine(
    `[Instructions] In-process emitters updated ${result.filesWritten.length} file(s) (mode=${mode})`,
  );

  return result.filesWritten.length;
}

/**
 * Unified generate command.
 * Generates KB files (if missing) and AGENTS.md instruction file.
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

    // Check if KB generation is enabled and needed
    const generateKbEnabled = await getGenerateKbSetting(workspaceRoot);
    if (generateKbEnabled) {
      const kbFile = vscode.Uri.joinPath(workspaceRoot, 'kb.md');
      let needsKbGeneration = false;
      try {
        await vscode.workspace.fs.stat(kbFile);
      } catch {
        needsKbGeneration = true;
      }

      if (needsKbGeneration) {
        outputChannel.appendLine('[Generate] KB file not found, generating...');
        await generateKnowledgeBase(workspaceRoot, state, outputChannel, context);
      }
    }

    // Generate instruction files (marker-based, idempotent)
    const tGen = Date.now();
    await emitInstructionFilesOnlyViaEmitters(workspaceRoot, outputChannel);
    if (perfEnabled) {
      outputChannel.appendLine(
        `[Perf][Generate][cmd] emitInstructionFiles tookMs=${Date.now() - tGen}`,
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
 * Dedicated "Generate Knowledge Base" command.
 * Unconditionally generates/updates kb.md, persists `generateKb: true`
 * in aspectcode.json so auto-regen keeps the KB current, and refreshes
 * instruction files with KB-aware content.
 */
async function handleGenerateKb(
  state: AspectCodeState,
  outputChannel: vscode.OutputChannel,
  context?: vscode.ExtensionContext,
  onStatusBarUpdate?: () => Promise<void>,
): Promise<void> {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }
    const workspaceRoot = workspaceFolders[0].uri;

    outputChannel.appendLine('[GenerateKB] Starting KB generation...');

    // Persist generateKb: true so auto-regen keeps KB current
    await updateAspectSettings(workspaceRoot, { generateKb: true });
    outputChannel.appendLine('[GenerateKB] Persisted generateKb: true');

    // Unconditionally generate/update kb.md
    await generateKnowledgeBase(workspaceRoot, state, outputChannel, context);

    // Refresh instruction files with KB-aware content
    await emitInstructionFilesOnlyViaEmitters(workspaceRoot, outputChannel);

    // Mark KB as fresh
    try {
      const { getWorkspaceFingerprint } = await import('./extension');
      const fingerprint = getWorkspaceFingerprint();
      if (fingerprint) {
        await fingerprint.markKbFresh();
        outputChannel.appendLine('[GenerateKB] Marked KB as fresh');
      }
    } catch (e) {
      outputChannel.appendLine(`[GenerateKB] Failed to mark KB fresh (non-critical): ${e}`);
    }

    vscode.window.showInformationMessage('Knowledge base generated (kb.md)');
    void onStatusBarUpdate?.();
  } catch (error) {
    outputChannel.appendLine(`[GenerateKB] Error: ${error}`);
    vscode.window.showErrorMessage(`Failed to generate knowledge base: ${error}`);
  }
}
