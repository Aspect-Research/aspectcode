/**
 * aspectcode pipeline — the single pipeline that does everything.
 *
 * 1. Discover files → tree-sitter analysis
 * 2. Build KB in memory (architecture + map + context)
 * 3. Scan & read other AI tool instruction files as context
 * 4. Write static-template AGENTS.md for immediate feedback
 * 5. If API key present → LLM generates AGENTS.md from KB → overwrite
 *    If no API key → keep static AGENTS.md + warn
 * 6. If --kb flag → also write kb.md
 * 7. If not --once → watch for changes and repeat
 */

import * as fs from 'fs';
import * as path from 'path';
import { SUPPORTED_EXTENSIONS, analyzeRepoWithDependencies } from '@aspectcode/core';
import { createNodeEmitterHost, generateCanonicalContentForMode } from '@aspectcode/emitters';
import type { RunContext } from './cli';
import { ExitCode } from './cli';
import type { ExitCodeValue } from './cli';
import { loadConfig, saveConfig } from './config';
import { fmt } from './logger';
import { loadWorkspaceFiles } from './workspace';
import { buildKbContent } from './kbBuilder';
import { readToolInstructions } from './toolIngestion';
import { writeAgentsMd, writeKbMd, hasMarkers } from './writer';
import type { OwnershipMode } from './writer';
import { tryOptimize } from './optimize';
import { processComplaints } from './complaintProcessor';
import { selectPrompt } from './ui/prompts';
import { store } from './ui/store';
import { summarizeContent } from './summary';
import { diffSummary } from './diffSummary';

// ── Watch constants ──────────────────────────────────────────

const DEBOUNCE_MS = 2000;

const IGNORED_SEGMENTS = [
  '/node_modules/', '/.git/', '/dist/', '/build/', '/target/',
  '/coverage/', '/.next/', '/__pycache__/', '/.venv/', '/venv/',
  '/.pytest_cache/', '/.mypy_cache/', '/.tox/', '/htmlcov/',
];

function isIgnoredPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return IGNORED_SEGMENTS.some((seg) => normalized.includes(seg));
}

function isSupportedSourceFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

// ── Single pipeline run result ───────────────────────────────

