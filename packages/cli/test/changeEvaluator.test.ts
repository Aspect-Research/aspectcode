/**
 * Unit tests for change evaluator rules and helpers.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { evaluateChange, extractExportNames, hasPathInGraph } from '../src/changeEvaluator';
import { loadPreferences, addPreference, findMatchingPreference, bumpPreferenceHit } from '../src/preferences';
import type { PreferencesStore } from '../src/preferences';
import type { AnalysisModel } from '@aspectcode/core';

// ── Co-change detection (unit) ───────────────────────────────

describe('co-change detection', () => {
  function makeCtx(overrides: Partial<Parameters<typeof evaluateChange>[1]> = {}) {
    const model = {
      files: [
        { relativePath: 'src/types.ts', language: 'typescript', imports: [], exports: ['Foo'], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/app.ts', language: 'typescript', imports: ['./types'], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/bar.ts', language: 'typescript', imports: ['./types'], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/baz.ts', language: 'typescript', imports: ['./types'], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: {
        nodes: [{ id: 'src/types.ts' }, { id: 'src/app.ts' }, { id: 'src/bar.ts' }, { id: 'src/baz.ts' }],
        edges: [
          { source: 'src/app.ts', target: 'src/types.ts', type: 'import', strength: 0.8, symbols: ['Foo'], lines: [1], bidirectional: false },
          { source: 'src/bar.ts', target: 'src/types.ts', type: 'import', strength: 0.7, symbols: ['Foo'], lines: [1], bidirectional: false },
          { source: 'src/baz.ts', target: 'src/types.ts', type: 'import', strength: 0.3, symbols: ['Foo'], lines: [1], bidirectional: false },
        ],
      },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    return {
      model,
      agentsContent: '# stub',
      preferences: { version: 1 as const, preferences: [] },
      recentChanges: [],
      fileContents: new Map(),
      ...overrides,
    };
  }

  it('fires warning when file with >=2 strong dependents is modified', () => {
    const ctx = makeCtx();
    const results = evaluateChange({ type: 'change', path: 'src/types.ts' }, ctx);
    const warning = results.find((a) => a.rule === 'co-change' && a.type === 'warning');
    assert.ok(warning, `Expected co-change warning, got: ${JSON.stringify(results)}`);
    assert.ok(warning!.dependencyContext?.includes('strong dependents'));
  });

  it('no warning when all strong dependents recently changed', () => {
    const ctx = makeCtx({
      recentChanges: [
        { type: 'change', path: 'src/app.ts', timestamp: Date.now() },
        { type: 'change', path: 'src/bar.ts', timestamp: Date.now() },
      ],
    });
    const results = evaluateChange({ type: 'change', path: 'src/types.ts' }, ctx);
    const warning = results.find((a) => a.rule === 'co-change' && a.type === 'warning');
    assert.ok(!warning, `Expected no co-change warning, got: ${JSON.stringify(results)}`);
  });

  it('no warning for leaf files with <2 dependents', () => {
    const ctx = makeCtx();
    const results = evaluateChange({ type: 'change', path: 'src/app.ts' }, ctx);
    const warning = results.find((a) => a.rule === 'co-change');
    assert.ok(!warning, `Expected no co-change for leaf, got: ${JSON.stringify(results)}`);
  });

  it('strength threshold: 0.5 triggers warning', () => {
    const model = {
      files: [
        { relativePath: 'src/types.ts', language: 'typescript', imports: [], exports: ['Foo'], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/a.ts', language: 'typescript', imports: ['./types'], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/b.ts', language: 'typescript', imports: ['./types'], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: {
        nodes: [{ id: 'src/types.ts' }, { id: 'src/a.ts' }, { id: 'src/b.ts' }],
        edges: [
          { source: 'src/a.ts', target: 'src/types.ts', type: 'import', strength: 0.5, symbols: ['Foo'], lines: [1], bidirectional: false },
          { source: 'src/b.ts', target: 'src/types.ts', type: 'import', strength: 0.5, symbols: ['Foo'], lines: [1], bidirectional: false },
        ],
      },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    const results = evaluateChange({ type: 'change', path: 'src/types.ts' }, {
      model, agentsContent: '# stub', preferences: { version: 1, preferences: [] },
      recentChanges: [], fileContents: new Map(),
    });
    const warning = results.find((a) => a.rule === 'co-change' && a.type === 'warning');
    assert.ok(warning, `Expected co-change warning at strength 0.5`);
  });

  it('strength threshold: 0.49 does not trigger', () => {
    const model = {
      files: [
        { relativePath: 'src/types.ts', language: 'typescript', imports: [], exports: ['Foo'], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/a.ts', language: 'typescript', imports: ['./types'], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/b.ts', language: 'typescript', imports: ['./types'], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: {
        nodes: [{ id: 'src/types.ts' }, { id: 'src/a.ts' }, { id: 'src/b.ts' }],
        edges: [
          { source: 'src/a.ts', target: 'src/types.ts', type: 'import', strength: 0.49, symbols: ['Foo'], lines: [1], bidirectional: false },
          { source: 'src/b.ts', target: 'src/types.ts', type: 'import', strength: 0.49, symbols: ['Foo'], lines: [1], bidirectional: false },
        ],
      },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    const results = evaluateChange({ type: 'change', path: 'src/types.ts' }, {
      model, agentsContent: '# stub', preferences: { version: 1, preferences: [] },
      recentChanges: [], fileContents: new Map(),
    });
    const warning = results.find((a) => a.rule === 'co-change' && a.type === 'warning');
    assert.ok(!warning, `Expected no warning at strength 0.49`);
  });

  it('bidirectional edges counted as dependents', () => {
    const model = {
      files: [
        { relativePath: 'src/types.ts', language: 'typescript', imports: [], exports: ['Foo'], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/a.ts', language: 'typescript', imports: ['./types'], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/b.ts', language: 'typescript', imports: ['./types'], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: {
        nodes: [{ id: 'src/types.ts' }, { id: 'src/a.ts' }, { id: 'src/b.ts' }],
        edges: [
          { source: 'src/types.ts', target: 'src/a.ts', type: 'import', strength: 0.8, symbols: ['Foo'], lines: [1], bidirectional: true },
          { source: 'src/b.ts', target: 'src/types.ts', type: 'import', strength: 0.7, symbols: ['Foo'], lines: [1], bidirectional: false },
        ],
      },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    const results = evaluateChange({ type: 'change', path: 'src/types.ts' }, {
      model, agentsContent: '# stub', preferences: { version: 1, preferences: [] },
      recentChanges: [], fileContents: new Map(),
    });
    const warning = results.find((a) => a.rule === 'co-change');
    assert.ok(warning, 'Expected co-change for bidirectional edge');
  });
});

// ── Export contract check (unit) ─────────────────────────────

describe('export contract check', () => {
  it('warns when exported symbol is removed and consumers exist', () => {
    const model = {
      files: [
        { relativePath: 'src/utils.ts', language: 'typescript', imports: [], exports: ['helperA', 'helperB'], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/app.ts', language: 'typescript', imports: ['./utils'], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: {
        nodes: [{ id: 'src/utils.ts' }, { id: 'src/app.ts' }],
        edges: [
          { source: 'src/app.ts', target: 'src/utils.ts', type: 'import', strength: 1, symbols: ['helperA'], lines: [1], bidirectional: false },
        ],
      },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    const results = evaluateChange(
      { type: 'change', path: 'src/utils.ts' },
      {
        model,
        agentsContent: '# stub',
        preferences: { version: 1, preferences: [] },
        recentChanges: [],
        fileContents: new Map([['src/utils.ts', 'export const helperB = 1;\n']]), // helperA removed
      },
    );

    const warning = results.find((a) => a.rule === 'export-contract');
    assert.ok(warning, `Expected export-contract warning, got: ${JSON.stringify(results)}`);
    assert.ok(warning!.message.includes('helperA'));
    assert.ok(warning!.dependencyContext?.includes('src/app.ts'));
  });

  it('no warning when exports are only added', () => {
    const model = {
      files: [
        { relativePath: 'src/utils.ts', language: 'typescript', imports: [], exports: ['helperA'], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: { nodes: [{ id: 'src/utils.ts' }], edges: [] },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    const results = evaluateChange(
      { type: 'change', path: 'src/utils.ts' },
      {
        model,
        agentsContent: '# stub',
        preferences: { version: 1, preferences: [] },
        recentChanges: [],
        fileContents: new Map([['src/utils.ts', 'export const helperA = 1;\nexport const helperB = 2;\n']]),
      },
    );

    const warning = results.find((a) => a.rule === 'export-contract');
    assert.ok(!warning, `Expected no export-contract warning, got: ${JSON.stringify(results)}`);
  });

  it('no warning when removed export has zero consumers in graph', () => {
    const model = {
      files: [
        { relativePath: 'src/utils.ts', language: 'typescript', imports: [], exports: ['helperA', 'helperB'], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: { nodes: [{ id: 'src/utils.ts' }], edges: [] },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    const results = evaluateChange(
      { type: 'change', path: 'src/utils.ts' },
      {
        model, agentsContent: '# stub', preferences: { version: 1, preferences: [] },
        recentChanges: [],
        fileContents: new Map([['src/utils.ts', 'export const helperB = 1;\n']]),
      },
    );
    const warning = results.find((a) => a.rule === 'export-contract');
    assert.ok(!warning, 'No consumers = no warning');
  });

  it('no warning when fileContents is undefined', () => {
    const model = {
      files: [
        { relativePath: 'src/utils.ts', language: 'typescript', imports: [], exports: ['helperA'], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: { nodes: [{ id: 'src/utils.ts' }], edges: [] },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    const results = evaluateChange(
      { type: 'change', path: 'src/utils.ts' },
      { model, agentsContent: '# stub', preferences: { version: 1, preferences: [] }, recentChanges: [] },
    );
    const warning = results.find((a) => a.rule === 'export-contract');
    assert.ok(!warning);
  });
});

// ── Circular dependency check (unit) ─────────────────────────

describe('circular dependency check', () => {
  it('warns when new import creates cycle (A→B→C, add C→A)', () => {
    const model = {
      files: [
        { relativePath: 'src/a.ts', language: 'typescript', imports: ['./b'], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/b.ts', language: 'typescript', imports: ['./c'], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/c.ts', language: 'typescript', imports: [], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: {
        nodes: [{ id: 'src/a.ts' }, { id: 'src/b.ts' }, { id: 'src/c.ts' }],
        edges: [
          { source: 'src/a.ts', target: 'src/b.ts', type: 'import', strength: 1, symbols: [], lines: [1], bidirectional: false },
          { source: 'src/b.ts', target: 'src/c.ts', type: 'import', strength: 1, symbols: [], lines: [1], bidirectional: false },
        ],
      },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    // c.ts now imports from a.ts (creates cycle)
    const results = evaluateChange(
      { type: 'change', path: 'src/c.ts' },
      {
        model,
        agentsContent: '# stub',
        preferences: { version: 1, preferences: [] },
        recentChanges: [],
        fileContents: new Map([['src/c.ts', 'import { something } from "./a";\n']]),
      },
    );

    const warning = results.find((a) => a.rule === 'circular-dependency');
    assert.ok(warning, `Expected circular-dependency warning, got: ${JSON.stringify(results)}`);
    assert.ok(warning!.details?.includes('→'));
  });

  it('no warning for non-circular imports', () => {
    const model = {
      files: [
        { relativePath: 'src/a.ts', language: 'typescript', imports: [], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/b.ts', language: 'typescript', imports: [], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: {
        nodes: [{ id: 'src/a.ts' }, { id: 'src/b.ts' }],
        edges: [],
      },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    const results = evaluateChange(
      { type: 'change', path: 'src/a.ts' },
      {
        model,
        agentsContent: '# stub',
        preferences: { version: 1, preferences: [] },
        recentChanges: [],
        fileContents: new Map([['src/a.ts', 'import { something } from "./b";\n']]),
      },
    );

    const warning = results.find((a) => a.rule === 'circular-dependency');
    assert.ok(!warning, `Expected no circular-dependency warning, got: ${JSON.stringify(results)}`);
  });

  it('no warning when fileContents is undefined', () => {
    const model = {
      files: [
        { relativePath: 'src/a.ts', language: 'typescript', imports: [], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: { nodes: [{ id: 'src/a.ts' }], edges: [] },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    const results = evaluateChange(
      { type: 'change', path: 'src/a.ts' },
      { model, agentsContent: '# stub', preferences: { version: 1, preferences: [] }, recentChanges: [] },
    );
    const warning = results.find((a) => a.rule === 'circular-dependency');
    assert.ok(!warning);
  });
});

// ── Test coverage gap check (unit) ───────────────────────────

describe('test coverage gap check', () => {
  it('warns when source changes but paired test file is stale', () => {
    const model = {
      files: [
        { relativePath: 'src/utils.ts', language: 'typescript', imports: [], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/utils.test.ts', language: 'typescript', imports: [], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: { nodes: [], edges: [] },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    const results = evaluateChange(
      { type: 'change', path: 'src/utils.ts' },
      {
        model,
        agentsContent: '# stub',
        preferences: { version: 1, preferences: [] },
        recentChanges: [], // test file NOT in recent changes
        fileContents: new Map([['src/utils.ts', 'export const x = 1;\n']]),
      },
    );

    const warning = results.find((a) => a.rule === 'test-coverage-gap');
    assert.ok(warning, `Expected test-coverage-gap warning, got: ${JSON.stringify(results)}`);
    assert.ok(warning!.details?.includes('utils.test.ts'));
  });

  it('no warning for test files themselves', () => {
    const model = {
      files: [
        { relativePath: 'src/utils.test.ts', language: 'typescript', imports: [], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: { nodes: [], edges: [] },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    const results = evaluateChange(
      { type: 'change', path: 'src/utils.test.ts' },
      {
        model,
        agentsContent: '# stub',
        preferences: { version: 1, preferences: [] },
        recentChanges: [],
        fileContents: new Map([['src/utils.test.ts', 'describe("test", () => {});\n']]),
      },
    );

    const warning = results.find((a) => a.rule === 'test-coverage-gap');
    assert.ok(!warning, `Expected no warning for test file, got: ${JSON.stringify(results)}`);
  });

  it('no warning when test file was recently updated', () => {
    const model = {
      files: [
        { relativePath: 'src/utils.ts', language: 'typescript', imports: [], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/utils.test.ts', language: 'typescript', imports: [], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: { nodes: [], edges: [] },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    const results = evaluateChange(
      { type: 'change', path: 'src/utils.ts' },
      {
        model,
        agentsContent: '# stub',
        preferences: { version: 1, preferences: [] },
        recentChanges: [{ type: 'change', path: 'src/utils.test.ts', timestamp: Date.now() }],
        fileContents: new Map([['src/utils.ts', 'export const x = 1;\n']]),
      },
    );

    const warning = results.find((a) => a.rule === 'test-coverage-gap');
    assert.ok(!warning, `Expected no warning when test updated, got: ${JSON.stringify(results)}`);
  });

  it('finds test file in __tests__/ directory', () => {
    const model = {
      files: [
        { relativePath: 'src/utils.ts', language: 'typescript', imports: [], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/__tests__/utils.test.ts', language: 'typescript', imports: [], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: { nodes: [], edges: [] },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    const results = evaluateChange(
      { type: 'change', path: 'src/utils.ts' },
      {
        model, agentsContent: '# stub', preferences: { version: 1, preferences: [] },
        recentChanges: [],
        fileContents: new Map([['src/utils.ts', 'export const x = 1;\n']]),
      },
    );
    const warning = results.find((a) => a.rule === 'test-coverage-gap');
    assert.ok(warning, 'Should find test in __tests__/');
    assert.ok(warning!.details?.includes('__tests__'));
  });

  it('finds .spec.ts test variant', () => {
    const model = {
      files: [
        { relativePath: 'src/utils.ts', language: 'typescript', imports: [], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/utils.spec.ts', language: 'typescript', imports: [], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: { nodes: [], edges: [] },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    const results = evaluateChange(
      { type: 'change', path: 'src/utils.ts' },
      {
        model, agentsContent: '# stub', preferences: { version: 1, preferences: [] },
        recentChanges: [],
        fileContents: new Map([['src/utils.ts', 'export const x = 1;\n']]),
      },
    );
    const warning = results.find((a) => a.rule === 'test-coverage-gap');
    assert.ok(warning, 'Should find .spec.ts variant');
  });
});

// ── Preference tracking ──────────────────────────────────────

describe('preference tracking', () => {
  it('bumpPreferenceHit increments count', () => {
    let prefs: PreferencesStore = { version: 1, preferences: [] };
    prefs = addPreference(prefs, {
      rule: 'co-change',
      pattern: 'test',
      disposition: 'allow',
      directory: 'src/',
    });
    const id = prefs.preferences[0].id;
    assert.equal(prefs.preferences[0].hitCount, undefined);

    bumpPreferenceHit(prefs, id);
    assert.equal(prefs.preferences[0].hitCount, 1);
    assert.ok(prefs.preferences[0].lastHitAt);

    bumpPreferenceHit(prefs, id);
    assert.equal(prefs.preferences[0].hitCount, 2);
  });

  it('findMatchingPreference returns full object', () => {
    let prefs: PreferencesStore = { version: 1, preferences: [] };
    prefs = addPreference(prefs, {
      rule: 'co-change',
      pattern: 'test pattern',
      disposition: 'allow',
      directory: 'src/',
      dependencyContext: 'test context',
    });

    const match = findMatchingPreference(prefs, 'co-change', 'src/foo.ts', 'src/');
    assert.ok(match);
    assert.equal(match!.rule, 'co-change');
    assert.equal(match!.disposition, 'allow');
    assert.equal(match!.dependencyContext, 'test context');
  });

  it('dependencyContext stored on preference creation', () => {
    let prefs: PreferencesStore = { version: 1, preferences: [] };
    prefs = addPreference(prefs, {
      rule: 'export-contract',
      pattern: 'Removed exports',
      disposition: 'deny',
      file: 'src/utils.ts',
      dependencyContext: 'Removed exports: [helperA], 2 affected consumers',
    });

    assert.equal(prefs.preferences[0].dependencyContext, 'Removed exports: [helperA], 2 affected consumers');
  });
});

// ── Migration: hub-safety → co-change ────────────────────────

describe('hub-safety migration', () => {
  it('loading preferences with hub-safety rule auto-migrates to co-change', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-migrate-'));
    try {
      const prefsDir = path.join(tmpDir, '.aspectcode');
      fs.mkdirSync(prefsDir, { recursive: true });
      fs.writeFileSync(path.join(prefsDir, 'preferences.json'), JSON.stringify({
        version: 1,
        preferences: [{
          id: 'test123',
          rule: 'hub-safety',
          pattern: 'Old hub warning',
          disposition: 'allow',
          directory: 'src/',
          createdAt: '2025-01-01T00:00:00Z',
        }],
      }));

      const prefs = loadPreferences(tmpDir);
      assert.equal(prefs.preferences[0].rule, 'co-change');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── extractExportNames helper ────────────────────────────────

describe('extractExportNames', () => {
  it('extracts named exports', () => {
    const names = extractExportNames('export const foo = 1;\nexport function bar() {}\nexport class Baz {}', 'typescript');
    assert.ok(names.includes('foo'));
    assert.ok(names.includes('bar'));
    assert.ok(names.includes('Baz'));
  });

  it('extracts brace exports', () => {
    const names = extractExportNames('export { alpha, beta as gamma }', 'typescript');
    assert.ok(names.includes('alpha'));
    assert.ok(names.includes('beta'));
  });

  it('extracts default exports', () => {
    const names = extractExportNames('export default function MyFunc() {}', 'typescript');
    assert.ok(names.includes('MyFunc'));
  });

  it('extracts type and interface exports', () => {
    const names = extractExportNames('export type Foo = string;\nexport interface Bar {}', 'typescript');
    assert.ok(names.includes('Foo'));
    assert.ok(names.includes('Bar'));
  });

  it('extracts enum exports', () => {
    const names = extractExportNames('export enum Status { Active, Inactive }', 'typescript');
    assert.ok(names.includes('Status'));
  });

  it('handles export { A as B } — uses original name', () => {
    const names = extractExportNames('export { Original as Renamed }', 'typescript');
    assert.ok(names.includes('Original'));
    assert.ok(!names.includes('Renamed'));
  });

  it('returns empty for no exports', () => {
    const names = extractExportNames('const x = 1;\nfunction foo() {}', 'typescript');
    assert.equal(names.length, 0);
  });
});

// ── hasPathInGraph helper ────────────────────────────────────

describe('hasPathInGraph', () => {
  it('finds a path when one exists', () => {
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ];
    const result = hasPathInGraph('a', 'c', edges);
    assert.ok(result);
    assert.deepEqual(result, ['a', 'b', 'c']);
  });

  it('returns null when no path exists', () => {
    const edges = [
      { source: 'a', target: 'b' },
    ];
    const result = hasPathInGraph('a', 'c', edges);
    assert.equal(result, null);
  });

  it('respects maxDepth', () => {
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'd' },
    ];
    const result = hasPathInGraph('a', 'd', edges, 2);
    assert.equal(result, null);
  });

  it('handles cycles in graph without infinite loop', () => {
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'a' },
    ];
    // Looking for path from a to d (doesn't exist, but there's a cycle a->b->c->a)
    const result = hasPathInGraph('a', 'd', edges);
    assert.equal(result, null);
  });

  it('returns null for empty edges list', () => {
    const result = hasPathInGraph('a', 'b', []);
    assert.equal(result, null);
  });
});

// ── applyPreferences (via evaluateChange) ────────────────────

describe('applyPreferences (via evaluateChange)', () => {
  function makeCoChangeCtx(preferences: PreferencesStore) {
    const model = {
      files: [
        { relativePath: 'src/types.ts', language: 'typescript', imports: [], exports: ['Foo'], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/app.ts', language: 'typescript', imports: ['./types'], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
        { relativePath: 'src/bar.ts', language: 'typescript', imports: ['./types'], exports: [], symbols: [], loc: 1, functions: [], classes: [] },
      ],
      graph: {
        nodes: [{ id: 'src/types.ts' }, { id: 'src/app.ts' }, { id: 'src/bar.ts' }],
        edges: [
          { source: 'src/app.ts', target: 'src/types.ts', type: 'import', strength: 0.8, symbols: ['Foo'], lines: [1], bidirectional: false },
          { source: 'src/bar.ts', target: 'src/types.ts', type: 'import', strength: 0.7, symbols: ['Foo'], lines: [1], bidirectional: false },
        ],
      },
      metrics: { hubs: [], orphans: [] },
    } as unknown as AnalysisModel;

    return {
      model, agentsContent: '# stub', preferences, recentChanges: [] as any[], fileContents: new Map<string, string>(),
    };
  }

  it('suppresses assessment when allow preference matches', () => {
    let prefs: PreferencesStore = { version: 1, preferences: [] };
    prefs = addPreference(prefs, {
      rule: 'co-change', pattern: 'test', disposition: 'allow', directory: 'src/',
    });
    const results = evaluateChange({ type: 'change', path: 'src/types.ts' }, makeCoChangeCtx(prefs));
    const coChange = results.find((a) => a.rule === 'co-change');
    assert.ok(!coChange, 'Should be suppressed by allow preference');
  });

  it('upgrades warning to violation when deny preference matches', () => {
    let prefs: PreferencesStore = { version: 1, preferences: [] };
    prefs = addPreference(prefs, {
      rule: 'co-change', pattern: 'test', disposition: 'deny', directory: 'src/',
    });
    const results = evaluateChange({ type: 'change', path: 'src/types.ts' }, makeCoChangeCtx(prefs));
    const coChange = results.find((a) => a.rule === 'co-change');
    assert.ok(coChange, 'Should still be present');
    assert.equal(coChange!.type, 'violation');
  });

  it('file-specific preference takes priority over directory', () => {
    let prefs: PreferencesStore = { version: 1, preferences: [] };
    prefs = addPreference(prefs, {
      rule: 'co-change', pattern: 'dir allow', disposition: 'allow', directory: 'src/',
    });
    prefs = addPreference(prefs, {
      rule: 'co-change', pattern: 'file deny', disposition: 'deny', file: 'src/types.ts',
    });
    const results = evaluateChange({ type: 'change', path: 'src/types.ts' }, makeCoChangeCtx(prefs));
    const coChange = results.find((a) => a.rule === 'co-change');
    assert.ok(coChange, 'File-specific deny should keep it');
    assert.equal(coChange!.type, 'violation');
  });

  it('rule-only preference (no file/directory) matches any file', () => {
    let prefs: PreferencesStore = { version: 1, preferences: [] };
    prefs = addPreference(prefs, {
      rule: 'co-change', pattern: 'global allow', disposition: 'allow',
    });
    const results = evaluateChange({ type: 'change', path: 'src/types.ts' }, makeCoChangeCtx(prefs));
    const coChange = results.find((a) => a.rule === 'co-change');
    assert.ok(!coChange, 'Rule-only allow should suppress');
  });

  it('bumps hitCount on matched preference', () => {
    let prefs: PreferencesStore = { version: 1, preferences: [] };
    prefs = addPreference(prefs, {
      rule: 'co-change', pattern: 'test', disposition: 'allow', directory: 'src/',
    });
    assert.equal(prefs.preferences[0].hitCount, undefined);
    evaluateChange({ type: 'change', path: 'src/types.ts' }, makeCoChangeCtx(prefs));
    assert.equal(prefs.preferences[0].hitCount, 1);
  });
});
