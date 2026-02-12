/**
 * Tests for KB emitters — architecture.md, map.md, context.md content builders
 * and the KBEmitter orchestrator.
 */

import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, afterEach } from 'mocha';
import type { AnalysisModel, DependencyLink } from '@aspectcode/core';
import { buildArchitectureContent } from '../src/kb/architectureEmitter';
import { buildMapContent } from '../src/kb/mapEmitter';
import { buildContextContent } from '../src/kb/contextEmitter';
import { createKBEmitter } from '../src/kb/kbEmitter';
import { buildDepStats } from '../src/kb/depData';
import { createNodeEmitterHost } from '../src/host';

// ── Helpers ──────────────────────────────────────────────────

const FIXED_TIMESTAMP = '2026-01-01T00:00:00.000Z';
const WORKSPACE = '/test/workspace';

/**
 * Build a minimal set of files + links for testing.
 * Uses absolute paths to match how kbEmitter resolves AnalysisModel.
 */
function makeTestData() {
  const files = [
    path.join(WORKSPACE, 'src/app.ts'),
    path.join(WORKSPACE, 'src/utils.ts'),
    path.join(WORKSPACE, 'src/db.ts'),
    path.join(WORKSPACE, 'src/auth/login.ts'),
    path.join(WORKSPACE, 'src/auth/session.ts'),
    path.join(WORKSPACE, 'test/app.test.ts'),
  ];

  const fileContentCache = new Map<string, string>();
  fileContentCache.set(files[0], `
import { format } from './utils';
import { query } from './db';
export class App {
  start() { return format(query('users')); }
}
`);
  fileContentCache.set(files[1], `
export function format(data: any): string { return JSON.stringify(data); }
export function validate(input: string): boolean { return input.length > 0; }
`);
  fileContentCache.set(files[2], `
import { Pool } from 'pg';
const pool = new Pool();
export function query(sql: string) { return pool.query(sql); }
`);
  fileContentCache.set(files[3], `
import { session } from './session';
export async function login(user: string, pass: string) {
  return session.create(user);
}
`);
  fileContentCache.set(files[4], `
export const session = {
  create(user: string) { return { user, token: 'abc' }; },
  destroy() { return true; }
};
`);
  fileContentCache.set(files[5], `
import { App } from '../src/app';
describe('App', () => { it('starts', () => { new App().start(); }); });
`);

  const allLinks: DependencyLink[] = [
    { source: files[0], target: files[1], type: 'import', strength: 1, symbols: ['format'], lines: [1], bidirectional: false },
    { source: files[0], target: files[2], type: 'import', strength: 1, symbols: ['query'], lines: [2], bidirectional: false },
    { source: files[3], target: files[4], type: 'import', strength: 1, symbols: ['session'], lines: [1], bidirectional: false },
    { source: files[5], target: files[0], type: 'import', strength: 1, symbols: ['App'], lines: [1], bidirectional: false },
  ];

  const depData = buildDepStats(files, allLinks);

  return { files, fileContentCache, allLinks, depData };
}

function makeModel(): AnalysisModel {
  return {
    schemaVersion: '0.1',
    generatedAt: FIXED_TIMESTAMP,
    repo: { root: WORKSPACE },
    files: [
      { relativePath: 'src/app.ts', language: 'typescript', lineCount: 50, exports: ['App'], imports: ['./utils', './db'] },
      { relativePath: 'src/utils.ts', language: 'typescript', lineCount: 30, exports: ['format', 'validate'], imports: [] },
      { relativePath: 'src/db.ts', language: 'typescript', lineCount: 20, exports: ['query'], imports: ['pg'] },
      { relativePath: 'src/auth/login.ts', language: 'typescript', lineCount: 15, exports: ['login'], imports: ['./session'] },
      { relativePath: 'src/auth/session.ts', language: 'typescript', lineCount: 10, exports: ['session'], imports: [] },
      { relativePath: 'test/app.test.ts', language: 'typescript', lineCount: 8, exports: [], imports: ['../src/app'] },
    ],
    symbols: [],
    graph: {
      nodes: [
        { id: 'src/app.ts', path: 'src/app.ts', language: 'typescript' },
        { id: 'src/utils.ts', path: 'src/utils.ts', language: 'typescript' },
        { id: 'src/db.ts', path: 'src/db.ts', language: 'typescript' },
        { id: 'src/auth/login.ts', path: 'src/auth/login.ts', language: 'typescript' },
        { id: 'src/auth/session.ts', path: 'src/auth/session.ts', language: 'typescript' },
        { id: 'test/app.test.ts', path: 'test/app.test.ts', language: 'typescript' },
      ],
      edges: [
        { source: 'src/app.ts', target: 'src/utils.ts', type: 'import', strength: 1, symbols: ['format'], lines: [1], bidirectional: false },
        { source: 'src/app.ts', target: 'src/db.ts', type: 'import', strength: 1, symbols: ['query'], lines: [2], bidirectional: false },
        { source: 'src/auth/login.ts', target: 'src/auth/session.ts', type: 'import', strength: 1, symbols: ['session'], lines: [1], bidirectional: false },
        { source: 'test/app.test.ts', target: 'src/app.ts', type: 'import', strength: 1, symbols: ['App'], lines: [1], bidirectional: false },
      ],
    },
    metrics: { hubs: [] },
  };
}

