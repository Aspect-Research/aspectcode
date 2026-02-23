/**
 * Tests for config loading.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, defaultConfig, CONFIG_FILE_NAME } from '../src/config';

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

  it('loads a valid config file', () => {
    const cfg = { outDir: 'build' };
    fs.writeFileSync(path.join(tmpDir, CONFIG_FILE_NAME), JSON.stringify(cfg));
    const loaded = loadConfig(tmpDir);
    assert.deepEqual(loaded, { ...cfg, instructionsMode: 'safe' });
  });

  it('throws on malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, CONFIG_FILE_NAME), '{not json}');
    assert.throws(() => loadConfig(tmpDir), /invalid JSON/);
  });

  it('defaultConfig returns expected shape', () => {
    const d = defaultConfig();
    assert.equal(d.instructionsMode, 'safe');
    assert.equal(d.updateRate, 'onChange');
  });

  it('maps legacy autoRegenerateKb values to updateRate', () => {
    const cfg = { autoRegenerateKb: 'onSave' };
    fs.writeFileSync(path.join(tmpDir, CONFIG_FILE_NAME), JSON.stringify(cfg));
    const loaded = loadConfig(tmpDir);
    assert.equal(loaded?.updateRate, 'onChange');
    assert.equal(loaded?.instructionsMode, 'safe');
  });

  it('maps legacy off mode to manual', () => {
    const cfg = { autoRegenerateKb: 'off', instructionsMode: 'permissive' };
    fs.writeFileSync(path.join(tmpDir, CONFIG_FILE_NAME), JSON.stringify(cfg));
    const loaded = loadConfig(tmpDir);
    assert.equal(loaded?.updateRate, 'manual');
    assert.equal(loaded?.instructionsMode, 'safe');
  });
});
