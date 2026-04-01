/**
 * End-to-end tests for the file watcher and change pipeline.
 *
 * Tests createFileWatcher (the exact code path used by watch mode)
 * against real filesystem operations, and verifies the full chain from
 * fs event → onFsEvent → evaluateEvents → store counter/assessments.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFileWatcher, isSupportedSourceFile, isIgnoredPath } from '../src/pipeline';
import type { FileChangeEvent } from '../src/pipeline';
import { updateRuntimeState, resetRuntimeState, getRuntimeState } from '../src/runtimeState';
import { store } from '../src/ui/store';
import { evaluateChange, trackChange, getRecentChanges, clearRecentChanges } from '../src/changeEvaluator';
import { loadPreferences, addPreference, formatPreferencesForPrompt } from '../src/preferences';
import type { PreferencesStore } from '../src/preferences';
import type { AnalysisModel } from '@aspectcode/core';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForEvents(
  events: FileChangeEvent[],
  count: number,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (events.length >= count) return resolve();
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for ${count} events, got ${events.length}: ${JSON.stringify(events)}`));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

function waitForStoreChanges(target: number, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if ((store as any).state.assessmentStats.changes >= target) return resolve();
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for ${target} store changes, got ${(store as any).state.assessmentStats.changes}`));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

/** Reset ALL shared singleton state between tests. */
function resetAllState(): void {
  resetRuntimeState();
  clearRecentChanges();
  // Reset store assessment state (resetRun doesn't touch these)
  Object.assign((store as any).state, {
    pendingAssessments: [],
    currentAssessment: null,
    assessmentStats: { ok: 0, warnings: 0, violations: 0, dismissed: 0, confirmed: 0, changes: 0 },
    consecutiveOk: 0,
    preferenceCount: 0,
    learnedMessage: '',
    recommendProbe: false,
    lastChangeFlash: '',
    addCount: 0,
    changeCount: 0,
    correctionCount: 0,
    dreamPrompt: false,
    dreaming: false,
    managedFiles: [],
  });
  store.resetRun();
  store.setPhase('watching');
}

// ── createFileWatcher unit tests ─────────────────────────────

describe('createFileWatcher', () => {
  let tmpDir: string;
  let watcher: fs.FSWatcher | undefined;
  let collected: FileChangeEvent[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-watch-'));
    collected = [];
    fs.writeFileSync(path.join(tmpDir, 'existing.ts'), 'const a = 1;\n');
  });

  afterEach(() => {
    if (watcher) { watcher.close(); watcher = undefined; }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects a change to an existing .ts file', async () => {
    watcher = createFileWatcher(tmpDir, (type, relPath) => {
      collected.push({ type, path: relPath });
    });
    await delay(300);
    fs.writeFileSync(path.join(tmpDir, 'existing.ts'), 'const a = 2;\n');
    await waitForEvents(collected, 1);
    const ev = collected.find((e) => e.path === 'existing.ts' && e.type === 'change');
    assert.ok(ev, `Expected 'change' for existing.ts, got: ${JSON.stringify(collected)}`);
  }).timeout(10000);

  it('detects a new .ts file creation', async () => {
    watcher = createFileWatcher(tmpDir, (type, relPath) => {
      collected.push({ type, path: relPath });
    });
    await delay(300);
    fs.writeFileSync(path.join(tmpDir, 'newfile.ts'), 'const b = 1;\n');
    await waitForEvents(collected, 1);
    const ev = collected.find((e) => e.path === 'newfile.ts' && e.type === 'add');
    assert.ok(ev, `Expected 'add' for newfile.ts, got: ${JSON.stringify(collected)}`);
  }).timeout(10000);

  it('detects file deletion (unlink)', async () => {
    watcher = createFileWatcher(tmpDir, (type, relPath) => {
      collected.push({ type, path: relPath });
    });
    await delay(300);
    fs.unlinkSync(path.join(tmpDir, 'existing.ts'));
    await waitForEvents(collected, 1);
    const ev = collected.find((e) => e.path === 'existing.ts' && e.type === 'unlink');
    assert.ok(ev, `Expected 'unlink' for existing.ts, got: ${JSON.stringify(collected)}`);
  }).timeout(10000);

  it('detects changes in a subdirectory', async () => {
    const subDir = path.join(tmpDir, 'src');
    fs.mkdirSync(subDir);
    watcher = createFileWatcher(tmpDir, (type, relPath) => {
      collected.push({ type, path: relPath });
    });
    await delay(300);
    fs.writeFileSync(path.join(subDir, 'nested.ts'), 'const c = 1;\n');
    await waitForEvents(collected, 1);
    const ev = collected.find((e) => e.path === 'src/nested.ts');
    assert.ok(ev, `Expected event for src/nested.ts, got: ${JSON.stringify(collected)}`);
  }).timeout(10000);

  it('ignores non-source files (e.g. .txt)', async () => {
    watcher = createFileWatcher(tmpDir, (type, relPath) => {
      collected.push({ type, path: relPath });
    });
    await delay(300);
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'hello');
    await delay(1000);
    assert.equal(collected.filter((e) => e.path.includes('readme')).length, 0);
  }).timeout(10000);

  it('ignores node_modules paths', async () => {
    const nmDir = path.join(tmpDir, 'node_modules', 'pkg');
    fs.mkdirSync(nmDir, { recursive: true });
    watcher = createFileWatcher(tmpDir, (type, relPath) => {
      collected.push({ type, path: relPath });
    });
    await delay(300);
    fs.writeFileSync(path.join(nmDir, 'index.ts'), 'export default 1;\n');
    await delay(1000);
    assert.equal(collected.filter((e) => e.path.includes('node_modules')).length, 0);
  }).timeout(10000);
});

