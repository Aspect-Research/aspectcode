import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import {
  enforceLineBudget,
  makeRelativePath,
  dedupe,
  dedupeFindings,
  classifyFile,
  isStructuralAppFile,
  isConfigOrToolingFile,
  detectDataModelsLocally,
  detectExternalIntegrationsLocally,
  detectGlobalStateLocally,
  detectEntryPointsWithContent,
  detectEntryPointsByName,
  findModuleClusters,
  findDependencyChains,
  calculateCentralityScores,
  analyzeFileNaming,
  detectFrameworkPatterns,
  buildDepStats,
  extractModelSignature,
} from '../src/kb';
import type { DependencyLink } from '@aspectcode/core';

// ── enforceLineBudget ────────────────────────────────────────

describe('enforceLineBudget', () => {
  it('returns content unchanged when within budget', () => {
    const content = 'line1\nline2\nline3';
    assert.equal(enforceLineBudget(content, 10, 'test.md', '2025-01-01T00:00:00Z'), content);
  });

  it('truncates and appends footer when over budget', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const result = enforceLineBudget(lines.join('\n'), 10, 'test.md', '2025-01-01T00:00:00Z');
    const resultLines = result.split('\n');
    // Budget is a soft guide — footer adds ~4 lines after the truncation point
    assert.ok(resultLines.length < 20, `Expected fewer than original 20 lines, got ${resultLines.length}`);
    assert.ok(result.includes('truncated'), 'Should include truncation notice');
  });

  it('is deterministic with same timestamp', () => {
    const content = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const a = enforceLineBudget(content, 10, 'f.md', '2025-06-01T00:00:00Z');
    const b = enforceLineBudget(content, 10, 'f.md', '2025-06-01T00:00:00Z');
    assert.equal(a, b);
  });

  it('normalizes CRLF newlines for stable line counting', () => {
    const content = 'line1\r\nline2\r\nline3\r\n';
    const result = enforceLineBudget(content, 10, 'test.md', '2026-01-01T00:00:00Z');
    assert.equal(result, 'line1\nline2\nline3\n');
  });

  it('truncates deterministically with CRLF input', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const crlf = lines.join('\r\n');
    const a = enforceLineBudget(crlf, 10, 'f.md', '2026-01-01T00:00:00Z');
    const b = enforceLineBudget(crlf, 10, 'f.md', '2026-01-01T00:00:00Z');
    assert.equal(a, b);
    assert.ok(a.includes('Content truncated'), 'Should include truncation footer');
  });
});

// ── makeRelativePath ─────────────────────────────────────────

describe('makeRelativePath', () => {
  it('strips workspace root and normalizes slashes', () => {
    assert.equal(
      makeRelativePath('C:\\code\\project\\src\\main.ts', 'C:\\code\\project'),
      'src/main.ts',
    );
  });

  it('handles forward slashes', () => {
    assert.equal(
      makeRelativePath('/home/user/project/lib/util.py', '/home/user/project'),
      'lib/util.py',
    );
  });
});

// ── dedupe ───────────────────────────────────────────────────

describe('dedupe', () => {
  it('removes duplicates preserving first occurrence', () => {
    assert.deepEqual(dedupe([1, 2, 3, 2, 1]), [1, 2, 3]);
  });

  it('supports custom key function', () => {
    const items = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 1, v: 'c' }];
    const result = dedupe(items, (x) => String(x.id));
    assert.equal(result.length, 2);
    assert.equal(result[0].v, 'a');
  });
});

// ── dedupeFindings ───────────────────────────────────────────

describe('dedupeFindings', () => {
  it('deduplicates and sorts by file then message', () => {
    const input = [
      { file: 'b.ts', message: 'z' },
      { file: 'a.ts', message: 'y' },
      { file: 'a.ts', message: 'y' },
      { file: 'a.ts', message: 'x' },
    ];
    const result = dedupeFindings(input);
    assert.equal(result.length, 3);
    assert.equal(result[0].file, 'a.ts');
    assert.equal(result[0].message, 'x');
  });
});

// ── classifyFile ─────────────────────────────────────────────