// ── buildArchitectureContent ─────────────────────────────────

describe('buildArchitectureContent', () => {
  it('produces architecture heading', () => {
    const data = makeTestData();
    const result = buildArchitectureContent({
      ...data,
      workspaceRoot: WORKSPACE,
      generatedAt: FIXED_TIMESTAMP,
    });
    assert.ok(result.startsWith('# Architecture\n'));
  });

  it('includes file/dependency counts', () => {
    const data = makeTestData();
    const result = buildArchitectureContent({
      ...data,
      workspaceRoot: WORKSPACE,
      generatedAt: FIXED_TIMESTAMP,
    });
    assert.ok(result.includes('**Files:**'), 'Should include file count');
    assert.ok(result.includes('**Dependencies:**'), 'Should include dependency count');
  });

  it('includes generated timestamp', () => {
    const data = makeTestData();
    const result = buildArchitectureContent({
      ...data,
      workspaceRoot: WORKSPACE,
      generatedAt: FIXED_TIMESTAMP,
    });
    assert.ok(result.includes(FIXED_TIMESTAMP), 'Should include timestamp');
  });

  it('is deterministic', () => {
    const data = makeTestData();
    const input = { ...data, workspaceRoot: WORKSPACE, generatedAt: FIXED_TIMESTAMP };
    const a = buildArchitectureContent(input);
    const b = buildArchitectureContent(input);
    assert.equal(a, b);
  });

  it('handles empty files list', () => {
    const result = buildArchitectureContent({
      files: [],
      depData: new Map(),
      allLinks: [],
      fileContentCache: new Map(),
      workspaceRoot: WORKSPACE,
      generatedAt: FIXED_TIMESTAMP,
    });
    assert.ok(result.includes('_No source files found._'));
  });

  it('includes Tests section when test files exist', () => {
    const data = makeTestData();
    const result = buildArchitectureContent({
      ...data,
      workspaceRoot: WORKSPACE,
      generatedAt: FIXED_TIMESTAMP,
    });
    assert.ok(result.includes('## Tests'), 'Should include Tests section');
    assert.ok(result.includes('**Test files:**'), 'Should include test file count');
  });
});

// ── buildMapContent ──────────────────────────────────────────

describe('buildMapContent', () => {
  it('produces map heading', () => {
    const data = makeTestData();
    const result = buildMapContent({
      ...data,
      grammars: null,
      workspaceRoot: WORKSPACE,
      generatedAt: FIXED_TIMESTAMP,
    });
    assert.ok(result.startsWith('# Map\n'));
  });

  it('includes Symbol Index when links exist', () => {
    const data = makeTestData();
    const result = buildMapContent({
      ...data,
      grammars: null,
      workspaceRoot: WORKSPACE,
      generatedAt: FIXED_TIMESTAMP,
    });
    assert.ok(result.includes('## Symbol Index'), 'Should include symbol index');
  });

  it('includes Conventions section for app files', () => {
    const data = makeTestData();
    const result = buildMapContent({
      ...data,
      grammars: null,
      workspaceRoot: WORKSPACE,
      generatedAt: FIXED_TIMESTAMP,
    });
    assert.ok(result.includes('## Conventions'), 'Should include conventions section');
  });

  it('is deterministic', () => {
    const data = makeTestData();
    const input = {
      ...data,
      grammars: null,
      workspaceRoot: WORKSPACE,
      generatedAt: FIXED_TIMESTAMP,
    };
    const a = buildMapContent(input);
    const b = buildMapContent(input);
    assert.equal(a, b);
  });

  it('includes generated timestamp', () => {
    const data = makeTestData();
    const result = buildMapContent({
      ...data,
      grammars: null,
      workspaceRoot: WORKSPACE,
      generatedAt: FIXED_TIMESTAMP,
    });
    assert.ok(result.includes(FIXED_TIMESTAMP));
  });
});

