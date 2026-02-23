/**
 * Tests for settings commands.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CliFlags, CommandContext } from '../src/cli';
import { createLogger } from '../src/logger';
import { CONFIG_FILE_NAME } from '../src/config';
import {
  runAddExclude,
  runRemoveExclude,
  runSetUpdateRate,
  runShowConfig,
} from '../src/commands/settings';

function makeFlags(overrides: Partial<CliFlags> = {}): CliFlags {
  return {
    help: false,
    version: false,
    verbose: false,
    quiet: true,
    noColor: false,
    listConnections: false,
    json: false,
    kbOnly: false,
    kb: false,
    ...overrides,
  };
}

function makeCtx(root: string, overrides: Partial<CliFlags> = {}): CommandContext {
  return {
    root,
    flags: makeFlags(overrides),
    config: undefined,
    log: createLogger({ quiet: true }),
    positionals: [],
  };
}

function readConfig(dir: string): Record<string, unknown> {
  const filePath = path.join(dir, CONFIG_FILE_NAME);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
}

function writeConfig(dir: string, config: Record<string, unknown>): void {
  const filePath = path.join(dir, CONFIG_FILE_NAME);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

async function captureJsonOutput(fn: () => Promise<unknown>): Promise<unknown> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((item) => String(item)).join(' '));
  };

  try {
    await fn();
  } finally {
    console.log = original;
  }

  const joined = lines.join('\n').trim();
  assert.notEqual(joined, '');
  return JSON.parse(joined) as unknown;
}

describe('settings commands', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-settings-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('set-update-rate writes canonical updateRate and removes legacy key while preserving unknown keys', async () => {
    writeConfig(tmpDir, {
      autoRegenerateKb: 'onSave',
      customKey: { enabled: true },
      exclude: ['dist'],
    });

    const result = await runSetUpdateRate(makeCtx(tmpDir), 'idle');
    assert.equal(result.exitCode, 0);

    const cfg = readConfig(tmpDir);
    assert.equal(cfg.updateRate, 'idle');
    assert.equal(cfg.autoRegenerateKb, undefined);
    assert.deepEqual(cfg.customKey, { enabled: true });
    assert.deepEqual(cfg.exclude, ['dist']);
  });

  it('add-exclude and remove-exclude manage the exclude list', async () => {
    writeConfig(tmpDir, { exclude: ['dist'], custom: 'ok' });

    let result = await runAddExclude(makeCtx(tmpDir), 'coverage');
    assert.equal(result.exitCode, 0);
    result = await runAddExclude(makeCtx(tmpDir), 'dist');
    assert.equal(result.exitCode, 0);

    let cfg = readConfig(tmpDir);
    assert.deepEqual(cfg.exclude, ['dist', 'coverage']);

    result = await runRemoveExclude(makeCtx(tmpDir), 'dist');
    assert.equal(result.exitCode, 0);
    cfg = readConfig(tmpDir);
    assert.deepEqual(cfg.exclude, ['coverage']);
    assert.equal(cfg.custom, 'ok');

    result = await runRemoveExclude(makeCtx(tmpDir), 'coverage');
    assert.equal(result.exitCode, 0);
    cfg = readConfig(tmpDir);
    assert.equal(cfg.exclude, undefined);
  });

  it('--json returns machine-readable payloads for show-config and updates', async () => {
    writeConfig(tmpDir, {
      autoRegenerateKb: 'onSave',
      customKey: 'x',
    });

    const showPayload = await captureJsonOutput(async () => {
      await runShowConfig(makeCtx(tmpDir, { json: true }));
    }) as { ok: boolean; command: string; config: Record<string, unknown> };

    assert.equal(showPayload.ok, true);
    assert.equal(showPayload.command, 'show-config');
    assert.equal(showPayload.config.updateRate, 'onChange');
    assert.equal(showPayload.config.autoRegenerateKb, 'onSave');

    const setPayload = await captureJsonOutput(async () => {
      await runSetUpdateRate(makeCtx(tmpDir, { json: true }), 'manual');
    }) as { ok: boolean; command: string; config: Record<string, unknown> };

    assert.equal(setPayload.ok, true);
    assert.equal(setPayload.command, 'set-update-rate');
    assert.equal(setPayload.config.updateRate, 'manual');
    assert.equal(setPayload.config.autoRegenerateKb, undefined);
    assert.equal(setPayload.config.customKey, 'x');
  });
});
