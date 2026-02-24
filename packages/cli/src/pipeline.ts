/**
 * aspectcode pipeline — the single pipeline that does everything.
 *
 * 1. Discover files → tree-sitter analysis
 * 2. Build KB in memory (architecture + map + context)
 * 3. Scan & read other AI tool instruction files as context
 * 4. If API key present → optimize via LLM → write AGENTS.md
 *    If no API key → write static AGENTS.md + warn
 * 5. If --kb flag → also write kb.md
 * 6. If not --once → watch for changes and repeat
 */

import * as path from 'path';
import { SUPPORTED_EXTENSIONS, analyzeRepoWithDependencies } from '@aspectcode/core';
import { createNodeEmitterHost } from '@aspectcode/emitters';
import type { RunContext } from './cli';
import { ExitCode } from './cli';
import type { ExitCodeValue } from './cli';
import { loadConfig } from './config';
import { fmt, createSpinner } from './logger';
import { loadWorkspaceFiles } from './workspace';
import { buildKbContent } from './kbBuilder';
import { readToolInstructions } from './toolIngestion';
import { writeAgentsMd, writeKbMd } from './writer';
import { tryOptimize } from './optimize';

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

// ── Single pipeline run ──────────────────────────────────────

async function runOnce(ctx: RunContext): Promise<ExitCodeValue> {
  const { root, flags, log } = ctx;
  const config = loadConfig(root);
  const startMs = Date.now();

  // ── 1. Discover & read files ──────────────────────────────
  const workspace = await loadWorkspaceFiles(root, config, log, { quiet: flags.quiet });
  if (workspace.discoveredPaths.length === 0) {
    log.warn('No source files found. Check your workspace or exclude patterns.');
    return ExitCode.ERROR;
  }

  // ── 2. Analyze ────────────────────────────────────────────
  const spinAnalyze = createSpinner('Analyzing…', { quiet: flags.quiet });
  const model = await analyzeRepoWithDependencies(
    root,
    workspace.relativeFiles,
    workspace.absoluteFiles,
    workspace.host,
  );
  spinAnalyze.stop(
    `Analyzed ${model.files.length} files, ${model.graph.edges.length} edges`,
  );

  // ── 3. Build KB content in memory ─────────────────────────
  const spinKb = createSpinner('Building knowledge base…', { quiet: flags.quiet });
  const kbContent = buildKbContent(model, root, workspace.relativeFiles);
  spinKb.stop('Knowledge base built');

  // ── 4. Read other AI tool instruction files ───────────────
  const host = createNodeEmitterHost();
  const toolInstructions = await readToolInstructions(host, root);
  if (toolInstructions.size > 0) {
    log.debug(`Read ${toolInstructions.size} AI tool instruction file(s) as context`);
  }

  // ── 5. Optimize or fallback ───────────────────────────────
  const agentsContent = await tryOptimize(ctx, kbContent, toolInstructions, config);

  // ── 6. Write AGENTS.md ────────────────────────────────────
  if (flags.dryRun) {
    log.info(fmt.bold('Dry run — proposed AGENTS.md:'));
    log.blank();
    console.log(agentsContent);
    log.blank();
  } else {
    await writeAgentsMd(host, root, agentsContent);
    const agentsPath = path.relative(root, path.join(root, 'AGENTS.md')).replace(/\\/g, '/');
    log.success(`${agentsPath} written`);
  }

  // ── 7. Optionally write kb.md ─────────────────────────────
  if (flags.kb && !flags.dryRun) {
    await writeKbMd(host, root, kbContent);
    log.success('kb.md written');
  }

  const elapsedMs = Date.now() - startMs;
  log.info(fmt.dim(`Done in ${(elapsedMs / 1000).toFixed(1)}s`));
  return ExitCode.OK;
}

// ── Pipeline entry point ─────────────────────────────────────

export async function runPipeline(ctx: RunContext): Promise<ExitCodeValue> {
  const { root, flags, log } = ctx;

  log.info(`${fmt.bold('aspectcode')} — ${fmt.cyan(root)}`);
  log.blank();

  // ── Initial run ──────────────────────────────────────────
  const code = await runOnce(ctx);
  if (code !== ExitCode.OK) return code;

  // ── --once: exit immediately ──────────────────────────────
  if (flags.once) return ExitCode.OK;

  // ── Watch mode ────────────────────────────────────────────
  log.blank();
  log.info(fmt.dim('Watching for changes… (Ctrl+C to stop)'));

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
      await runOnce(ctx);
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