// ── buildContextContent ──────────────────────────────────────

describe('buildContextContent', () => {
  it('produces context heading', () => {
    const data = makeTestData();
    const result = buildContextContent({
      files: data.files,
      allLinks: data.allLinks,
      fileContentCache: data.fileContentCache,
      workspaceRoot: WORKSPACE,
      generatedAt: FIXED_TIMESTAMP,
    });
    assert.ok(result.startsWith('# Context\n'));
  });

  it('includes Quick Reference section when links exist', () => {
    const data = makeTestData();
    const result = buildContextContent({
      files: data.files,
      allLinks: data.allLinks,
      fileContentCache: data.fileContentCache,
      workspaceRoot: WORKSPACE,
      generatedAt: FIXED_TIMESTAMP,
    });
    assert.ok(result.includes('## Quick Reference'), 'Should include quick reference');
  });

  it('handles no app-to-app links gracefully', () => {
    const result = buildContextContent({
      files: [path.join(WORKSPACE, 'src/app.ts')],
      allLinks: [],
      fileContentCache: new Map(),
      workspaceRoot: WORKSPACE,
      generatedAt: FIXED_TIMESTAMP,
    });
    assert.ok(result.includes('_No dependency data available.'));
  });

  it('is deterministic', () => {
    const data = makeTestData();
    const input = {
      files: data.files,
      allLinks: data.allLinks,
      fileContentCache: data.fileContentCache,
      workspaceRoot: WORKSPACE,
      generatedAt: FIXED_TIMESTAMP,
    };
    const a = buildContextContent(input);
    const b = buildContextContent(input);
    assert.equal(a, b);
  });

  it('includes generated timestamp', () => {
    const data = makeTestData();
    const result = buildContextContent({
      files: data.files,
      allLinks: data.allLinks,
      fileContentCache: data.fileContentCache,
      workspaceRoot: WORKSPACE,
      generatedAt: FIXED_TIMESTAMP,
    });
    assert.ok(result.includes(FIXED_TIMESTAMP));
  });
});

// ── createKBEmitter (orchestrator) ───────────────────────────