// ── Full pipeline chain: watcher → debounce → evaluate → store ──

describe('watcher → evaluate → store (full chain)', () => {
  let tmpDir: string;
  let watcher: fs.FSWatcher | undefined;

  /**
   * Create a watcher wired into the full pipeline evaluation chain.
   * This is a faithful copy of what runPipeline() does.
   */
  async function startWatcher(): Promise<fs.FSWatcher> {
    const prefs = await loadPreferences(tmpDir);
    const EVAL_DEBOUNCE_MS = 500;
    let evalTimer: NodeJS.Timeout | undefined;
    const pendingEvalEvents: FileChangeEvent[] = [];

    const evaluateEvents = (events: FileChangeEvent[]): void => {
      const state = getRuntimeState();
      if (!state.model || !state.agentsContent) {
        throw new Error('Runtime state not populated');
      }
      for (const event of events) {
        trackChange(event);
        if (event.type !== 'unlink') {
          try {
            const absPath = path.join(tmpDir, event.path);
            if (fs.existsSync(absPath)) {
              const content = fs.readFileSync(absPath, 'utf-8');
              state.fileContents?.set(event.path, content);
            }
          } catch { /* skip */ }
        }
        const assessments = evaluateChange(event, {
          model: state.model,
          agentsContent: state.agentsContent,
          preferences: prefs,
          recentChanges: getRecentChanges(),
          fileContents: state.fileContents,
        });
        store.pushAssessments(assessments);
      }
    };

    const onFsEvent = (eventType: 'add' | 'change' | 'unlink', eventPath: string) => {
      const abs = path.resolve(tmpDir, eventPath);
      if (!isSupportedSourceFile(abs) || isIgnoredPath(abs)) return;
      const posixPath = eventPath.replace(/\\/g, '/');
      pendingEvalEvents.push({ type: eventType, path: posixPath });
      if (evalTimer) clearTimeout(evalTimer);
      evalTimer = setTimeout(() => {
        evalTimer = undefined;
        const batch = pendingEvalEvents.splice(0);
        evaluateEvents(batch);
      }, EVAL_DEBOUNCE_MS);
    };

    return createFileWatcher(tmpDir, onFsEvent);
  }

  beforeEach(() => {
    resetAllState();
  });

  afterEach(() => {
    if (watcher) { watcher.close(); watcher = undefined; }
    resetRuntimeState();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupFiles(files: { rel: string; content: string; imports?: string[] }[]): void {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-chain-'));
    for (const f of files) {
      const abs = path.join(tmpDir, f.rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.content);
    }
  }

  function seedModel(
    files: { rel: string; content: string; imports?: string[] }[],
    opts?: {
      hubs?: { file: string; inDegree: number; outDegree: number }[];
      edges?: { source: string; target: string; type: string; strength: number; symbols: string[]; lines: number[]; bidirectional: boolean }[];
    },
  ): void {
    const model = {
      files: files.map((f) => ({
        relativePath: f.rel,
        absolutePath: path.join(tmpDir, f.rel),
        language: 'typescript',
        imports: f.imports ?? [],
        exports: [],
        symbols: [],
        loc: 1,
        functions: [],
        classes: [],
      })),
      graph: {
        nodes: files.map((f) => ({ id: f.rel })),
        edges: opts?.edges ?? [],
      },
      metrics: {
        hubs: opts?.hubs ?? [],
        orphans: [],
      },
    } as unknown as AnalysisModel;

    updateRuntimeState({
      model,
      agentsContent: '# AGENTS.md stub',
      kbContent: 'stub',
      fileContents: new Map(files.map((f) => [f.rel, f.content])),
    });
  }

  // ── Counter tests ──────────────────────────────────────────

  it('change counter increments when echoing to an existing .ts file', async () => {
    setupFiles([
      { rel: 'src/app.ts', content: 'const x = 1;\n' },
    ]);
    seedModel([
      { rel: 'src/app.ts', content: 'const x = 1;\n' },
    ]);
    watcher = await startWatcher();

    assert.equal((store as any).state.assessmentStats.changes, 0);
    await delay(300);
    fs.appendFileSync(path.join(tmpDir, 'src', 'app.ts'), '// echoed\n');
    await waitForStoreChanges(1);
    assert.ok((store as any).state.assessmentStats.changes > 0);
  }).timeout(10000);

  it('change counter increments for new file creation', async () => {
    setupFiles([
      { rel: 'src/app.ts', content: 'const x = 1;\n' },
    ]);
    seedModel([
      { rel: 'src/app.ts', content: 'const x = 1;\n' },
    ]);
    watcher = await startWatcher();

    await delay(300);
    fs.writeFileSync(path.join(tmpDir, 'src', 'newModule.ts'), 'export const z = 3;\n');
    await waitForStoreChanges(1);
    assert.ok((store as any).state.assessmentStats.changes > 0);
  }).timeout(10000);

  // ── Assessment: co-change warning ──────────────────────────

  it('co-change warning fires when a file with strong dependents is modified', async () => {
    const files = [
      { rel: 'src/types.ts', content: 'export interface Foo {}\n' },
      { rel: 'src/app.ts', content: 'import { Foo } from "./types";\n', imports: ['./types'] },
      { rel: 'src/bar.ts', content: 'import { Foo } from "./types";\n', imports: ['./types'] },
    ];
    setupFiles(files);
    seedModel(files, {
      hubs: [{ file: 'src/types.ts', inDegree: 2, outDegree: 0 }],
      edges: [
        { source: 'src/app.ts', target: 'src/types.ts', type: 'import', strength: 1, symbols: ['Foo'], lines: [1], bidirectional: false },
        { source: 'src/bar.ts', target: 'src/types.ts', type: 'import', strength: 1, symbols: ['Foo'], lines: [1], bidirectional: false },
      ],
    });
    watcher = await startWatcher();

    await delay(300);
    fs.appendFileSync(path.join(tmpDir, 'src', 'types.ts'), 'export interface Bar {}\n');
    await waitForStoreChanges(1);

    const stats = (store as any).state.assessmentStats;
    assert.ok(stats.warnings > 0, `Expected co-change warning, stats: ${JSON.stringify(stats)}`);

    const current = (store as any).state.currentAssessment;
    const pending = (store as any).state.pendingAssessments;
    const all = current ? [current, ...pending] : pending;
    const coChangeWarning = all.find((a: any) => a.rule === 'co-change');
    assert.ok(coChangeWarning, `Expected co-change assessment in: ${JSON.stringify(all)}`);
    assert.ok(coChangeWarning.message.includes('dependents'));
    assert.ok(coChangeWarning.dependencyContext, 'Expected dependencyContext');
  }).timeout(10000);

  // ── Assessment: naming convention warning ──────────────────

  it('naming convention warning fires for mismatched file name', async () => {
    const files = [
      { rel: 'src/components/AthleteCard.tsx', content: 'export default 1;\n' },
      { rel: 'src/components/NavBar.tsx', content: 'export default 2;\n' },
      { rel: 'src/components/ControlBar.tsx', content: 'export default 3;\n' },
    ];
    setupFiles(files);
    seedModel(files);
    watcher = await startWatcher();

    await delay(300);
    // snake_case file in a PascalCase directory → naming mismatch
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'components', 'bad_naming.tsx'),
      'export default function BadNaming() { return null; }\n',
    );
    await waitForStoreChanges(1);

    const stats = (store as any).state.assessmentStats;
    assert.ok(stats.warnings > 0, `Expected naming-convention warning, stats: ${JSON.stringify(stats)}`);

    const current = (store as any).state.currentAssessment;
    const pending = (store as any).state.pendingAssessments;
    const all = current ? [current, ...pending] : pending;
    const naming = all.find((a: any) => a.rule === 'naming-convention');
    assert.ok(naming, `Expected naming-convention in: ${JSON.stringify(all)}`);
  }).timeout(10000);

  // ── Assessment: directory convention warning ───────────────

  it('directory convention warning fires for test file in wrong directory', async () => {
    const files = [
      { rel: 'src/app.ts', content: 'const x = 1;\n' },
      { rel: 'test/app.test.ts', content: 'describe("app", () => {});\n' },
      { rel: 'test/utils.test.ts', content: 'describe("utils", () => {});\n' },
    ];
    setupFiles(files);
    seedModel(files);
    watcher = await startWatcher();

    await delay(300);
    // Test file in a brand-new directory (not test/)
    fs.mkdirSync(path.join(tmpDir, 'src', 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'lib', 'helper.test.ts'),
      'describe("helper", () => { it("works", () => {}); });\n',
    );
    await waitForStoreChanges(1);

    const stats = (store as any).state.assessmentStats;
    assert.ok(stats.warnings > 0, `Expected directory-convention warning, stats: ${JSON.stringify(stats)}`);

    const current = (store as any).state.currentAssessment;
    const pending = (store as any).state.pendingAssessments;
    const all = current ? [current, ...pending] : pending;
    const dirWarn = all.find((a: any) => a.rule === 'directory-convention');
    assert.ok(dirWarn, `Expected directory-convention in: ${JSON.stringify(all)}`);
  }).timeout(10000);

  // ── Assessment: import-hub warning ─────────────────────────

  it('import-hub warning fires when adding import from a hub file', async () => {
    const files = [
      { rel: 'src/types.ts', content: 'export interface Foo {}\n' },
      { rel: 'src/app.ts', content: 'const x = 1;\n' },
    ];
    setupFiles(files);
    seedModel(files, {
      hubs: [{ file: 'src/types.ts', inDegree: 5, outDegree: 0 }],
      edges: [],
    });
    watcher = await startWatcher();

    await delay(300);
    // Modify app.ts to add import from the hub
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      'import { Foo } from "./types";\nconst x: Foo = {};\n',
    );
    await waitForStoreChanges(1);

    const stats = (store as any).state.assessmentStats;
    assert.ok(stats.warnings > 0, `Expected import-hub warning, stats: ${JSON.stringify(stats)}`);

    const current = (store as any).state.currentAssessment;
    const pending = (store as any).state.pendingAssessments;
    const all = current ? [current, ...pending] : pending;
    const importWarn = all.find((a: any) => a.rule === 'import-hub');
    assert.ok(importWarn, `Expected import-hub in: ${JSON.stringify(all)}`);
  }).timeout(10000);

  // ── Preference learning ────────────────────────────────────

  it('dismissed warning is suppressed by preferences on next occurrence', async () => {
    const files = [
      { rel: 'src/types.ts', content: 'export interface Foo {}\n' },
      { rel: 'src/app.ts', content: 'import { Foo } from "./types";\n', imports: ['./types'] },
      { rel: 'src/bar.ts', content: 'import { Foo } from "./types";\n', imports: ['./types'] },
    ];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-pref-'));
    for (const f of files) {
      const abs = path.join(tmpDir, f.rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.content);
    }

    const model = {
      files: files.map((f) => ({
        relativePath: f.rel,
        absolutePath: path.join(tmpDir, f.rel),
        language: 'typescript',
        imports: f.imports ?? [],
        exports: [], symbols: [], loc: 1, functions: [], classes: [],
      })),
      graph: {
        nodes: files.map((f) => ({ id: f.rel })),
        edges: [
          { source: 'src/app.ts', target: 'src/types.ts', type: 'import', strength: 1, symbols: ['Foo'], lines: [1], bidirectional: false },
          { source: 'src/bar.ts', target: 'src/types.ts', type: 'import', strength: 0.8, symbols: ['Foo'], lines: [1], bidirectional: false },
        ],
      },
      metrics: {
        hubs: [{ file: 'src/types.ts', inDegree: 2, outDegree: 0 }],
        orphans: [],
      },
    } as unknown as AnalysisModel;

    let prefs: PreferencesStore = { version: 1, preferences: [] };

    // First: warning fires
    const assessments1 = evaluateChange(
      { type: 'change', path: 'src/types.ts' },
      { model, agentsContent: '# stub', preferences: prefs, recentChanges: [], fileContents: new Map() },
    );
    assert.ok(assessments1.length > 0, 'Should produce warning before dismiss');
    const warning = assessments1.find((a) => a.rule === 'co-change');
    assert.ok(warning);

    // Simulate [n] dismiss — adds 'allow' preference in-memory
    prefs = addPreference(prefs, {
      rule: warning!.rule,
      pattern: warning!.message,
      disposition: 'allow',
      directory: 'src/',
    });

    // Second: same warning is now suppressed
    clearRecentChanges();
    const assessments2 = evaluateChange(
      { type: 'change', path: 'src/types.ts' },
      { model, agentsContent: '# stub', preferences: prefs, recentChanges: [], fileContents: new Map() },
    );
    const coChange2 = assessments2.find((a) => a.rule === 'co-change');
    assert.ok(!coChange2, `Should be suppressed, got: ${JSON.stringify(assessments2)}`);
    assert.ok(prefs.preferences.length > 0, 'Preference should be stored');
  }).timeout(10000);
});

