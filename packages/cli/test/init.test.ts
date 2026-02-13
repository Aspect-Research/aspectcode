/**
 * Tests for `aspectcode init` command.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runInit } from '../src/commands/init';
import { CONFIG_FILE_NAME } from '../src/config';
import type { CliFlags } from '../src/cli';
import { createLogger } from '../src/logger';

function makeFlags(overrides: Partial<CliFlags> = {}): CliFlags {
  return {
    help: false,
    version: false,
    verbose: false,
    quiet: true, // suppress output in tests
    listConnections: false,
    json: false,
    force: false,
    ...overrides,
  };
}

describe('init command', () => {
  let tmpDir: string;
  const log = createLogger({ quiet: true });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-init-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates aspectcode.json', async () => {
    const result = await runInit(tmpDir, makeFlags(), log);
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

    const result = await runInit(tmpDir, makeFlags(), log);
    assert.equal(result.exitCode, 0);

    // Original content preserved
    const content = fs.readFileSync(cfgPath, 'utf-8');
    assert.ok(content.includes('"custom"'));
  });

  it('overwrites with --force', async () => {
    const cfgPath = path.join(tmpDir, CONFIG_FILE_NAME);
    fs.writeFileSync(cfgPath, '{"custom": true}');

    const result = await runInit(tmpDir, makeFlags({ force: true }), log);
    assert.equal(result.exitCode, 0);

    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    assert.equal(parsed.custom, undefined);
    assert.equal(parsed.updateRate, 'onChange');
  });
});