describe('classifyFile', () => {
  it('classifies node_modules as third_party', () => {
    assert.equal(classifyFile('/proj/node_modules/foo/index.js', '/proj'), 'third_party');
  });

  it('classifies test files correctly', () => {
    assert.equal(classifyFile('/proj/src/foo.test.ts', '/proj'), 'test');
    assert.equal(classifyFile('/proj/tests/bar.py', '/proj'), 'test');
  });

  it('classifies normal app files', () => {
    assert.equal(classifyFile('/proj/src/main.ts', '/proj'), 'app');
  });
});

// ── isConfigOrToolingFile ────────────────────────────────────

describe('isConfigOrToolingFile', () => {
  it('detects config files', () => {
    assert.ok(isConfigOrToolingFile('jest.config.ts'));
    assert.ok(isConfigOrToolingFile('tsconfig.json'));
    assert.ok(isConfigOrToolingFile('webpack.config.js'));
  });

  it('does not flag normal files', () => {
    assert.ok(!isConfigOrToolingFile('src/main.ts'));
    assert.ok(!isConfigOrToolingFile('lib/utils.py'));
  });
});

// ── isStructuralAppFile ──────────────────────────────────────

describe('isStructuralAppFile', () => {
  it('excludes migrations', () => {
    // Path must be inside workspace root for makeRelativePath to work
    assert.ok(!isStructuralAppFile('/proj/src/alembic/versions/abc.py', '/proj'));
  });

  it('excludes generated files', () => {
    assert.ok(!isStructuralAppFile('/proj/src/client.gen.ts', '/proj'));
  });

  it('includes normal app code', () => {
    assert.ok(isStructuralAppFile('/proj/src/services/auth.ts', '/proj'));
  });
});

// ── detectDataModelsLocally ──────────────────────────────────

describe('detectDataModelsLocally', () => {
  it('detects Pydantic models', () => {
    const cache = new Map([
      ['/proj/models.py', 'from pydantic import BaseModel\n\nclass User(BaseModel):\n    name: str'],
    ]);
    const results = detectDataModelsLocally(['/proj/models.py'], '/proj', cache);
    assert.ok(results.some((r) => r.message.includes('Pydantic') && r.message.includes('User')));
  });

  it('detects TypeScript interfaces', () => {
    const cache = new Map([
      ['/proj/types.ts', 'export interface UserDTO {\n  id: string;\n}'],
    ]);
    const results = detectDataModelsLocally(['/proj/types.ts'], '/proj', cache);
    assert.ok(results.some((r) => r.message.includes('Interface') && r.message.includes('UserDTO')));
  });

  it('returns empty for non-matching files', () => {
    const cache = new Map([
      ['/proj/main.ts', 'console.log("hello")'],
    ]);
    const results = detectDataModelsLocally(['/proj/main.ts'], '/proj', cache);
    assert.equal(results.length, 0);
  });
});

// ── detectExternalIntegrationsLocally ────────────────────────

describe('detectExternalIntegrationsLocally', () => {
  it('detects database connections', () => {
    const cache = new Map([
      ['/proj/db.ts', 'const pool = createPool({ host: "localhost" })'],
    ]);
    const results = detectExternalIntegrationsLocally(['/proj/db.ts'], '/proj', cache);
    assert.ok(results.some((r) => r.message.includes('Database')));
  });

  it('detects HTTP clients', () => {
    const cache = new Map([
      ['/proj/api.py', 'response = requests.get("https://api.example.com")'],
    ]);
    const results = detectExternalIntegrationsLocally(['/proj/api.py'], '/proj', cache);
    assert.ok(results.some((r) => r.message.includes('HTTP client')));
  });
});

// ── detectGlobalStateLocally ─────────────────────────────────

describe('detectGlobalStateLocally', () => {
  it('detects singleton pattern', () => {
    const cache = new Map([
      ['/proj/service.ts', 'export class MyService { static getInstance() { return instance; } }'],
    ]);
    const results = detectGlobalStateLocally(['/proj/service.ts'], '/proj', cache);
    assert.ok(results.some((r) => r.message.includes('Singleton')));
  });

  it('detects React Context', () => {
    const cache = new Map([
      ['/proj/context.tsx', 'export const AuthCtx = createContext(null);'],
    ]);
    const results = detectGlobalStateLocally(['/proj/context.tsx'], '/proj', cache);
    assert.ok(results.some((r) => r.message.includes('React Context')));
  });
});

