/**
 * Tests for config loading.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, saveConfig, CONFIG_FILE_NAME } from '../src/config';

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

describe('saveConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cfg-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates config file when none exists', () => {
    saveConfig(tmpDir, { exclude: ['vendor'] });
    const loaded = loadConfig(tmpDir);
    assert.deepEqual(loaded?.exclude, ['vendor']);
  });

  it('merges with existing valid config', () => {
    fs.writeFileSync(path.join(tmpDir, CONFIG_FILE_NAME), JSON.stringify({ exclude: ['dist'] }));
    saveConfig(tmpDir, { ownership: 'section' });
    const loaded = loadConfig(tmpDir);
    assert.deepEqual(loaded?.exclude, ['dist']);
    assert.equal(loaded?.ownership, 'section');
  });

  it('overwrites malformed existing config', () => {
    fs.writeFileSync(path.join(tmpDir, CONFIG_FILE_NAME), '{broken json!!!');
    saveConfig(tmpDir, { exclude: ['vendor'] });
    const loaded = loadConfig(tmpDir);
    assert.deepEqual(loaded?.exclude, ['vendor']);
  });

  it('preserves fields not in update', () => {
    const original = { exclude: ['dist'], optimize: { provider: 'openai' } };
    fs.writeFileSync(path.join(tmpDir, CONFIG_FILE_NAME), JSON.stringify(original));
    saveConfig(tmpDir, { ownership: 'full' });
    const loaded = loadConfig(tmpDir);
    assert.deepEqual(loaded?.exclude, ['dist']);
    assert.equal(loaded?.optimize?.provider, 'openai');
    assert.equal(loaded?.ownership, 'full');
  });

  it('writes JSON with 2-space indent and trailing newline', () => {
    saveConfig(tmpDir, { exclude: ['dist'] });
    const raw = fs.readFileSync(path.join(tmpDir, CONFIG_FILE_NAME), 'utf-8');
    assert.ok(raw.includes('  "exclude"'));
    assert.ok(raw.endsWith('\n'));
  });
});
