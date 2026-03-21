/**
 * aspectcode pipeline — the single pipeline that does everything.
 *
 * 1. Discover files → tree-sitter analysis
 * 2. Build KB in memory (architecture + map + context)
 * 3. Scan & read other AI tool instruction files as context
 * 4. Build KB-custom content from analysis
 * 5. If generate=true → LLM generates AGENTS.md (or static fallback)
 *    If generate=false → write KB-custom content only (skip LLM)
 * 6. If --kb flag → also write kb.md
 * 7. If not --once → watch for changes and repeat (always generate)
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
import { writeAgentsMd, writeKbMd, hasMarkers } from './writer';
import type { OwnershipMode } from './writer';
import { tryOptimize } from './optimize';
import { selectPrompt } from './ui/prompts';
import { store } from './ui/store';
import { summarizeContent } from './summary';
import { diffSummary } from './diffSummary';
import { updateRuntimeState } from './runtimeState';

// ── Watch constants ──────────────────────────────────────────

const DEBOUNCE_MS = 2000;

const IGNORED_SEGMENTS = [
  '/node_modules/', '/.git/', '/dist/', '/build/', '/target/',
  '/coverage/', '/.next/', '/__pycache__/', '/.venv/', '/venv/',
  '/.pytest_cache/', '/.mypy_cache/', '/.tox/', '/htmlcov/',
];

/** Check whether a path should be excluded from watch events. */
export function isIgnoredPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return IGNORED_SEGMENTS.some((seg) => normalized.includes(seg));
}

/** Check whether a file extension is one we analyze. */
export function isSupportedSourceFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

// ── Single pipeline run result ───────────────────────────────

interface RunOnceResult {
  code: ExitCodeValue;
  /** KB content from this run. */
  kbContent: string;
}

// ── Single pipeline run ──────────────────────────────────────

