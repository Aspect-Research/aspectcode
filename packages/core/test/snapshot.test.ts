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
import { analyzeRepo, RepoModel } from '../src/index';

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
 * Strip volatile fields (timestamps, line counts that shift with formatting)
 * so the snapshot comparison is deterministic.
 */
function toComparableSnapshot(model: RepoModel) {
  return {
    files: model.files
      .map((f) => ({
        relativePath: f.relativePath,
        language: f.language,
        exports: [...f.exports].sort(),
        imports: [...f.imports].sort(),
      }))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    stats: {
      totalFiles: model.stats.totalFiles,
      languages: model.stats.languages,
    },
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
    const parsed = JSON.parse(json) as RepoModel;

    assert.strictEqual(parsed.files.length, model.files.length);
    assert.strictEqual(parsed.stats.totalFiles, model.stats.totalFiles);
    assert.ok(parsed.generatedAt, 'should have a generatedAt timestamp');
  });
});
