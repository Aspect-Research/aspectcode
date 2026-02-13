/**
 * Snapshot test for the analyzeRepo() model.
 *
 * Reads the mini-repo fixture, runs analyzeRepo(), and compares the
 * serializable output against a committed JSON snapshot. This lets us
 * refactor analysis internals freely — if the model changes we update
 * the snapshot deliberately, not by accident.
 *
 * Usage:
 *   cd packages/core
 *   npm test
 *
 * To update the snapshot after intentional changes:
 *   npm run test:snapshot -- --update
 *   (or delete the expected JSON and re-run)
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  analyzeRepo,
  analyzeRepoWithDependencies,
  AnalysisModel,
  computeModelStats,
  toPosix,
} from '../src/index';

// Mocha globals
declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void): void;

// ── Helpers ──────────────────────────────────────────────────

/** Recursively read all files under `dir`, returning Map<relativePath, content> */
function readFixtureFiles(rootDir: string, dir?: string): Map<string, string> {
  const result = new Map<string, string>();
  const scanDir = dir ?? rootDir;

  for (const entry of fs.readdirSync(scanDir, { withFileTypes: true })) {
    const full = path.join(scanDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      for (const [k, v] of readFixtureFiles(rootDir, full)) {
        result.set(k, v);
      }
    } else {
      const rel = path.relative(rootDir, full).replace(/\\/g, '/');
      result.set(rel, fs.readFileSync(full, 'utf8'));
    }
  }
  return result;
}

/**
 * Strip volatile fields (timestamps, absolute paths) so the snapshot
 * comparison is deterministic.
 */
function toComparableSnapshot(model: AnalysisModel) {
  return {
    schemaVersion: model.schemaVersion,
    files: model.files
      .map((f) => ({
        relativePath: f.relativePath,
        language: f.language,
        exports: [...f.exports].sort(),
        imports: [...f.imports].sort(),
      }))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    symbols: model.symbols,
    graph: model.graph,
    metrics: model.metrics,
  };
}

// ── Tests ────────────────────────────────────────────────────

const FIXTURE_DIR = path.resolve(
  __dirname,
  '../../../extension/test/fixtures/mini-repo',
);
const EXPECTED_PATH = path.resolve(__dirname, 'fixtures/mini-repo-expected.json');
const UPDATE_FLAG = process.argv.includes('--update');

describe('analyzeRepo snapshot', () => {
  it('produces the expected model for mini-repo', () => {
    const files = readFixtureFiles(FIXTURE_DIR);
    const model = analyzeRepo(FIXTURE_DIR, files);
    const actual = toComparableSnapshot(model);

    if (UPDATE_FLAG || !fs.existsSync(EXPECTED_PATH)) {
      fs.mkdirSync(path.dirname(EXPECTED_PATH), { recursive: true });
      fs.writeFileSync(EXPECTED_PATH, JSON.stringify(actual, null, 2) + '\n');
      console.log(`  → snapshot written to ${path.relative(process.cwd(), EXPECTED_PATH)}`);
      return;
    }

    const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));
    assert.deepStrictEqual(actual, expected);
  });

  it('model is JSON-serializable (round-trips cleanly)', () => {
    const files = readFixtureFiles(FIXTURE_DIR);
    const model = analyzeRepo(FIXTURE_DIR, files);

    const json = JSON.stringify(model);
    const parsed = JSON.parse(json) as AnalysisModel;

    assert.strictEqual(parsed.files.length, model.files.length);
    assert.strictEqual(parsed.schemaVersion, '0.1');
    assert.ok(parsed.generatedAt, 'should have a generatedAt timestamp');
    assert.ok(Array.isArray(parsed.graph.nodes), 'should have graph.nodes');
    assert.ok(Array.isArray(parsed.graph.edges), 'should have graph.edges');
    assert.ok(Array.isArray(parsed.metrics.hubs), 'should have metrics.hubs');
  });
});

// ── Determinism ──────────────────────────────────────────────