// ── Helper function unit tests ───────────────────────────────

describe('isSupportedSourceFile', () => {
  it('accepts .ts files', () => assert.ok(isSupportedSourceFile('foo.ts')));
  it('accepts .js files', () => assert.ok(isSupportedSourceFile('bar.js')));
  it('rejects .txt files', () => assert.ok(!isSupportedSourceFile('readme.txt')));
  it('rejects .md files', () => assert.ok(!isSupportedSourceFile('README.md')));
});

describe('isIgnoredPath', () => {
  it('ignores node_modules', () => assert.ok(isIgnoredPath('/project/node_modules/pkg/index.ts')));
  it('ignores .git', () => assert.ok(isIgnoredPath('/project/.git/config')));
  it('ignores dist', () => assert.ok(isIgnoredPath('/project/dist/main.js')));
  it('allows normal source paths', () => assert.ok(!isIgnoredPath('/project/src/app.ts')));
});

// ── Enriched preferences ────────────────────────────────────

describe('enriched preferences', () => {
  it('stores file, details, and suggestion fields', () => {
    const store: PreferencesStore = { version: 1, preferences: [] };
    const updated = addPreference(store, {
      rule: 'naming-convention',
      pattern: 'File uses snake_case in a PascalCase directory',
      disposition: 'deny',
      file: 'src/components/bad_naming.tsx',
      directory: 'src/components/',
      details: 'Existing files use PascalCase: AthleteCard.tsx, NavBar.tsx',
      suggestion: 'Rename to BadNaming.tsx',
    });

    assert.equal(updated.preferences.length, 1);
    const pref = updated.preferences[0];
    assert.equal(pref.file, 'src/components/bad_naming.tsx');
    assert.equal(pref.details, 'Existing files use PascalCase: AthleteCard.tsx, NavBar.tsx');
    assert.equal(pref.suggestion, 'Rename to BadNaming.tsx');
    assert.equal(pref.disposition, 'deny');
  });

  it('file-scoped and directory-scoped prefs for same rule get distinct IDs', () => {
    let store: PreferencesStore = { version: 1, preferences: [] };
    store = addPreference(store, {
      rule: 'naming-convention',
      pattern: 'snake_case in PascalCase dir',
      disposition: 'allow',
      directory: 'src/components/',
    });
    store = addPreference(store, {
      rule: 'naming-convention',
      pattern: 'snake_case in PascalCase dir',
      disposition: 'deny',
      file: 'src/components/bad_naming.tsx',
      directory: 'src/components/',
    });
    assert.equal(store.preferences.length, 2);
    assert.notEqual(store.preferences[0].id, store.preferences[1].id);
  });
});