async function runOnce(ctx: RunContext, ownership: OwnershipMode): Promise<RunOnceResult> {
  const { root, flags, log } = ctx;
  const config = loadConfig(root);
  const startMs = Date.now();
  store.resetRun();
  store.setRunStartMs(startMs);
  store.addSetupNote(config ? 'config loaded' : 'no config');

  // ── First-run detection ───────────────────────────────────
  const agentsPath = path.join(root, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    store.setFirstRun(true);
  }

  // ── 1. Discover & read files ──────────────────────────────
  store.setPhase('discovering');
  const workspace = await loadWorkspaceFiles(root, config, log, { quiet: flags.quiet, spin: ctx.spin });
  if (workspace.discoveredPaths.length === 0) {
    log.warn('No source files found. Check your workspace or exclude patterns.');
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
  spinAnalyze.stop(
    `Analyzed ${model.files.length} files, ${model.graph.edges.length} edges`,
  );
  store.setStats(model.files.length, model.graph.edges.length);

  // ── 3. Build KB content in memory ─────────────────────────
  const spinKb = ctx.spin('Building knowledge base…', 'building-kb');
  const kbContent = buildKbContent(model, root, workspace.relativeFiles);
  spinKb.stop('Knowledge base built');

  // ── 4. Read other AI tool instruction files ───────────────
  const host = createNodeEmitterHost();
  const toolInstructions = await readToolInstructions(host, root);
  if (toolInstructions.size > 0) {
    const toolNames = [...toolInstructions.keys()].join(', ');
    store.addSetupNote(`context: ${toolNames}`);
    log.debug(`Read ${toolInstructions.size} AI tool instruction file(s) as context`);
  }

  // ── 5. Build base content from KB ──────────────────────────
  const baseContent = kbContent.length > 0
    ? generateKbCustomContent(kbContent, 'safe')
    : generateCanonicalContentForMode('safe', false);

  // ── 6. Generate or skip ────────────────────────────────────
  let finalContent = baseContent;

  if (ctx.generate) {
    // Write base immediately so user sees output before LLM finishes
    if (!flags.dryRun) {
      await writeAgentsMd(host, root, baseContent, ownership);
      store.addOutput('AGENTS.md written (base)');
      log.debug('Base AGENTS.md written from static analysis');
    }

    store.setPhase('optimizing');
    const optimizeResult = await tryOptimize(ctx, kbContent, toolInstructions, config, baseContent);
    finalContent = optimizeResult.content;

    // ── Write LLM-generated AGENTS.md ─────────────────────
    store.setPhase('writing');
    if (flags.dryRun) {
      log.info(fmt.bold('Dry run — proposed AGENTS.md:'));
      log.blank();
      log.info(finalContent);
      log.blank();
    } else {
      // Compute diff before overwriting (for watch-mode change summary)
      let previousContent: string | undefined;
      try {
        if (fs.existsSync(agentsPath)) {
          previousContent = fs.readFileSync(agentsPath, 'utf-8');
        }
      } catch { /* ignore read errors */ }

      await writeAgentsMd(host, root, finalContent, ownership);
      const modeLabel = ownership === 'section' ? ' (section)' : '';
      const verb = optimizeResult.reasoning.length > 0 ? 'generated' : 'written';
      store.addOutput(`AGENTS.md ${verb}${modeLabel}`);
      log.success(`AGENTS.md ${verb}${modeLabel}`);

      // Diff summary (skip on first write when previous was just the base template)
      if (previousContent !== undefined && previousContent !== baseContent) {
        const diff = diffSummary(previousContent, finalContent);
        store.setDiffSummary(diff);
      }

      // Content summary for the dashboard
      const summary = summarizeContent(finalContent);
      store.setSummary(summary);
    }
  } else {
    // Skip LLM — write KB-custom content only
    store.setPhase('writing');
    if (flags.dryRun) {
      log.info(fmt.bold('Dry run — proposed AGENTS.md (KB-custom):'));
      log.blank();
      log.info(baseContent);
      log.blank();
    } else {
      await writeAgentsMd(host, root, baseContent, ownership);
      store.addOutput('AGENTS.md written (KB-custom)');
      log.success('AGENTS.md written from static analysis');

      const summary = summarizeContent(baseContent);
      store.setSummary(summary);
    }
    store.addSetupNote('generation skipped');
  }

  // ── 7. Optionally write kb.md ─────────────────────────────
  if (flags.kb && !flags.dryRun) {
    await writeKbMd(host, root, kbContent);
    store.addOutput('kb.md written');
    log.success('kb.md written');
  }

  // ── 8. Persist runtime state for other modules ────────────
  updateRuntimeState({
    model,
    kbContent,
    agentsContent: finalContent,
    fileContents: workspace.relativeFiles,
  });

  const elapsedMs = Date.now() - startMs;
  store.setElapsed(`${(elapsedMs / 1000).toFixed(1)}s`);
  store.setPhase('done');
  log.info(fmt.dim(`Done in ${(elapsedMs / 1000).toFixed(1)}s`));
  return { code: ExitCode.OK, kbContent };
}

// ── Pipeline entry point ─────────────────────────────────────

/**
 * Resolve AGENTS.md ownership mode and whether to generate on this run.
 *
 * Called from main() BEFORE the ink dashboard is mounted, because
 * the interactive prompt uses raw stdin which conflicts with ink's useInput.
 */
export async function resolveRunMode(root: string): Promise<RunMode> {
  const config = loadConfig(root);

  // Config-driven ownership skips prompt but still generates
  if (config?.ownership) {
    return { ownership: config.ownership, generate: true };
  }

  try {
    const agentsPath = path.join(root, 'AGENTS.md');
    if (fs.existsSync(agentsPath)) {
      const existing = fs.readFileSync(agentsPath, 'utf-8');
      // Auto-detect section markers → continue in section mode
      if (hasMarkers(existing)) {
        return { ownership: 'section', generate: true };
      }
      // Existing file without markers → full control, skip generation
      return { ownership: 'full', generate: false };
    }
  } catch {
    // Read error — fall through to prompt
  }

  // No AGENTS.md → show 2-option prompt (default: full + generate)
  try {
    const idx = await selectPrompt(
      'How should AspectCode manage AGENTS.md?',
      [
        'Full control (replace entire file)',
        'Section control (preserve your content)',
      ],
      0,
    );
    const ownership = idx === 1 ? 'section' : 'full' as const;
    return { ownership, generate: true };
  } catch {
    // Non-interactive → default to full + generate
    return { ownership: 'full', generate: true };
  }
}

// ── File change event ────────────────────────────────────────

/** Describes a detected file-system change. */
export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink';
  /** Workspace-relative posix path. */
  path: string;
}

