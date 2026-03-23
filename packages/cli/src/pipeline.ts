/**
 * aspectcode pipeline — analyze, generate, watch, evaluate.
 *
 * v2: After generating AGENTS.md, watch mode evaluates individual file
 * changes in real time. Full probe-and-refine runs on first startup
 * or when the user presses 'r'.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SUPPORTED_EXTENSIONS, analyzeRepoWithDependencies } from '@aspectcode/core';
import { createNodeEmitterHost, generateCanonicalContentForMode, generateKbCustomContent } from '@aspectcode/emitters';
import type { RunContext, RunMode } from './cli';
import { ExitCode } from './cli';
import type { ExitCodeValue } from './cli';
import { loadConfig } from './config';
import { fmt } from './logger';
import { loadWorkspaceFiles } from './workspace';
import { buildKbContent } from './kbBuilder';
import { readToolInstructions } from './toolIngestion';
import { writeAgentsMd, hasMarkers } from './writer';
import type { OwnershipMode } from './writer';
import { tryOptimize } from './optimize';
import { selectPrompt } from './ui/prompts';
import { store } from './ui/store';
import { summarizeContent } from './summary';
import { diffSummary } from './diffSummary';
import { updateRuntimeState, getRuntimeState } from './runtimeState';
import { loadPreferences, savePreferences, addPreference } from './preferences';
import type { PreferencesStore } from './preferences';
import { evaluateChange, trackChange, getRecentChanges } from './changeEvaluator';
import type { ChangeAssessment } from './changeEvaluator';

// ── Constants ────────────────────────────────────────────────

const EVAL_DEBOUNCE_MS = 500;

const IGNORED_SEGMENTS = [
  '/node_modules/', '/.git/', '/dist/', '/build/', '/target/',
  '/coverage/', '/.next/', '/__pycache__/', '/.venv/', '/venv/',
  '/.pytest_cache/', '/.mypy_cache/', '/.tox/', '/htmlcov/',
  '/.aspectcode/',
];

export function isIgnoredPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return IGNORED_SEGMENTS.some((seg) => normalized.includes(seg));
}

export function isSupportedSourceFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

// ── File watcher ─────────────────────────────────────────────

export function createFileWatcher(
  root: string,
  onEvent: (type: 'add' | 'change' | 'unlink', relativePosixPath: string) => void,
): fs.FSWatcher {
  return fs.watch(root, { recursive: true }, (event, filename) => {
    if (!filename) return;
    const posixPath = filename.replace(/\\/g, '/');
    const abs = path.resolve(root, filename);
    if (!isSupportedSourceFile(abs) || isIgnoredPath(abs)) return;
    const type = event === 'rename'
      ? (fs.existsSync(abs) ? 'add' : 'unlink')
      : 'change';
    onEvent(type, posixPath);
  });
}

// ── File change event ────────────────────────────────────────

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink';
  path: string;
}

// ── Single pipeline run ──────────────────────────────────────

interface RunOnceResult {
  code: ExitCodeValue;
  kbContent: string;
}

/**
 * @param probeAndRefine  Run probe-based evaluation after LLM generation.
 *                        Only on first run or when user presses 'r'.
 */
