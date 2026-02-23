/**
 * Command Handlers
 *
 * This module registers and handles all extension commands.
 * Commands: toggleExtensionEnabled, configureAssistants, generate
 */

import * as vscode from 'vscode';
import type { AnalysisModel } from '@aspectcode/core';
import { createInstructionsEmitter } from '@aspectcode/emitters';
import { AspectCodeState } from './state';
import { detectAssistants, AssistantId } from './assistants/detection';
import { generateKnowledgeBase } from './assistants/kb';
import { createVsCodeEmitterHost } from './services/vscodeEmitterHost';

/**
 * Optional override for assistant selection when called from configureAssistants.
 */
interface AssistantsOverride {
  copilot?: boolean;
  cursor?: boolean;
  claude?: boolean;
  other?: boolean;
}
import {
  getAssistantsSettings,
  getInstructionsModeSetting,
  updateAspectSettings,
  getExtensionEnabledSetting,
  setExtensionEnabledSetting,
  setUpdateRateSetting,
} from './services/aspectSettings';
import { cancelAndResetAllInFlightWork } from './services/enablementCancellation';
import { cliGenerateWithInstructions, cliOptimize } from './services/CliAdapter';

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

    vscode.commands.registerCommand('aspectcode.configureAssistants', async () => {
      if (!(await requireExtensionEnabled())) return;
      return await handleConfigureAssistants(context, state, channel, onStatusBarUpdate);
    }),

    vscode.commands.registerCommand('aspectcode.generate', async () => {
      if (!(await requireExtensionEnabled())) return;
      return await handleGenerate(state, channel, context, undefined, onStatusBarUpdate);
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

    const instructionAssistants = new Set(detected);
    instructionAssistants.delete('aspectKB');
    const hasInstructionFiles = instructionAssistants.size > 0;
    const setupComplete = hasAspectKB && hasInstructionFiles;

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
          `[Watcher] Detected missing files: aspectKB=${hasAspectKB}, instructionFiles=${hasInstructionFiles}`,
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
    // When .aspect/instructions.md changes, regenerate instruction files
    // so the custom content flows through to assistant configs.
    if (uri.fsPath.endsWith('instructions.md')) {
      const workspaceRoot = getWorkspaceRoot();
      if (workspaceRoot) {
        try {
          const mode = await getInstructionsModeSetting(workspaceRoot, channel);
          if (mode === 'custom') {
            channel.appendLine(
              '[Instructions] Custom instructions.md changed — regenerating instruction files',
            );
            await emitInstructionFilesOnlyViaEmitters(workspaceRoot, channel);
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

  // AI assistant instruction files
  const instructionFilesWatcher = vscode.workspace.createFileSystemWatcher('**/{AGENTS,CLAUDE}.md');
  instructionFilesWatcher.onDidCreate(() => debouncedInstructionUpdate(false));
  instructionFilesWatcher.onDidDelete(() => debouncedInstructionUpdate(true));
  context.subscriptions.push(instructionFilesWatcher);

  // Copilot and Cursor config locations
  const assistantConfigWatcher = vscode.workspace.createFileSystemWatcher(
    '**/{.github/copilot-instructions.md,.cursor/**,.cursorrules}',
  );
  assistantConfigWatcher.onDidCreate(() => debouncedInstructionUpdate(false));
  assistantConfigWatcher.onDidDelete(() => debouncedInstructionUpdate(true));
  context.subscriptions.push(assistantConfigWatcher);
}

// =====================================================================
// Command Implementations
// =====================================================================

/**
 * Configure AI Assistants — shows a QuickPick for assistant selection,
 * then generates KB + instruction files.
 */
async function handleConfigureAssistants(
  context: vscode.ExtensionContext,
  state: AspectCodeState,
  outputChannel: vscode.OutputChannel,
  onStatusBarUpdate?: () => Promise<void>,
): Promise<void> {
  try {
    const perfEnabled = vscode.workspace
      .getConfiguration()
      .get<boolean>('aspectcode.devLogs', false);
    const tStart = Date.now();
    if (perfEnabled) outputChannel.appendLine('[Perf][Assistants][configure] start');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    const workspaceRoot = workspaceFolders[0].uri;

    // Detect existing assistants
    const tDetect = Date.now();
    const detected = await detectAssistants(workspaceRoot);
    if (perfEnabled) {
      outputChannel.appendLine(
        `[Perf][Assistants][configure] detectAssistants tookMs=${Date.now() - tDetect}`,
      );
    }
    outputChannel.appendLine(`[Assistants] Detected: ${Array.from(detected).join(', ') || 'none'}`);

    interface AssistantPickItem extends vscode.QuickPickItem {
      id: AssistantId;
    }

    const items: AssistantPickItem[] = [
      {
        id: 'copilot',
        label: '$(github) GitHub Copilot',
        description: detected.has('copilot') ? '(detected)' : '',
        picked: detected.has('copilot'),
      },
      {
        id: 'cursor',
        label: '$(edit) Cursor',
        description: detected.has('cursor') ? '(detected)' : '',
        picked: detected.has('cursor'),
      },
      {
        id: 'claude',
        label: '$(comment) Claude Code',
        description: detected.has('claude') ? '(detected)' : '',
        picked: detected.has('claude'),
      },
      {
        id: 'other',
        label: '$(file) Other (AGENTS.md)',
        description: detected.has('other') ? '(detected)' : '',
        picked: detected.has('other'),
      },
    ];

    if (perfEnabled) outputChannel.appendLine('[Perf][Assistants][configure] showing QuickPick');
    const tPick = Date.now();
    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: 'Select AI assistants to configure Aspect Code for',
    });

    if (perfEnabled) {
      outputChannel.appendLine(
        `[Perf][Assistants][configure] QuickPick resolved tookMs=${Date.now() - tPick} pickedCount=${selected?.length ?? 0}`,
      );
    }

    if (!selected) {
      // User cancelled
      return;
    }

    const selectedIds = new Set(selected.map((item) => item.id));

    if (selectedIds.size > 0) {
      // Mark as configured (global, one-time)
      if (!context.globalState.get<boolean>('aspectcode.assistants.configured', false)) {
        await context.globalState.update('aspectcode.assistants.configured', true);
      }

      const assistantsOverride: AssistantsOverride = {
        copilot: selectedIds.has('copilot'),
        cursor: selectedIds.has('cursor'),
        claude: selectedIds.has('claude'),
        other: selectedIds.has('other'),
      };

      if (perfEnabled) {
        outputChannel.appendLine('[Perf][Assistants][configure] executing generate');
      }

      // Generate KB + instruction files with the selected assistants
      try {
        await handleGenerate(state, outputChannel, context, assistantsOverride, onStatusBarUpdate);
        if (perfEnabled) {
          outputChannel.appendLine('[Perf][Assistants][configure] generate resolved');
        }
      } catch (err) {
        outputChannel.appendLine(`[Assistants] generate failed: ${err}`);
        throw err;
      }

      // Write settings AFTER files are successfully created
      const tCfg = Date.now();
      await updateAspectSettings(workspaceRoot, {
        assistants: assistantsOverride,
        excludeDirectories: { always: [], never: [] },
      });
      if (perfEnabled) {
        outputChannel.appendLine(
          `[Perf][Assistants][configure] settings update tookMs=${Date.now() - tCfg}`,
        );
      }

      outputChannel.appendLine(
        `[Assistants] Configuration updated: ${Array.from(selectedIds).join(', ')}`,
      );
    }

    if (perfEnabled) {
      outputChannel.appendLine(`[Perf][Assistants][configure] end tookMs=${Date.now() - tStart}`);
    }
  } catch (error) {
    outputChannel.appendLine(`[Assistants] Error: ${error}`);
    vscode.window.showErrorMessage(`Failed to configure assistants: ${error}`);
  }
}

/**
 * Emit instruction files via CLI (preferred) or in-process fallback.
 */
async function emitInstructionFilesOnlyViaEmitters(
  workspaceRoot: vscode.Uri,
  outputChannel: vscode.OutputChannel,
  assistantsOverride?: AssistantsOverride,
): Promise<number> {
  const mode = await getInstructionsModeSetting(workspaceRoot, outputChannel);
  const assistants =
    assistantsOverride ?? (await getAssistantsSettings(workspaceRoot, outputChannel));

  // ── Try CLI subprocess first ──────────────────────────────
  const cliResult = await cliGenerateWithInstructions(workspaceRoot.fsPath, assistants, {
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
    assistants,
  });

  outputChannel.appendLine(
    `[Instructions] In-process emitters updated ${result.filesWritten.length} file(s) (mode=${mode})`,
  );

  return result.filesWritten.length;
}

/**
 * Unified generate command.
 * Generates KB files (if missing) and instruction files.
 * Uses fully local analysis (tree-sitter + dependency analysis) — no server required.
 *
 * @param assistantsOverride If provided, uses these values instead of saved settings.
 */
async function handleGenerate(
  state: AspectCodeState,
  outputChannel: vscode.OutputChannel,
  context?: vscode.ExtensionContext,
  assistantsOverride?: AssistantsOverride,
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

    // Generate instruction files (marker-based, idempotent)
    const tGen = Date.now();
    await emitInstructionFilesOnlyViaEmitters(workspaceRoot, outputChannel, assistantsOverride);
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
 * Optimize AGENTS.md instructions via LLM.
 * Delegates to the CLI `optimize` command.
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

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Aspect Code: Optimizing instructions…',
      cancellable: true,
    },
    async (_progress, token) => {
      outputChannel.appendLine('[Optimize] Starting LLM optimization…');

      const result = await cliOptimize(root, {
        outputChannel,
        token,
      });

      if (result.exitCode === 0 && result.data) {
        const { iterations, elapsedMs } = result.data;
        const seconds = ((elapsedMs ?? 0) / 1000).toFixed(1);
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