/**
 * Callback invoked when file changes are detected in watch mode.
 * Returns the action to take: 'full-pipeline' re-runs the entire
 * pipeline; future v2 will add 'evaluate' for lightweight checks.
 */
export type FileChangeHandler = (events: FileChangeEvent[]) => 'full-pipeline';

/** Default handler — always re-runs the full pipeline. */
const defaultChangeHandler: FileChangeHandler = () => 'full-pipeline';

export async function runPipeline(
  ctx: RunContext,
  onFileChange: FileChangeHandler = defaultChangeHandler,
): Promise<ExitCodeValue> {
  const { root, flags, log, ownership } = ctx;

  log.info(`${fmt.bold('aspectcode')} — ${fmt.cyan(root)}`);
  log.blank();

  // ── Initial run ──────────────────────────────────────────
  const result = await runOnce(ctx, ownership);

  // After first run, always generate on subsequent watch-triggered runs
  ctx.generate = true;
  if (result.code !== ExitCode.OK) return result.code;

  // ── --once: exit immediately ───────────────────────────────
  if (flags.once) {
    return ExitCode.OK;
  }

  // ── Watch mode ────────────────────────────────────────────
  log.blank();
  log.info(fmt.dim('Watching for changes… (Ctrl+C to stop)'));
  store.setPhase('watching');

  const chokidarModule = await import('chokidar');
  const chokidar = chokidarModule.default ?? chokidarModule;

  const watcher = chokidar.watch('.', {
    cwd: root,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    ignored: (watchedPath: string) => {
      const abs = path.resolve(root, watchedPath);
      return isIgnoredPath(abs);
    },
  });

  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let pending = false;
  let stopped = false;
  let pendingEvents: FileChangeEvent[] = [];

  const triggerRun = async (events: FileChangeEvent[]): Promise<void> => {
    if (stopped) return;
    if (running) { pending = true; return; }

    const action = onFileChange(events);

    running = true;
    try {
      const reason = events.map((e) => `${e.type}: ${e.path}`).join(', ');
      log.blank();
      log.info(`${fmt.bold('change detected:')} ${reason}`);
      store.setLastChange(reason);

      if (action === 'full-pipeline') {
        await runOnce(ctx, ownership);
      }

      store.setPhase('watching');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`Pipeline failed: ${msg}`);
    } finally {
      running = false;
      if (pending && !stopped) {
        pending = false;
        const queued = pendingEvents.splice(0);
        void triggerRun(queued.length > 0 ? queued : [{ type: 'change', path: '(queued)' }]);
      }
    }
  };

  const onFsEvent = (eventType: 'add' | 'change' | 'unlink', eventPath: string) => {
    const abs = path.resolve(root, eventPath);
    if (!isSupportedSourceFile(abs) || isIgnoredPath(abs)) return;

    const posixPath = eventPath.replace(/\\/g, '/');
    pendingEvents.push({ type: eventType, path: posixPath });

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const events = pendingEvents.splice(0);
      void triggerRun(events);
    }, DEBOUNCE_MS);
  };

  watcher.on('add', (p: string) => onFsEvent('add', p));
  watcher.on('change', (p: string) => onFsEvent('change', p));
  watcher.on('unlink', (p: string) => onFsEvent('unlink', p));
  watcher.on('error', (e: unknown) => log.error(`Watcher error: ${String(e)}`));

  await new Promise<void>((resolve) => watcher.once('ready', resolve));
  log.info(fmt.dim('Watcher ready.'));

  return await new Promise<ExitCodeValue>((resolve) => {
    const shutdown = async (signal: string) => {
      if (stopped) return;
      stopped = true;
      if (timer) { clearTimeout(timer); timer = undefined; }
      log.blank();
      log.info(fmt.dim(`Stopping (${signal})…`));
      await watcher.close();
      resolve(ExitCode.OK);
    };

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  });
}
