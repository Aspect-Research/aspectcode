/**
 * Tests for manifest generation — structure, determinism, stable ordering.
 */

import * as assert from 'assert';
import type { AnalysisModel } from '@aspectcode/core';
import { buildManifest } from '../src/manifest';

declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void | Promise<void>): void;
declare function afterEach(fn: () => void): void;

// ── Helpers ──────────────────────────────────────────────────

const FIXED_TIMESTAMP = '2026-01-01T00:00:00.000Z';

function makeModel(overrides?: Partial<AnalysisModel>): AnalysisModel {
  return {
    schemaVersion: '0.1',
    generatedAt: FIXED_TIMESTAMP,
    repo: { root: '/test/repo' },
    files: [
      { relativePath: 'src/app.ts', language: 'typescript', lineCount: 50, exports: ['App'], imports: ['./utils'] },
      { relativePath: 'src/utils.ts', language: 'typescript', lineCount: 30, exports: ['format'], imports: [] },
      { relativePath: 'main.py', language: 'python', lineCount: 20, exports: ['main'], imports: ['os'] },
    ],
    symbols: [],
    graph: {
      nodes: [
        { id: 'src/app.ts', path: 'src/app.ts', language: 'typescript' },
        { id: 'src/utils.ts', path: 'src/utils.ts', language: 'typescript' },
      ],
      edges: [
        {
          source: 'src/app.ts',
          target: 'src/utils.ts',
          type: 'import',
          strength: 0.8,
          symbols: ['format'],
          lines: [1],
          bidirectional: false,
        },
      ],
    },
    metrics: { hubs: [] },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('buildManifest', () => {
  it('produces correct structure', () => {
    const model = makeModel();
    const manifest = buildManifest(model, FIXED_TIMESTAMP);

    assert.strictEqual(manifest.schemaVersion, '0.1');
    assert.strictEqual(manifest.generatorVersion, '0.0.1');
    assert.strictEqual(manifest.generatedAt, FIXED_TIMESTAMP);

    assert.strictEqual(manifest.stats.fileCount, 3);
    assert.strictEqual(manifest.stats.totalLines, 100);
    assert.strictEqual(manifest.stats.edgeCount, 1);
    assert.strictEqual(manifest.stats.circularCount, 0);
    assert.ok(Array.isArray(manifest.stats.topHubs));
  });

  it('sorts language counts alphabetically', () => {
    const model = makeModel();
    const manifest = buildManifest(model, FIXED_TIMESTAMP);
    const keys = Object.keys(manifest.stats.languageCounts);

    assert.deepStrictEqual(keys, [...keys].sort());
    assert.strictEqual(manifest.stats.languageCounts['python'], 1);
    assert.strictEqual(manifest.stats.languageCounts['typescript'], 2);
  });

  it('is deterministic — identical on consecutive runs', () => {
    const model = makeModel();
    const run1 = buildManifest(model, FIXED_TIMESTAMP);
    const run2 = buildManifest(model, FIXED_TIMESTAMP);

    const json1 = JSON.stringify(run1, null, 2);
    const json2 = JSON.stringify(run2, null, 2);

    assert.strictEqual(json1, json2);
  });

  it('respects topN parameter', () => {
    const model = makeModel();
    const manifest = buildManifest(model, FIXED_TIMESTAMP, 1);

    assert.ok(manifest.stats.topHubs.length <= 1);
  });
});

