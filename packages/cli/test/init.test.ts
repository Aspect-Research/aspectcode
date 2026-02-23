/**
 * Tests for `aspectcode init` command.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runInit } from '../src/commands/init';
import { CONFIG_FILE_NAME } from '../src/config';
import type { CliFlags, CommandContext } from '../src/cli';
import { createLogger } from '../src/logger';

function makeFlags(overrides: Partial<CliFlags> = {}): CliFlags {
  return {
    help: false,
    version: false,
    verbose: false,
    quiet: true, // suppress output in tests
    noColor: false,
    listConnections: false,
    json: false,
    force: false,
    kbOnly: false,
    copilot: false,
    cursor: false,
    claude: false,
    other: false,
    dryRun: false,
    autoOptimize: false,
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

describe('init command', () => {
  let tmpDir: string;
  let stdinIsTtyDescriptor: PropertyDescriptor | undefined;
  let stdoutIsTtyDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-init-'));

    stdinIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    stdoutIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      configurable: true,
    });
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    if (stdinIsTtyDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', stdinIsTtyDescriptor);
    }
    if (stdoutIsTtyDescriptor) {
      Object.defineProperty(process.stdout, 'isTTY', stdoutIsTtyDescriptor);
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates aspectcode.json', async () => {
    const result = await runInit(makeCtx(tmpDir));
    assert.equal(result.exitCode, 0);

    const cfgPath = path.join(tmpDir, CONFIG_FILE_NAME);
    assert.ok(fs.existsSync(cfgPath));

    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    assert.equal(parsed.instructionsMode, 'safe');
    assert.equal(parsed.updateRate, 'onChange');
  });

  it('does not overwrite without --force', async () => {
    // Create existing config
    const cfgPath = path.join(tmpDir, CONFIG_FILE_NAME);
    fs.writeFileSync(cfgPath, '{"custom": true}');

    const result = await runInit(makeCtx(tmpDir));
    assert.equal(result.exitCode, 0);

    // Original content preserved
    const content = fs.readFileSync(cfgPath, 'utf-8');
    assert.ok(content.includes('"custom"'));
  });

  it('overwrites with --force', async () => {
    const cfgPath = path.join(tmpDir, CONFIG_FILE_NAME);
    fs.writeFileSync(cfgPath, '{"custom": true}');

    const result = await runInit(makeCtx(tmpDir, { force: true }));
    assert.equal(result.exitCode, 0);

    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    assert.equal(parsed.custom, undefined);
    assert.equal(parsed.updateRate, 'onChange');
  });

  it('non-interactive path writes defaults and does not start watch', async () => {
    let watchCalls = 0;

    const result = await runInit(
      makeCtx(tmpDir, { quiet: false }),
      {
        runWatchFn: async () => {
          watchCalls++;
          return { exitCode: 0 };
        },
      },
    );

    assert.equal(result.exitCode, 0);
    assert.equal(watchCalls, 0);

    const cfgPath = path.join(tmpDir, CONFIG_FILE_NAME);
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    assert.equal(parsed.instructionsMode, 'safe');
    assert.equal(parsed.updateRate, 'onChange');
    assert.equal(parsed.outDir, undefined);
    assert.equal(parsed.exclude, undefined);
  });
});
