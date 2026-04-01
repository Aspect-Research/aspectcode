/**
 * Tests for user settings (cloud) and project config split.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, saveConfig } from '../src/config';
import type { AspectCodeConfig } from '../src/config';

describe('config — project settings', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cfg-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns undefined when no config exists', () => {
    assert.equal(loadConfig(tmpDir), undefined);
  });

  it('loads valid config', () => {
    const config: AspectCodeConfig = {
      ownership: 'section',
      platform: 'cursor',
      exclude: ['vendor'],
    };
    fs.writeFileSync(
      path.join(tmpDir, 'aspectcode.json'),
      JSON.stringify(config),
    );

    const loaded = loadConfig(tmpDir);
    assert.deepEqual(loaded?.ownership, 'section');
    assert.deepEqual(loaded?.platform, 'cursor');
    assert.deepEqual(loaded?.exclude, ['vendor']);
  });

  it('saves config and loads it back', () => {
    saveConfig(tmpDir, { ownership: 'full', evaluate: { maxProbes: 5 } });
    const loaded = loadConfig(tmpDir);
    assert.equal(loaded?.ownership, 'full');
    assert.equal(loaded?.evaluate?.maxProbes, 5);
  });

  it('merges with existing config on save', () => {
    saveConfig(tmpDir, { ownership: 'full' });
    saveConfig(tmpDir, { platform: 'cursor' });
    const loaded = loadConfig(tmpDir);
    assert.equal(loaded?.ownership, 'full');
    assert.equal(loaded?.platform, 'cursor');
  });

  it('does NOT include optimize/provider fields (those are user-level now)', () => {
    const config: AspectCodeConfig = {
      ownership: 'full',
      evaluate: { enabled: true, maxIterations: 2 },
    };
    saveConfig(tmpDir, config);
    const loaded = loadConfig(tmpDir);

    // AspectCodeConfig no longer has an optimize field
    assert.equal((loaded as any)?.optimize, undefined);
  });

  it('throws on invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'aspectcode.json'), 'not json');
    assert.throws(() => loadConfig(tmpDir), /Failed to parse/);
  });
});