async function runOnce(
  ctx: RunContext,
  ownership: OwnershipMode,
  probeAndRefine = false,
  preferences?: PreferencesStore,
): Promise<RunOnceResult> {
  const { root, flags, log } = ctx;
  const config = loadConfig(root);
  const startMs = Date.now();
  store.resetRun();
  store.setRunStartMs(startMs);
  if (config) store.addSetupNote('using config file');

  const agentsPath = path.join(root, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    store.setFirstRun(true);
  }

  // ── 1. Discover & read files ──────────────────────────────
  store.setPhase('discovering');
  const workspace = await loadWorkspaceFiles(root, config, log, { quiet: flags.quiet, spin: ctx.spin });
  if (workspace.discoveredPaths.length === 0) {
    log.warn('No source files found.');
    return { code: ExitCode.ERROR, kbContent: '' };
  }

  // ── 2. Analyze ────────────────────────────────────────────
  const spinAnalyze = ctx.spin('Analyzing…', 'analyzing');
  const model = await analyzeRepoWithDependencies(
    root,
    workspace.relativeFiles,
    workspace.absoluteFiles,
    workspace.host,
  );
  spinAnalyze.stop(`Analyzed ${model.files.length} files, ${model.graph.edges.length} edges`);
  store.setStats(model.files.length, model.graph.edges.length);

  // ── 3. Build KB ───────────────────────────────────────────
  const spinKb = ctx.spin('Building knowledge base…', 'building-kb');
  const kbContent = buildKbContent(model, root, workspace.relativeFiles);
  spinKb.stop('Knowledge base built');

  // ── 4. Read tool instruction files ────────────────────────
  const host = createNodeEmitterHost();
  const toolInstructions = await readToolInstructions(host, root);
  if (toolInstructions.size > 0) {
    store.addSetupNote(`context: ${[...toolInstructions.keys()].join(', ')}`);
  }

  // ── 5. Build base content ─────────────────────────────────
  const baseContent = kbContent.length > 0
    ? generateKbCustomContent(kbContent, 'safe')
    : generateCanonicalContentForMode('safe', false);

  // ── 6. Generate or skip ───────────────────────────────────
  let finalContent = baseContent;

  if (ctx.generate) {
    if (!flags.dryRun) {
      await writeAgentsMd(host, root, baseContent, ownership);
      store.addOutput('AGENTS.md written (base)');
    }

    store.setPhase('optimizing');
    const optimizeResult = await tryOptimize(
      ctx, kbContent, toolInstructions, config, baseContent, probeAndRefine, preferences,
    );
    finalContent = optimizeResult.content;

    store.setPhase('writing');
    if (flags.dryRun) {
      log.info(fmt.bold('Dry run — proposed AGENTS.md:'));
      log.blank();
      log.info(finalContent);
    } else {
      let previousContent: string | undefined;
      try {
        if (fs.existsSync(agentsPath)) {
          previousContent = fs.readFileSync(agentsPath, 'utf-8');
        }
      } catch { /* ignore */ }

      await writeAgentsMd(host, root, finalContent, ownership);
      const modeLabel = ownership === 'section' ? ' (section)' : '';
      const verb = optimizeResult.reasoning.length > 0 ? 'generated' : 'written';
      store.addOutput(`AGENTS.md ${verb}${modeLabel}`);

      if (previousContent !== undefined && previousContent !== baseContent) {
        store.setDiffSummary(diffSummary(previousContent, finalContent));
      }
      store.setSummary(summarizeContent(finalContent));
    }
  } else {
    store.setPhase('writing');
    if (flags.dryRun) {
      log.info(fmt.bold('Dry run — proposed AGENTS.md (KB-custom):'));
      log.blank();
      log.info(baseContent);
    } else {
      await writeAgentsMd(host, root, baseContent, ownership);
      store.addOutput('AGENTS.md written (KB-custom)');
      store.setSummary(summarizeContent(baseContent));
    }
  }

  // ── 7. Persist runtime state ───────────────────────────────
  updateRuntimeState({
    model,
    kbContent,
    agentsContent: finalContent,
    fileContents: workspace.relativeFiles,
  });

  const elapsedMs = Date.now() - startMs;
  store.setElapsed(`${(elapsedMs / 1000).toFixed(1)}s`);
  store.setPhase('done');
  return { code: ExitCode.OK, kbContent };
}

// ── Resolve ownership mode ───────────────────────────────────

export async function resolveRunMode(root: string): Promise<RunMode> {
  const config = loadConfig(root);
  if (config?.ownership) {
    return { ownership: config.ownership, generate: true };
  }

  try {
    const agentsPath = path.join(root, 'AGENTS.md');
    if (fs.existsSync(agentsPath)) {
      const existing = fs.readFileSync(agentsPath, 'utf-8');
      if (hasMarkers(existing)) return { ownership: 'section', generate: true };
      return { ownership: 'full', generate: false };
    }
  } catch { /* fall through */ }

  try {
    const idx = await selectPrompt(
      'How should AspectCode manage AGENTS.md?',
      ['Full control (replace entire file)', 'Section control (preserve your content)'],
      0,
    );
    return { ownership: idx === 1 ? 'section' : 'full', generate: true };
  } catch {
    return { ownership: 'full', generate: true };
  }
}

// ── Assessment action handler ────────────────────────────────

export interface AssessmentAction {
  type: 'dismiss' | 'confirm' | 'skip' | 'probe-and-refine';
  assessment?: ChangeAssessment;
}

function handleAssessmentAction(
  action: AssessmentAction,
  prefs: PreferencesStore,
  root: string,
): PreferencesStore {
  if (!action.assessment) return prefs;
  const a = action.assessment;
  const dir = path.dirname(a.file) + '/';

  if (action.type === 'dismiss') {
    // Dismiss → directory-scoped allow (broad: "this is fine here")
    prefs = addPreference(prefs, {
      rule: a.rule,
      pattern: a.message,
      disposition: 'allow',
      directory: dir,
      details: a.details,
    });
    savePreferences(root, prefs);
    store.setPreferenceCount(prefs.preferences.length);
    store.setLearnedMessage(`Learned: ${a.rule} ok in ${dir}`);
    store.resolveAssessment('dismiss');
  } else if (action.type === 'confirm') {
    // Confirm → file-scoped deny (specific: "this matters for this file")
    prefs = addPreference(prefs, {
      rule: a.rule,
      pattern: a.message,
      disposition: 'deny',
      file: a.file,
      directory: dir,
      details: a.details,
      suggestion: a.suggestion,
    });
    savePreferences(root, prefs);
    store.setPreferenceCount(prefs.preferences.length);
    store.setLearnedMessage(`Confirmed: ${a.rule} matters for ${a.file}`);
    store.setRecommendProbe(true);
    store.resolveAssessment('confirm');
  } else if (action.type === 'skip') {
    store.advanceAssessment();
  }

  return prefs;
}