// ── detectEntryPointsWithContent ─────────────────────────────

describe('detectEntryPointsWithContent', () => {
  it('detects FastAPI entry point', () => {
    const cache = new Map([
      ['/proj/main.py', 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/health")\ndef health():\n    return {"ok": True}'],
    ]);
    const results = detectEntryPointsWithContent(['/proj/main.py'], '/proj', cache);
    assert.ok(results.length > 0);
    assert.equal(results[0].category, 'runtime');
    assert.ok(results[0].reason.includes('FastAPI'));
  });

  it('detects barrel re-exports', () => {
    const cache = new Map([
      ['/proj/src/index.ts', 'export { Foo } from "./foo";\nexport { Bar } from "./bar";\nexport { Baz } from "./baz";'],
    ]);
    const results = detectEntryPointsWithContent(['/proj/src/index.ts'], '/proj', cache);
    assert.ok(results.some((r) => r.category === 'barrel'));
  });

  it('sorts runtime before tooling before barrel', () => {
    const cache = new Map([
      ['/proj/main.py', 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/")\ndef root(): pass'],
      ['/proj/cli.py', 'if __name__ == "__main__":\n    print("cli")'],
      ['/proj/src/index.ts', 'export { A } from "./a";\nexport { B } from "./b";\nexport { C } from "./c";'],
    ]);
    const results = detectEntryPointsWithContent(
      ['/proj/main.py', '/proj/cli.py', '/proj/src/index.ts'],
      '/proj',
      cache,
    );
    const categories = results.map((r) => r.category);
    const runtimeIdx = categories.indexOf('runtime');
    const toolingIdx = categories.indexOf('tooling');
    const barrelIdx = categories.indexOf('barrel');
    if (runtimeIdx >= 0 && toolingIdx >= 0) assert.ok(runtimeIdx < toolingIdx);
    if (toolingIdx >= 0 && barrelIdx >= 0) assert.ok(toolingIdx < barrelIdx);
  });
});

// ── detectEntryPointsByName ──────────────────────────────────

describe('detectEntryPointsByName', () => {
  it('identifies high-confidence entry points by name', () => {
    const files = ['/proj/main.py', '/proj/server.ts', '/proj/lib/util.py'];
    const results = detectEntryPointsByName(files, '/proj');
    assert.ok(results.some((r) => r.confidence === 'high' && r.path.includes('main')));
    assert.ok(results.some((r) => r.confidence === 'high' && r.path.includes('server')));
    assert.ok(!results.some((r) => r.path.includes('util')));
  });
});

// ── calculateCentralityScores ────────────────────────────────

describe('calculateCentralityScores', () => {
  it('scores inDegree higher than outDegree', () => {
    const links: DependencyLink[] = [
      { source: 'a', target: 'hub', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
      { source: 'b', target: 'hub', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
      { source: 'hub', target: 'c', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
    ];
    const scores = calculateCentralityScores(links);
    const hub = scores.get('hub')!;
    assert.equal(hub.inDegree, 2);
    assert.equal(hub.outDegree, 1);
    assert.equal(hub.score, 2 * 2 + 1); // inDegree * 2 + outDegree
  });
});

// ── findDependencyChains ─────────────────────────────────────

describe('findDependencyChains', () => {
  it('finds chains of length >= 3', () => {
    const links: DependencyLink[] = [
      { source: '/proj/a.ts', target: '/proj/b.ts', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
      { source: '/proj/b.ts', target: '/proj/c.ts', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
      { source: '/proj/c.ts', target: '/proj/d.ts', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
    ];
    const chains = findDependencyChains(links, '/proj');
    assert.ok(chains.length > 0, 'Should find at least one chain');
    // Each chain should have ' → ' separating 3+ modules
    for (const c of chains) {
      assert.ok(c.split(' → ').length >= 3, `Chain too short: ${c}`);
    }
  });

  it('returns deterministic output', () => {
    const links: DependencyLink[] = [
      { source: '/proj/a.ts', target: '/proj/b.ts', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
      { source: '/proj/b.ts', target: '/proj/c.ts', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
      { source: '/proj/c.ts', target: '/proj/d.ts', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
    ];
    const chains1 = findDependencyChains(links, '/proj');
    const chains2 = findDependencyChains(links, '/proj');
    assert.deepEqual(chains1, chains2);
  });
});

// ── findModuleClusters ───────────────────────────────────────

describe('findModuleClusters', () => {
  it('finds clusters when files share importers', () => {
    // a and b import both x and y → x,y should cluster
    const links: DependencyLink[] = [
      { source: '/proj/a.ts', target: '/proj/x.ts', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
      { source: '/proj/a.ts', target: '/proj/y.ts', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
      { source: '/proj/b.ts', target: '/proj/x.ts', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
      { source: '/proj/b.ts', target: '/proj/y.ts', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
    ];
    const clusters = findModuleClusters(links, '/proj');
    assert.ok(clusters.length > 0, 'Should find at least one cluster');
    // The cluster should contain x and y
    const filesInClusters = clusters.flatMap((c) => c.files);
    assert.ok(filesInClusters.some((f) => f.includes('x')));
    assert.ok(filesInClusters.some((f) => f.includes('y')));
  });
});

// ── analyzeFileNaming ────────────────────────────────────────

describe('analyzeFileNaming', () => {
  it('detects dominant kebab-case', () => {
    const files = [
      '/proj/my-component.ts',
      '/proj/another-file.ts',
      '/proj/third-module.ts',
      '/proj/utils.ts',
    ];
    const result = analyzeFileNaming(files, '/proj');
    assert.equal(result.dominant, 'kebab-case');
  });

  it('returns null dominant when no clear winner', () => {
    const files = ['/proj/a.ts', '/proj/b.ts'];
    const result = analyzeFileNaming(files, '/proj');
    assert.equal(result.dominant, null);
  });
});

// ── detectFrameworkPatterns ───────────────────────────────────

describe('detectFrameworkPatterns', () => {
  it('detects React from tsx files', () => {
    const files = ['/proj/src/App.tsx', '/proj/src/components/Button.tsx'];
    const frameworks = detectFrameworkPatterns(files, '/proj');
    assert.ok(frameworks.some((f) => f.name === 'React'));
  });

  it('detects Django from manage.py + urls.py', () => {
    const files = ['/proj/manage.py', '/proj/app/urls.py', '/proj/app/views.py'];
    const frameworks = detectFrameworkPatterns(files, '/proj');
    assert.ok(frameworks.some((f) => f.name === 'Django'));
  });
});

// ── buildDepStats ────────────────────────────────────────────

describe('buildDepStats', () => {
  it('computes in/out degree correctly', () => {
    const files = ['a', 'b', 'c'];
    const links: DependencyLink[] = [
      { source: 'a', target: 'b', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
      { source: 'a', target: 'c', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
      { source: 'b', target: 'c', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
    ];
    const stats = buildDepStats(files, links);
    assert.equal(stats.get('a')!.outDegree, 2);
    assert.equal(stats.get('a')!.inDegree, 0);
    assert.equal(stats.get('c')!.inDegree, 2);
    assert.equal(stats.get('c')!.outDegree, 0);
    assert.equal(stats.get('b')!.inDegree, 1);
    assert.equal(stats.get('b')!.outDegree, 1);
  });
});

// ── extractModelSignature ────────────────────────────────────

describe('extractModelSignature', () => {
  it('extracts Python class fields', () => {
    const cache = new Map([
      ['models.py', 'class User(BaseModel):\n    name: str\n    email: str\n    age: int'],
    ]);
    const sig = extractModelSignature('models.py', 'Pydantic: User', cache);
    assert.ok(sig, 'Should return a signature');
    assert.ok(sig!.includes('User'));
    assert.ok(sig!.includes('name: str'));
  });

  it('extracts TypeScript interface fields', () => {
    const cache = new Map([
      ['types.ts', 'export interface Config {\n  host: string;\n  port: number;\n  debug?: boolean;\n}'],
    ]);
    const sig = extractModelSignature('types.ts', 'Interface: Config', cache);
    assert.ok(sig, 'Should return a signature');
    assert.ok(sig!.includes('Config'));
    assert.ok(sig!.includes('host'));
  });

  it('returns null for missing file', () => {
    const cache = new Map<string, string>();
    assert.equal(extractModelSignature('missing.py', 'Foo', cache), null);
  });
});
