import * as path from 'path';
import { SUPPORTED_EXTENSIONS } from '@aspectcode/core';
import type { CliFlags, CommandContext, CommandResult } from '../cli';
import { ExitCode } from '../cli';
import type { AspectCodeConfig } from '../config';
import { fmt } from '../logger';
import { runGenerate } from './generate';

export type WatchMode = 'manual' | 'onChange' | 'idle';

const ON_CHANGE_DEBOUNCE_MS = 2000;
const IDLE_DEBOUNCE_MS = 30000;

const IGNORED_SEGMENTS = [
  '/node_modules/',
  '/.git/',
  '/dist/',
  '/build/',
  '/target/',
  '/coverage/',
  '/.next/',
  '/__pycache__/',
  '/.venv/',
  '/venv/',
  '/.pytest_cache/',
  '/.mypy_cache/',
  '/.tox/',
  '/htmlcov/',
];

export function resolveWatchMode(
  flags: CliFlags,
  config: AspectCodeConfig | undefined,
): WatchMode {
  return flags.mode ?? config?.updateRate ?? 'onChange';
}

function isSupportedSourceFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

function isIgnoredPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return IGNORED_SEGMENTS.some((seg) => normalized.includes(seg));
}

export async function runWatch(ctx: CommandContext): Promise<CommandResult> {
  const { root, flags, config, log } = ctx;
  const chokidarModule = await import('chokidar');
  // Handle both ESM default export and CJS module shapes
  const chokidar = chokidarModule.default ?? chokidarModule;
  const mode = resolveWatchMode(flags, config);
  const exts = SUPPORTED_EXTENSIONS.map((ext) => ext.slice(1)).join(',');

  log.info(`Workspace: ${fmt.cyan(root)}`);
  log.info(`Mode:      ${fmt.cyan(mode)}`);
  log.info(`Watching:  ${fmt.dim(`**/*.{${exts}}`)}`);
  log.info(fmt.dim('No initial run. Waiting for file changes...'));
  log.blank();

  const watcher = chokidar.watch('.', {
    cwd: root,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
    ignored: (watchedPath: string) => {
      const abs = path.resolve(root, watchedPath);
      return isIgnoredPath(abs);
    },
  });

  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let pending = false;
  let stopped = false;

  const triggerGenerate = async (reason: string): Promise<void> => {
    if (stopped) return;

    if (running) {
      pending = true;
      log.debug(`[watch] generation already in progress; queued (${reason})`);
      return;
    }

    running = true;
    try {
      log.info(`${fmt.bold('watch')} trigger: ${reason}`);
      await runGenerate({ root, flags: { ...flags, listConnections: false, json: false }, config, log, positionals: [] });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error(`watch regeneration failed: ${msg}`);
    } finally {
      running = false;
      if (pending && !stopped) {
        pending = false;
        void triggerGenerate('queued changes');
      }
    }
  };

  const scheduleOnChange = (reason: string) => {
    if (mode === 'manual') {
      log.debug(`[watch] change detected (${reason}) but mode=manual`);
      return;
    }

    if (timer) {
      clearTimeout(timer);
    }

    const delay = mode === 'idle' ? IDLE_DEBOUNCE_MS : ON_CHANGE_DEBOUNCE_MS;
    timer = setTimeout(() => {
      timer = undefined;
      void triggerGenerate(reason);
    }, delay);
  };

  const onFsEvent = (eventType: string, eventPath: string) => {
    const abs = path.resolve(root, eventPath);
    if (!isSupportedSourceFile(abs) || isIgnoredPath(abs)) {
      return;
    }

    scheduleOnChange(`${eventType}: ${eventPath.replace(/\\/g, '/')}`);
  };

  watcher.on('add', (p) => onFsEvent('add', p));
  watcher.on('change', (p) => onFsEvent('change', p));
  watcher.on('unlink', (p) => onFsEvent('unlink', p));
  watcher.on('error', (e) => {
    log.error(`watcher error: ${String(e)}`);
  });

  await new Promise<void>((resolve) => {
    watcher.once('ready', () => resolve());
  });

  log.info(fmt.dim('Watcher ready.'));

  return await new Promise<CommandResult>((resolve) => {
    const shutdown = async (signal: string) => {
      if (stopped) return;
      stopped = true;

      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }

      log.blank();
      log.info(fmt.dim(`Stopping watch (${signal})...`));
      await watcher.close();
      resolve({ exitCode: ExitCode.OK });
    };

    const onSigInt = () => {
      void shutdown('SIGINT');
    };

    const onSigTerm = () => {
      void shutdown('SIGTERM');
    };

    process.once('SIGINT', onSigInt);
    process.once('SIGTERM', onSigTerm);
  });
}
