import * as fs from 'fs';
import * as path from 'path';
import { SUPPORTED_EXTENSIONS } from '@aspectcode/core';
import type { CliFlags, CommandContext, CommandResult } from '../cli';
import { ExitCode } from '../cli';
import type { AspectCodeConfig } from '../config';
import { fmt } from '../logger';
import { runGenerate } from './generate';
import { runOptimize } from './optimize';

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

  // ── Daemon management subcommands ─────────────────────────
  if (flags.watchStatus) {
    return handleWatchStatus(root, log);
  }

  if (flags.watchStop) {
    return handleWatchStop(root, log);
  }

  const chokidarModule = await import('chokidar');
  // Handle both ESM default export and CJS module shapes
  const chokidar = chokidarModule.default ?? chokidarModule;
  const mode = resolveWatchMode(flags, config);
  const exts = SUPPORTED_EXTENSIONS.map((ext) => ext.slice(1)).join(',');

  log.info(`Workspace: ${fmt.cyan(root)}`);
  log.info(`Mode:      ${fmt.cyan(mode)}`);
  log.info(`Watching:  ${fmt.dim(`**/*.{${exts}}`)}`);

  // ── Write PID file for daemon management ──────────────────
  const pidPath = path.join(root, '.aspect', '.pid');
  try {
    await fs.promises.mkdir(path.join(root, '.aspect'), { recursive: true });
    await fs.promises.writeFile(pidPath, String(process.pid), 'utf-8');
  } catch {
    // Non-critical — daemon management features won't work
  }

  // Cleanup PID on exit
  const cleanupPid = () => {
    try { fs.unlinkSync(pidPath); } catch { /* ignore */ }
  };
  process.on('exit', cleanupPid);

  // ── Initial run: generate if KB is stale/missing ──────────
  const aspectDir = path.join(root, '.aspect');
  const kbExists = fs.existsSync(path.join(aspectDir, 'architecture.md'));
  if (!kbExists) {
    log.info(fmt.bold('Initial run:') + ' KB not found, generating…');
    await runGenerate({ root, flags: { ...flags, listConnections: false, json: false }, config, log, positionals: [] });

    if (flags.autoOptimize || config?.autoOptimize) {
      log.info(fmt.bold('Initial run:') + ' auto-optimizing instructions…');
      await runOptimize({ root, flags: { ...flags, json: false }, config, log, positionals: [] });
    }
    log.blank();
  } else {
    log.info(fmt.dim('KB exists. Waiting for file changes…'));
  }
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

      // Auto-optimize after generate if enabled (flag or config)
      if (flags.autoOptimize || config?.autoOptimize) {
        log.info(`${fmt.bold('watch')} auto-optimizing instructions…`);
        await runOptimize({ root, flags: { ...flags, json: false }, config, log, positionals: [] });
      }
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

// ── Daemon management helpers ────────────────────────────────

const PID_FILE = '.aspect/.pid';

function readPidFile(root: string): number | null {
  try {
    const pidPath = path.join(root, PID_FILE);
    const content = fs.readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check if alive
    return true;
  } catch {
    return false;
  }
}

function handleWatchStatus(
  root: string,
  log: ReturnType<typeof import('../logger').createLogger>,
): CommandResult {
  const pid = readPidFile(root);
  if (pid && isProcessRunning(pid)) {
    log.info(`Watch daemon running (PID ${pid})`);
    return { exitCode: ExitCode.OK };
  }
  log.info('Watch daemon is not running');
  // Clean up stale PID file
  if (pid) {
    try { fs.unlinkSync(path.join(root, PID_FILE)); } catch { /* ignore */ }
  }
  return { exitCode: ExitCode.ERROR };
}

function handleWatchStop(
  root: string,
  log: ReturnType<typeof import('../logger').createLogger>,
): CommandResult {
  const pid = readPidFile(root);
  if (!pid) {
    log.info('Watch daemon is not running (no PID file)');
    return { exitCode: ExitCode.OK };
  }

  if (!isProcessRunning(pid)) {
    log.info('Watch daemon is not running (stale PID file, cleaning up)');
    try { fs.unlinkSync(path.join(root, PID_FILE)); } catch { /* ignore */ }
    return { exitCode: ExitCode.OK };
  }

  try {
    process.kill(pid, 'SIGTERM');
    log.info(`Watch daemon stopped (PID ${pid})`);
    // Give it a moment, then clean up PID file
    try { fs.unlinkSync(path.join(root, PID_FILE)); } catch { /* ignore */ }
    return { exitCode: ExitCode.OK };
  } catch (e) {
    log.error(`Failed to stop watch daemon (PID ${pid}): ${e}`);
    return { exitCode: ExitCode.ERROR };
  }
}
