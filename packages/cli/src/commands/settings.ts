/**
 * `aspectcode` settings commands.
 */

import type { CliFlags, CommandContext, CommandResult } from '../cli';
import { ExitCode } from '../cli';
import { loadRawConfig, saveRawConfig, type RawAspectCodeConfig } from '../config';
import type { Logger } from '../logger';
import { fmt } from '../logger';

type UpdateRate = 'manual' | 'onChange' | 'idle';

interface JsonSuccessPayload {
  ok: true;
  command: string;
  config: RawAspectCodeConfig;
  changed?: string[];
}

interface JsonErrorPayload {
  ok: false;
  command: string;
  error: string;
}

export async function runShowConfig(
  ctx: CommandContext,
): Promise<CommandResult> {
  const { root, flags, log } = ctx;
  const command = 'show-config';

  try {
    const current = loadRawConfig(root) ?? {};
    const displayConfig = withCanonicalUpdateRate(current);

    if (flags.json) {
      emitJson({
        ok: true,
        command,
        config: displayConfig,
      });
    } else {
      log.info(JSON.stringify(displayConfig, null, 2));
    }

    return { exitCode: ExitCode.OK };
  } catch (error) {
    return outputError(command, flags, log, error);
  }
}

export async function runSetUpdateRate(
  ctx: CommandContext,
  value: string,
): Promise<CommandResult> {
  const parsed = parseUpdateRate(value);
  if (!parsed) {
    return outputUsageError(
      'set-update-rate',
      ctx.flags,
      ctx.log,
      `Invalid update rate: ${fmt.bold(value)}. Expected manual|onChange|idle.`,
    );
  }

  return runSettingsMutation(ctx, 'set-update-rate', ['updateRate', 'autoRegenerateKb'], (cfg) => {
    cfg.updateRate = parsed;
    delete cfg.autoRegenerateKb;
  });
}

export async function runAddExclude(
  ctx: CommandContext,
  value: string,
): Promise<CommandResult> {
  const excludePath = value.trim();
  if (!excludePath) {
    return outputUsageError('add-exclude', ctx.flags, ctx.log, `${fmt.bold('add-exclude')} requires a non-empty path value.`);
  }

  return runSettingsMutation(ctx, 'add-exclude', ['exclude'], (cfg) => {
    const list = normalizeExcludeList(cfg.exclude);
    if (!list.includes(excludePath)) {
      list.push(excludePath);
    }
    cfg.exclude = list;
  });
}

export async function runRemoveExclude(
  ctx: CommandContext,
  value: string,
): Promise<CommandResult> {
  const excludePath = value.trim();
  if (!excludePath) {
    return outputUsageError('remove-exclude', ctx.flags, ctx.log, `${fmt.bold('remove-exclude')} requires a non-empty path value.`);
  }

  return runSettingsMutation(ctx, 'remove-exclude', ['exclude'], (cfg) => {
    const list = normalizeExcludeList(cfg.exclude).filter((entry) => entry !== excludePath);
    if (list.length > 0) {
      cfg.exclude = list;
    } else {
      delete cfg.exclude;
    }
  });
}

// ── Shared mutation runner ───────────────────────────────────

/**
 * Generic helper for settings mutation commands.
 *
 * Encapsulates the try/catch + load → mutate → save → output pattern
 * shared by all mutation commands.
 */
function runSettingsMutation(
  ctx: CommandContext,
  command: string,
  changed: string[],
  mutate: (config: RawAspectCodeConfig) => void,
): CommandResult {
  const { root, flags, log } = ctx;
  try {
    const nextConfig = updateRawConfig(root, mutate);
    return outputSuccess(command, flags, log, nextConfig, changed);
  } catch (error) {
    return outputError(command, flags, log, error);
  }
}

function updateRawConfig(
  root: string,
  apply: (config: RawAspectCodeConfig) => void,
): RawAspectCodeConfig {
  const nextConfig = { ...(loadRawConfig(root) ?? {}) };
  apply(nextConfig);
  saveRawConfig(root, nextConfig);
  return nextConfig;
}

function withCanonicalUpdateRate(config: RawAspectCodeConfig): RawAspectCodeConfig {
  if (config.updateRate || !config.autoRegenerateKb) {
    return { ...config };
  }

  let mapped: UpdateRate | undefined;
  if (config.autoRegenerateKb === 'off') {
    mapped = 'manual';
  } else if (config.autoRegenerateKb === 'onSave') {
    mapped = 'onChange';
  } else if (config.autoRegenerateKb === 'idle') {
    mapped = 'idle';
  }

  if (!mapped) {
    return { ...config };
  }

  return {
    ...config,
    updateRate: mapped,
  };
}

function parseUpdateRate(value: string): UpdateRate | undefined {
  const normalized = value.trim();
  if (normalized === 'manual' || normalized === 'onChange' || normalized === 'idle') {
    return normalized;
  }
  return undefined;
}

function normalizeExcludeList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function outputSuccess(
  command: string,
  flags: CliFlags,
  log: Logger,
  config: RawAspectCodeConfig,
  changed?: string[],
): CommandResult {
  if (flags.json) {
    const payload: JsonSuccessPayload = { ok: true, command, config, changed };
    emitJson(payload);
  } else {
    log.success(`Updated ${fmt.cyan('aspectcode.json')} via ${fmt.bold(command)}.`);
  }

  return { exitCode: ExitCode.OK };
}

function outputUsageError(
  command: string,
  flags: CliFlags,
  log: Logger,
  message: string,
): CommandResult {
  if (flags.json) {
    const payload: JsonErrorPayload = { ok: false, command, error: message };
    emitJson(payload);
  } else {
    log.error(message);
  }

  return { exitCode: ExitCode.USAGE };
}

function outputError(
  command: string,
  flags: CliFlags,
  log: Logger,
  error: unknown,
): CommandResult {
  const message = error instanceof Error ? error.message : String(error);
  if (flags.json) {
    const payload: JsonErrorPayload = { ok: false, command, error: message };
    emitJson(payload);
  } else {
    log.error(message);
  }

  return { exitCode: ExitCode.ERROR };
}

function emitJson(payload: JsonSuccessPayload | JsonErrorPayload): void {
  console.log(JSON.stringify(payload, null, 2));
}