describe('createKBEmitter', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('has name "aspect-kb"', () => {
    const emitter = createKBEmitter();
    assert.equal(emitter.name, 'aspect-kb');
  });

  it('writes three KB files to .aspect/ directory', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-kb-test-'));
    const host = createNodeEmitterHost();
    const model = makeModel();

    // Pre-load file contents for the model
    const fileContents = new Map<string, string>();
    const testData = makeTestData();
    for (const [absPath, content] of testData.fileContentCache) {
      fileContents.set(absPath.replace(WORKSPACE, tmpDir), content);
    }

    // Adjust model to use tmpDir
    const localModel: AnalysisModel = {
      ...model,
      repo: { root: tmpDir },
      graph: {
        ...model.graph,
        edges: model.graph.edges.map((e) => ({
          ...e,
          source: e.source,
          target: e.target,
        })),
      },
    };

    const emitter = createKBEmitter();
    const result = await emitter.emit(localModel, host, {
      workspaceRoot: tmpDir,
      generatedAt: FIXED_TIMESTAMP,
      fileContents,
    });

    assert.equal(result.filesWritten.length, 3, 'Should write 3 files');

    // Verify files exist on disk
    const archPath = path.join(tmpDir, '.aspect', 'architecture.md');
    const mapPath = path.join(tmpDir, '.aspect', 'map.md');
    const ctxPath = path.join(tmpDir, '.aspect', 'context.md');

    assert.ok(fs.existsSync(archPath), 'architecture.md should exist');
    assert.ok(fs.existsSync(mapPath), 'map.md should exist');
    assert.ok(fs.existsSync(ctxPath), 'context.md should exist');

    // Verify content starts with correct headings
    const archContent = fs.readFileSync(archPath, 'utf-8');
    const mapContent = fs.readFileSync(mapPath, 'utf-8');
    const ctxContent = fs.readFileSync(ctxPath, 'utf-8');

    assert.ok(archContent.startsWith('# Architecture\n'));
    assert.ok(mapContent.startsWith('# Map\n'));
    assert.ok(ctxContent.startsWith('# Context\n'));
  });

  it('is deterministic across runs', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-kb-test-'));
    const host = createNodeEmitterHost();
    const model = makeModel();

    const localModel: AnalysisModel = {
      ...model,
      repo: { root: tmpDir },
    };

    const emitter = createKBEmitter();
    const opts = {
      workspaceRoot: tmpDir,
      generatedAt: FIXED_TIMESTAMP,
      fileContents: new Map<string, string>(),
    };

    await emitter.emit(localModel, host, opts);
    const archContent1 = fs.readFileSync(path.join(tmpDir, '.aspect', 'architecture.md'), 'utf-8');
    const mapContent1 = fs.readFileSync(path.join(tmpDir, '.aspect', 'map.md'), 'utf-8');
    const ctxContent1 = fs.readFileSync(path.join(tmpDir, '.aspect', 'context.md'), 'utf-8');

    // Run again
    await emitter.emit(localModel, host, opts);
    const archContent2 = fs.readFileSync(path.join(tmpDir, '.aspect', 'architecture.md'), 'utf-8');
    const mapContent2 = fs.readFileSync(path.join(tmpDir, '.aspect', 'map.md'), 'utf-8');
    const ctxContent2 = fs.readFileSync(path.join(tmpDir, '.aspect', 'context.md'), 'utf-8');

    assert.equal(archContent1, archContent2, 'architecture.md should be deterministic');
    assert.equal(mapContent1, mapContent2, 'map.md should be deterministic');
    assert.equal(ctxContent1, ctxContent2, 'context.md should be deterministic');
  });

  it('creates .aspect directory if it does not exist', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-kb-test-'));
    const host = createNodeEmitterHost();
    const model = makeModel();

    const localModel: AnalysisModel = {
      ...model,
      repo: { root: tmpDir },
    };

    const emitter = createKBEmitter();
    await emitter.emit(localModel, host, {
      workspaceRoot: tmpDir,
      generatedAt: FIXED_TIMESTAMP,
      fileContents: new Map<string, string>(),
    });

    assert.ok(fs.existsSync(path.join(tmpDir, '.aspect')), '.aspect/ dir should exist');
  });
});

// ── analyzeTestOrganization ──────────────────────────────────

describe('analyzeTestOrganization', () => {
  // Import separately since it's newly added
  const { analyzeTestOrganization } = require('../src/kb/conventions');

  it('identifies test files by name', () => {
    const files = [
      path.join(WORKSPACE, 'src/app.ts'),
      path.join(WORKSPACE, 'test/app.test.ts'),
      path.join(WORKSPACE, 'test/utils.spec.ts'),
    ];
    const result = analyzeTestOrganization(files, WORKSPACE);
    assert.equal(result.testFiles.length, 2);
  });

  it('identifies test directories', () => {
    const files = [
      path.join(WORKSPACE, 'test/unit/app.test.ts'),
    ];
    const result = analyzeTestOrganization(files, WORKSPACE);
    assert.ok(result.testDirs.length > 0, 'Should identify test directories');
  });

  it('detects test patterns', () => {
    const files = [
      path.join(WORKSPACE, 'test/app.test.ts'),
      path.join(WORKSPACE, 'test/utils.spec.ts'),
    ];
    const result = analyzeTestOrganization(files, WORKSPACE);
    assert.ok(result.testPatterns.includes('*.test.ts'));
    assert.ok(result.testPatterns.includes('*.spec.ts'));
  });

  it('returns sorted results for determinism', () => {
    const files = [
      path.join(WORKSPACE, 'test/z.test.ts'),
      path.join(WORKSPACE, 'test/a.test.ts'),
    ];
    const result = analyzeTestOrganization(files, WORKSPACE);
    assert.ok(result.testFiles[0] < result.testFiles[1], 'Test files should be sorted');
  });
});