interface RunOnceResult {
  code: ExitCodeValue;
  /** KB content from this run (used by complaint processor). */
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
  const configPath = path.join(root, 'aspectcode.json');
  if (!fs.existsSync(agentsPath) && !fs.existsSync(configPath)) {
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

  // ── 5. Write static-template AGENTS.md for immediate feedback ─
  //    Written to disk right away so the user sees output early,
  //    even before the LLM generation finishes.
  const baseContent = generateCanonicalContentForMode('safe', kbContent.length > 0);
  if (!flags.dryRun) {
    await writeAgentsMd(host, root, baseContent, ownership);
    store.addOutput('AGENTS.md written (base)');
    log.debug('Base AGENTS.md written from static analysis');
  }

  // ── 6. LLM generation or static fallback ───────────────
  store.setPhase('optimizing');
  const optimizeResult = await tryOptimize(ctx, kbContent, toolInstructions, config, baseContent);

  // ── 7. Write LLM-generated AGENTS.md ───────────────────
  store.setPhase('writing');
  if (flags.dryRun) {
    log.info(fmt.bold('Dry run — proposed AGENTS.md:'));
    log.blank();
    log.info(optimizeResult.content);
    log.blank();
  } else {
    // Compute diff before overwriting (for watch-mode change summary)
    let previousContent: string | undefined;
    try {
      if (fs.existsSync(agentsPath)) {
        previousContent = fs.readFileSync(agentsPath, 'utf-8');
      }
    } catch { /* ignore read errors */ }

    await writeAgentsMd(host, root, optimizeResult.content, ownership);
    const modeLabel = ownership === 'section' ? ' (section)' : '';
    const verb = optimizeResult.reasoning.length > 0 ? 'generated' : 'written';
    store.addOutput(`AGENTS.md ${verb}${modeLabel}`);
    log.success(`AGENTS.md ${verb}${modeLabel}`);

    // Diff summary (skip on first write when previous was just the base template)
    if (previousContent !== undefined && previousContent !== baseContent) {
      const diff = diffSummary(previousContent, optimizeResult.content);
      store.setDiffSummary(diff);
    }

    // Content summary for the dashboard
    const summary = summarizeContent(optimizeResult.content);
    store.setSummary(summary);
  }

  // ── 8. Optionally write kb.md ─────────────────────────────
  if (flags.kb && !flags.dryRun) {
    await writeKbMd(host, root, kbContent);
    store.addOutput('kb.md written');
    log.success('kb.md written');
  }

  const elapsedMs = Date.now() - startMs;
  store.setElapsed(`${(elapsedMs / 1000).toFixed(1)}s`);
  store.setPhase('done');
  log.info(fmt.dim(`Done in ${(elapsedMs / 1000).toFixed(1)}s`));
  return { code: ExitCode.OK, kbContent };
}

// ── Pipeline entry point ─────────────────────────────────────

/**
 * Resolve AGENTS.md ownership mode.
 *
 * Called from main() BEFORE the ink dashboard is mounted, because
 * the interactive prompt uses raw stdin which conflicts with ink's useInput.
 */
export async function resolveOwnership(root: string): Promise<OwnershipMode> {
  const config = loadConfig(root);
  if (config?.ownership) return config.ownership;

  try {
    const fs = await import('fs');
    const agentsPath = path.join(root, 'AGENTS.md');
    if (fs.existsSync(agentsPath)) {
      const existing = fs.readFileSync(agentsPath, 'utf-8');
      if (hasMarkers(existing)) return 'section';

      const idx = await selectPrompt(
        'AGENTS.md already exists. How should AspectCode manage it?',
        ['Replace entire file (full ownership)', 'Own a section (preserve your content)'],
        0,
      );
      const ownership: OwnershipMode = idx === 1 ? 'section' : 'full';
      saveConfig(root, { ownership });
      return ownership;
    }
  } catch {
    // Non-interactive or read error — default to full
  }
  return 'full';
}

export async function runPipeline(ctx: RunContext): Promise<ExitCodeValue> {
  const { root, flags, log, ownership } = ctx;

  log.info(`${fmt.bold('aspectcode')} — ${fmt.cyan(root)}`);
  log.blank();

  // ── Initial run ──────────────────────────────────────────
  const result = await runOnce(ctx, ownership);
  if (result.code !== ExitCode.OK) return result.code;

  // Keep track of latest KB for complaint processing
  let latestKb = result.kbContent;

  // ── --once: process any queued complaints, then exit ──────
  if (flags.once) {
    if (store.state.complaintQueue.length > 0) {
      await processComplaints(ctx, ownership, latestKb);
    }
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

  const triggerRun = async (reason: string): Promise<void> => {
    if (stopped) return;
    if (running) { pending = true; return; }

    running = true;
    try {
      log.blank();
      log.info(`${fmt.bold('change detected:')} ${reason}`);
      store.setLastChange(reason);
      const runResult = await runOnce(ctx, ownership);
      if (runResult.kbContent) latestKb = runResult.kbContent;
      store.setPhase('watching');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`Pipeline failed: ${msg}`);
    } finally {
      running = false;
      if (pending && !stopped) {
        pending = false;
        void triggerRun('queued changes');
      }
    }
  };

  const onFsEvent = (eventType: string, eventPath: string) => {
    const abs = path.resolve(root, eventPath);
    if (!isSupportedSourceFile(abs) || isIgnoredPath(abs)) return;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void triggerRun(`${eventType}: ${eventPath.replace(/\\/g, '/')}`);
    }, DEBOUNCE_MS);
  };

  watcher.on('add', (p: string) => onFsEvent('add', p));
  watcher.on('change', (p: string) => onFsEvent('change', p));
  watcher.on('unlink', (p: string) => onFsEvent('unlink', p));
  watcher.on('error', (e: unknown) => log.error(`Watcher error: ${String(e)}`));

  await new Promise<void>((resolve) => watcher.once('ready', resolve));
  log.info(fmt.dim('Watcher ready.'));

  // ── Complaint polling — check for queued complaints periodically ──
  const COMPLAINT_POLL_MS = 500;
  const complaintPoll = setInterval(async () => {
    if (stopped || running || store.state.complaintQueue.length === 0) return;
    running = true;
    try {
      await processComplaints(ctx, ownership, latestKb);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Complaint processing failed: ${msg}`);
    } finally {
      running = false;
    }
  }, COMPLAINT_POLL_MS);

  return await new Promise<ExitCodeValue>((resolve) => {
    const shutdown = async (signal: string) => {
      if (stopped) return;
      stopped = true;
      clearInterval(complaintPoll);
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