describe('analyzeRepo determinism', () => {
  it('produces identical output on consecutive runs (ignoring generatedAt)', () => {
    const files = readFixtureFiles(FIXTURE_DIR);

    const run1 = analyzeRepo(FIXTURE_DIR, files);
    const run2 = analyzeRepo(FIXTURE_DIR, files);

    // Strip the only volatile field
    const strip = (m: AnalysisModel) => {
      const { generatedAt: _, ...rest } = m;
      return rest;
    };

    assert.deepStrictEqual(strip(run1), strip(run2));
  });
});

describe('analyzeRepoWithDependencies', () => {
  it('adds dependency edges and hub metrics from absolute file map', async () => {
    const root = path.resolve('C:/tmp/aspect-core-test');
    const absMain = path.join(root, 'src', 'main.ts');
    const absUtil = path.join(root, 'src', 'util.ts');

    const relativeFiles = new Map<string, string>([
      ['src/main.ts', "import { format } from './util';\nexport const run = () => format('x');\n"],
      ['src/util.ts', "export function format(v: string){ return v.toUpperCase(); }\n"],
    ]);

    const absoluteFiles = new Map<string, string>([
      [absMain, relativeFiles.get('src/main.ts')!],
      [absUtil, relativeFiles.get('src/util.ts')!],
    ]);

    const model = await analyzeRepoWithDependencies(root, relativeFiles, absoluteFiles);

    assert.ok(model.graph.edges.length > 0, 'expected dependency edges to be present');
    assert.ok(
      model.graph.edges.some(
        (edge) => edge.source === 'src/main.ts' && edge.target === 'src/util.ts',
      ),
      'expected main.ts -> util.ts edge',
    );
    assert.ok(model.metrics.hubs.length > 0, 'expected hub metrics to be present');
    assert.ok(
      model.metrics.hubs.some((hub) => hub.file === 'src/util.ts'),
      'expected util.ts to appear in hubs',
    );
  });
});

// ── Path normalization ───────────────────────────────────────

describe('toPosix', () => {
  it('converts backslashes to forward slashes', () => {
    assert.strictEqual(toPosix('src\\utils\\format.ts'), 'src/utils/format.ts');
  });

  it('strips leading ./', () => {
    assert.strictEqual(toPosix('./src/app.ts'), 'src/app.ts');
  });

  it('collapses consecutive slashes', () => {
    assert.strictEqual(toPosix('src//utils///format.ts'), 'src/utils/format.ts');
  });

  it('is idempotent on posix paths', () => {
    const p = 'src/utils/format.ts';
    assert.strictEqual(toPosix(p), p);
  });

  it('model files use posix paths even when input has backslashes', () => {
    const files = new Map<string, string>();
    files.set('src\\hello.ts', 'export const x = 1;');

    const model = analyzeRepo('C:\\repo', files);
    assert.strictEqual(model.files[0].relativePath, 'src/hello.ts');
  });
});

// ── Model stats ──────────────────────────────────────────────

describe('computeModelStats', () => {
  it('computes correct counts from mini-repo', () => {
    const files = readFixtureFiles(FIXTURE_DIR);
    const model = analyzeRepo(FIXTURE_DIR, files);
    const stats = computeModelStats(model);

    assert.strictEqual(stats.fileCount, model.files.length);
    assert.ok(stats.totalLines > 0, 'should have nonzero total lines');
    assert.ok(stats.languageCount > 0, 'should have at least one language');
    assert.strictEqual(stats.edgeCount, model.graph.edges.length);
    assert.ok(Array.isArray(stats.topHubs), 'topHubs should be an array');
  });

  it('respects topN parameter', () => {
    const files = readFixtureFiles(FIXTURE_DIR);
    const model = analyzeRepo(FIXTURE_DIR, files);
    const stats = computeModelStats(model, 2);

    assert.ok(stats.topHubs.length <= 2, 'should respect topN limit');
  });
});