// ── formatPreferencesForPrompt ──────────────────────────────

describe('formatPreferencesForPrompt', () => {
  it('returns empty string when no deny preferences', () => {
    const store: PreferencesStore = { version: 1, preferences: [] };
    assert.equal(formatPreferencesForPrompt(store), '');
  });

  it('returns empty string when only allow preferences', () => {
    let store: PreferencesStore = { version: 1, preferences: [] };
    store = addPreference(store, {
      rule: 'co-change',
      pattern: 'Hub file modified',
      disposition: 'allow',
      directory: 'src/',
    });
    assert.equal(formatPreferencesForPrompt(store), '');
  });

  it('formats deny preferences as natural language', () => {
    let store: PreferencesStore = { version: 1, preferences: [] };
    store = addPreference(store, {
      rule: 'naming-convention',
      pattern: 'snake_case in PascalCase dir',
      disposition: 'deny',
      file: 'src/components/bad_naming.tsx',
      directory: 'src/components/',
    });
    const result = formatPreferencesForPrompt(store);
    assert.ok(result.includes('Previous preferences'));
    assert.ok(result.includes('naming-convention'));
    assert.ok(result.includes('src/components/bad_naming.tsx'));
  });
});

// ── Store: recommendProbe and change flash ──────────────────

describe('store recommend and flash state', () => {
  beforeEach(() => {
    // Reset store state
    Object.assign((store as any).state, {
      pendingAssessments: [],
      currentAssessment: null,
      assessmentStats: { ok: 0, warnings: 0, violations: 0, dismissed: 0, confirmed: 0, changes: 0 },
      consecutiveOk: 0,
      preferenceCount: 0,
      learnedMessage: '',
      recommendProbe: false,
      lastChangeFlash: '',
      addCount: 0,
      changeCount: 0,
    });
    store.resetRun();
  });

  it('setRecommendProbe updates state', () => {
    assert.equal((store as any).state.recommendProbe, false);
    store.setRecommendProbe(true);
    assert.equal((store as any).state.recommendProbe, true);
    store.setRecommendProbe(false);
    assert.equal((store as any).state.recommendProbe, false);
  });

  it('setLastChangeFlash updates state', () => {
    assert.equal((store as any).state.lastChangeFlash, '');
    store.setLastChangeFlash('src/app.ts — ok');
    assert.equal((store as any).state.lastChangeFlash, 'src/app.ts — ok');
  });

  it('incrementAddCount and incrementChangeCount track separately', () => {
    store.incrementAddCount();
    store.incrementAddCount();
    store.incrementChangeCount();
    assert.equal((store as any).state.addCount, 2);
    assert.equal((store as any).state.changeCount, 1);
  });

  it('resetRun clears recommend and counts', () => {
    store.setRecommendProbe(true);
    store.setLastChangeFlash('test');
    store.incrementAddCount();
    store.incrementChangeCount();
    store.resetRun();
    assert.equal((store as any).state.recommendProbe, false);
    assert.equal((store as any).state.lastChangeFlash, '');
    assert.equal((store as any).state.addCount, 0);
    assert.equal((store as any).state.changeCount, 0);
  });

  it('setCorrectionCount updates state', () => {
    assert.equal((store as any).state.correctionCount, 0);
    store.setCorrectionCount(7);
    assert.equal((store as any).state.correctionCount, 7);
  });

  it('setDreamPrompt updates state', () => {
    assert.equal((store as any).state.dreamPrompt, false);
    store.setDreamPrompt(true);
    assert.equal((store as any).state.dreamPrompt, true);
    store.setDreamPrompt(false);
    assert.equal((store as any).state.dreamPrompt, false);
  });

  it('setDreaming updates state', () => {
    assert.equal((store as any).state.dreaming, false);
    store.setDreaming(true);
    assert.equal((store as any).state.dreaming, true);
  });

  it('resetRun clears dream state', () => {
    store.setDreamPrompt(true);
    store.setDreaming(true);
    store.resetRun();
    assert.equal((store as any).state.dreamPrompt, false);
    assert.equal((store as any).state.dreaming, false);
  });

  it('resetRun preserves correctionCount', () => {
    store.setCorrectionCount(3);
    store.resetRun();
    assert.equal((store as any).state.correctionCount, 3);
  });
});

