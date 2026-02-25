/**
 * Tests for config loading.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, CONFIG_FILE_NAME } from '../src/config';

describe('config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cfg-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns undefined when config file is absent', () => {
    assert.equal(loadConfig(tmpDir), undefined);
  });

  it('loads a valid config file with exclude', () => {
    const cfg = { exclude: ['vendor', 'dist'] };
    fs.writeFileSync(path.join(tmpDir, CONFIG_FILE_NAME), JSON.stringify(cfg));
    const loaded = loadConfig(tmpDir);
    assert.deepEqual(loaded?.exclude, ['vendor', 'dist']);
  });

  it('loads a valid config file with optimize settings', () => {
    const cfg = { optimize: { provider: 'openai', temperature: 0.5 } };
    fs.writeFileSync(path.join(tmpDir, CONFIG_FILE_NAME), JSON.stringify(cfg));
    const loaded = loadConfig(tmpDir);
    assert.equal(loaded?.optimize?.provider, 'openai');
    assert.equal(loaded?.optimize?.temperature, 0.5);
  });

  it('throws on malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, CONFIG_FILE_NAME), '{not json}');
    assert.throws(() => loadConfig(tmpDir), /invalid JSON/);
  });

  it('returns empty object for empty JSON object', () => {
    fs.writeFileSync(path.join(tmpDir, CONFIG_FILE_NAME), '{}');
    const loaded = loadConfig(tmpDir);
    assert.deepEqual(loaded, {});
  });
});