// ── Main pipeline ────────────────────────────────────────────

export async function runPipeline(ctx: RunContext): Promise<ExitCodeValue> {
  const { root, flags, log, ownership } = ctx;

  log.info(`${fmt.bold('aspectcode')} — ${fmt.cyan(root)}`);
  log.blank();

  // ── Initial run (with probe and refine) ────────────────────
  const result = await runOnce(ctx, ownership, true);
  ctx.generate = true;
  if (result.code !== ExitCode.OK) return result.code;

  if (flags.once) return ExitCode.OK;

  // ── Load preferences ───────────────────────────────────────
  let prefs = loadPreferences(root);
  store.setPreferenceCount(prefs.preferences.length);

  // ── Watch mode with real-time evaluation ───────────────────
  log.blank();
  store.setPhase('watching');

  let evalTimer: NodeJS.Timeout | undefined;
  let pipelineRunning = false;
  let stopped = false;
  let pendingEvalEvents: FileChangeEvent[] = [];

  // ── Probe and refine (manual via 'r' key) ──────────────────

  const doProbeAndRefine = async (): Promise<void> => {
    if (stopped || pipelineRunning) return;
    pipelineRunning = true;
    if (evalTimer) { clearTimeout(evalTimer); evalTimer = undefined; }
    pendingEvalEvents.length = 0;
    store.setRecommendProbe(false);
    try {
      await runOnce(ctx, ownership, true, prefs);
      prefs = loadPreferences(root);
      store.setPreferenceCount(prefs.preferences.length);
      store.setPhase('watching');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Probe and refine failed: ${msg}`);
    } finally {
      pipelineRunning = false;
    }
  };

  // ── Evaluate file changes (fast, no LLM) ──────────────────

  const RECOMMEND_THRESHOLD = 10;

  const evaluateEvents = (events: FileChangeEvent[]): void => {
    const state = getRuntimeState();
    if (!state.model || !state.agentsContent) return;

    for (const event of events) {
      trackChange(event);

      // Track add vs change counts
      if (event.type === 'add') store.incrementAddCount();
      else if (event.type === 'change') store.incrementChangeCount();

      if (event.type !== 'unlink') {
        try {
          const absPath = path.join(root, event.path);
          if (fs.existsSync(absPath)) {
            const content = fs.readFileSync(absPath, 'utf-8');
            state.fileContents?.set(event.path, content);
          }
        } catch { /* skip unreadable files */ }
      }

      const assessments = evaluateChange(event, {
        model: state.model,
        agentsContent: state.agentsContent,
        preferences: prefs,
        recentChanges: getRecentChanges(),
        fileContents: state.fileContents,
      });

      store.pushAssessments(assessments);

      // Change flash for clean changes
      const hasNonOk = assessments.some((a) => a.type !== 'ok');
      if (!hasNonOk) {
        store.setLastChangeFlash(`${event.path} — ok`);
      }
    }

    // Auto-recommend probe-and-refine
    const stats = store.state.assessmentStats;
    if (stats.changes >= RECOMMEND_THRESHOLD && !store.state.recommendProbe) {
      store.setRecommendProbe(true);
    }
  };

  // ── File change handler ────────────────────────────────────

  const onFsEvent = (eventType: 'add' | 'change' | 'unlink', eventPath: string) => {
    if (pipelineRunning) return;
    const abs = path.resolve(root, eventPath);
    if (!isSupportedSourceFile(abs) || isIgnoredPath(abs)) return;

    const posixPath = eventPath.replace(/\\/g, '/');
    pendingEvalEvents.push({ type: eventType, path: posixPath });

    if (evalTimer) clearTimeout(evalTimer);
    evalTimer = setTimeout(() => {
      evalTimer = undefined;
      const events = pendingEvalEvents.splice(0);
      evaluateEvents(events);
    }, EVAL_DEBOUNCE_MS);
  };

  // ── Start watcher (must be after onFsEvent is defined) ─────

  const watcher = createFileWatcher(root, onFsEvent);
  watcher.on('error', (e: unknown) => log.error(`Watcher error: ${String(e)}`));

  // ── Expose action handler for keyboard input ───────────────
  const onAssessmentAction = (action: AssessmentAction): void => {
    if (action.type === 'probe-and-refine') {
      void doProbeAndRefine();
      return;
    }
    prefs = handleAssessmentAction(action, prefs, root);
  };

  (store as any)._onAssessmentAction = onAssessmentAction;

  return await new Promise<ExitCodeValue>((resolve) => {
    const shutdown = async (signal: string) => {
      if (stopped) return;
      stopped = true;
      if (evalTimer) { clearTimeout(evalTimer); evalTimer = undefined; }
      log.blank();
      log.info(fmt.dim(`Stopping (${signal})…`));
      await watcher.close();
      resolve(ExitCode.OK);
    };

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  });
}
