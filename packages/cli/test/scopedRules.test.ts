/**
 * Tests for scoped rule generation — extractors, serializers, manifest, platform detection.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AnalysisModel } from '@aspectcode/core';
import {
  extractHubRules,
  extractConventionRules,
  extractCircularDepRules,
  extractScopedRules,
  serializeForClaudeCode,
  serializeForCursor,
  resolvePlatform,
  writeScopedRules,
} from '../src/scopedRules';
import { createNodeEmitterHost } from '@aspectcode/emitters';

function makeModel(overrides: {
  files?: { relativePath: string; language?: string }[];
  edges?: { source: string; target: string; type: string; strength: number; symbols: string[]; lines: number[]; bidirectional: boolean }[];
  hubs?: { file: string; inDegree: number; outDegree: number }[];
} = {}): AnalysisModel {
  return {
    files: (overrides.files ?? []).map((f) => ({
      relativePath: f.relativePath,
      absolutePath: f.relativePath,
      language: f.language ?? 'typescript',
      imports: [],
      exports: [],
      symbols: [],
      loc: 1,
      functions: [],
      classes: [],
    })),
    graph: {
      nodes: (overrides.files ?? []).map((f) => ({ id: f.relativePath })),
      edges: overrides.edges ?? [],
    },
    metrics: {
      hubs: overrides.hubs ?? [],
      orphans: [],
    },
  } as unknown as AnalysisModel;
}

// ── Hub extractor ────────────────────────────────────────────

describe('extractHubRules', () => {
  it('generates rule for directory with hub file (inDegree >= 3)', () => {
    const model = makeModel({
      files: [
        { relativePath: 'src/core/types.ts' },
        { relativePath: 'src/app.ts' },
        { relativePath: 'src/bar.ts' },
        { relativePath: 'src/baz.ts' },
      ],
      hubs: [{ file: 'src/core/types.ts', inDegree: 5, outDegree: 0 }],
      edges: [
        { source: 'src/app.ts', target: 'src/core/types.ts', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
        { source: 'src/bar.ts', target: 'src/core/types.ts', type: 'import', strength: 0.8, symbols: [], lines: [], bidirectional: false },
        { source: 'src/baz.ts', target: 'src/core/types.ts', type: 'import', strength: 0.6, symbols: [], lines: [], bidirectional: false },
      ],
    });

    const rules = extractHubRules(model);
    assert.equal(rules.length, 1);
    assert.ok(rules[0].slug.startsWith('hub-'));
    assert.ok(rules[0].globs[0].includes('src/core'));
    assert.ok(rules[0].content.includes('types.ts'));
    assert.ok(rules[0].content.includes('5 dependents'));
    assert.equal(rules[0].source, 'hub');
  });

  it('skips hubs with inDegree < 3', () => {
    const model = makeModel({
      hubs: [{ file: 'src/small.ts', inDegree: 2, outDegree: 0 }],
    });
    assert.deepEqual(extractHubRules(model), []);
  });

  it('merges hubs in same directory', () => {
    const model = makeModel({
      hubs: [
        { file: 'src/core/types.ts', inDegree: 5, outDegree: 0 },
        { file: 'src/core/utils.ts', inDegree: 4, outDegree: 1 },
      ],
      edges: [],
    });
    const rules = extractHubRules(model);
    assert.equal(rules.length, 1);
    assert.ok(rules[0].content.includes('types.ts'));
    assert.ok(rules[0].content.includes('utils.ts'));
  });

  it('returns empty for no hubs', () => {
    assert.deepEqual(extractHubRules(makeModel()), []);
  });
});

// ── Convention extractor ─────────────────────────────────────

describe('extractConventionRules', () => {
  it('generates rule when directory convention differs from repo', () => {
    const model = makeModel({
      files: [
        // Repo-wide: kebab-case (8+ files)
        { relativePath: 'src/lib/my-utils.ts' },
        { relativePath: 'src/lib/my-helpers.ts' },
        { relativePath: 'src/lib/data-loader.ts' },
        { relativePath: 'src/lib/config-parser.ts' },
        { relativePath: 'src/lib/error-handler.ts' },
        { relativePath: 'src/lib/route-builder.ts' },
        { relativePath: 'src/lib/type-checker.ts' },
        { relativePath: 'src/lib/cache-manager.ts' },
        // This directory: PascalCase (8+ files, different)
        { relativePath: 'src/components/UserCard.tsx' },
        { relativePath: 'src/components/NavBar.tsx' },
        { relativePath: 'src/components/SidePanel.tsx' },
        { relativePath: 'src/components/AppLayout.tsx' },
        { relativePath: 'src/components/DataTable.tsx' },
        { relativePath: 'src/components/SearchBar.tsx' },
        { relativePath: 'src/components/ModalView.tsx' },
        { relativePath: 'src/components/FormInput.tsx' },
      ],
    });

    const rules = extractConventionRules(model);
    assert.ok(rules.length >= 1);
    const compRule = rules.find((r) => r.globs[0].includes('src/components'));
    assert.ok(compRule, 'Should generate rule for PascalCase directory');
    assert.ok(compRule!.content.includes('PascalCase'));
    assert.equal(compRule!.source, 'convention');
  });

  it('skips directories with fewer than 2 files', () => {
    const model = makeModel({
      files: [
        { relativePath: 'src/a.ts' },
        { relativePath: 'src/b.ts' },
      ],
    });
    assert.deepEqual(extractConventionRules(model), []);
  });

  it('skips directories matching repo-wide convention', () => {
    const model = makeModel({
      files: [
        { relativePath: 'src/my-app.ts' },
        { relativePath: 'src/my-utils.ts' },
        { relativePath: 'src/my-config.ts' },
        { relativePath: 'src/my-router.ts' },
        { relativePath: 'src/my-handler.ts' },
        { relativePath: 'lib/other-file.ts' },
        { relativePath: 'lib/another-file.ts' },
        { relativePath: 'lib/third-file.ts' },
        { relativePath: 'lib/fourth-file.ts' },
        { relativePath: 'lib/fifth-file.ts' },
      ],
    });
    // Both dirs are kebab-case, same as repo dominant → no rules
    assert.deepEqual(extractConventionRules(model), []);
  });

  it('detects test co-location', () => {
    const model = makeModel({
      files: [
        // Repo dominant: kebab-case (8+)
        { relativePath: 'src/lib/my-utils.ts' },
        { relativePath: 'src/lib/my-helpers.ts' },
        { relativePath: 'src/lib/data-loader.ts' },
        { relativePath: 'src/lib/config-parser.ts' },
        { relativePath: 'src/lib/error-handler.ts' },
        { relativePath: 'src/lib/route-builder.ts' },
        { relativePath: 'src/lib/type-checker.ts' },
        { relativePath: 'src/lib/cache-manager.ts' },
        // PascalCase with co-located tests (8+)
        { relativePath: 'src/components/UserCard.tsx' },
        { relativePath: 'src/components/NavBar.tsx' },
        { relativePath: 'src/components/SidePanel.tsx' },
        { relativePath: 'src/components/AppLayout.tsx' },
        { relativePath: 'src/components/DataTable.tsx' },
        { relativePath: 'src/components/SearchBar.tsx' },
        { relativePath: 'src/components/ModalView.tsx' },
        { relativePath: 'src/components/UserCard.test.tsx' },
      ],
    });
    const rules = extractConventionRules(model);
    const compRule = rules.find((r) => r.globs[0].includes('src/components'));
    assert.ok(compRule);
    assert.ok(compRule!.content.includes('co-located'));
  });
});

// ── Circular dep extractor ───────────────────────────────────

describe('extractCircularDepRules', () => {
  it('generates rule for directory with circular edges', () => {
    const model = makeModel({
      edges: [
        { source: 'src/a.ts', target: 'src/b.ts', type: 'circular', strength: 1, symbols: [], lines: [], bidirectional: false },
      ],
    });
    const rules = extractCircularDepRules(model);
    assert.equal(rules.length, 1);
    assert.ok(rules[0].slug.startsWith('circular-'));
    assert.ok(rules[0].content.includes('src/a.ts'));
    assert.ok(rules[0].content.includes('src/b.ts'));
    assert.equal(rules[0].source, 'circular-dep');
  });

  it('returns empty when no circular edges', () => {
    const model = makeModel({
      edges: [
        { source: 'src/a.ts', target: 'src/b.ts', type: 'import', strength: 1, symbols: [], lines: [], bidirectional: false },
      ],
    });
    assert.deepEqual(extractCircularDepRules(model), []);
  });
});

// ── Combined extractor ───────────────────────────────────────

describe('extractScopedRules', () => {
  it('combines all extractors', () => {
    const model = makeModel({
      files: [
        { relativePath: 'src/core/types.ts' },
        { relativePath: 'src/a.ts' },
        { relativePath: 'src/b.ts' },
      ],
      hubs: [{ file: 'src/core/types.ts', inDegree: 5, outDegree: 0 }],
      edges: [],
    });
    const rules = extractScopedRules(model);
    assert.ok(rules.length >= 1);
  });

  it('returns empty for empty model', () => {
    assert.deepEqual(extractScopedRules(makeModel()), []);
  });
});

// ── Serializers ──────────────────────────────────────────────

describe('serializeForClaudeCode', () => {
  it('produces .md file with YAML frontmatter', () => {
    const rule = {
      slug: 'hub-src-core',
      description: 'High-impact hub files in src/core/',
      globs: ['src/core/**'],
      content: '## Hubs\n- types.ts\n',
      source: 'hub' as const,
    };
    const result = serializeForClaudeCode(rule);
    assert.equal(result.path, '.claude/rules/ac-hub-src-core.md');
    assert.ok(result.content.startsWith('---\n'));
    assert.ok(result.content.includes('description:'));
    assert.ok(result.content.includes('globs:'));
    assert.ok(result.content.includes('src/core/**'));
    assert.ok(result.content.includes('## Hubs'));
  });
});

describe('serializeForCursor', () => {
  it('produces .mdc file with alwaysApply: false', () => {
    const rule = {
      slug: 'conv-src-components',
      description: 'Naming conventions for src/components/',
      globs: ['src/components/**'],
      content: '## Conventions\n- PascalCase\n',
      source: 'convention' as const,
    };
    const result = serializeForCursor(rule);
    assert.equal(result.path, '.cursor/rules/ac-conv-src-components.mdc');
    assert.ok(result.content.includes('alwaysApply: false'));
    assert.ok(result.content.includes('globs:'));
  });
});

// ── Platform resolution ──────────────────────────────────────

describe('resolvePlatform', () => {
  let tmpDir: string;
  const host = createNodeEmitterHost();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-platforms-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('flag takes priority over everything', async () => {
    const result = await resolvePlatform(host, tmpDir, 'claude');
    assert.equal(result, 'claudeCode');
  });

  it('config takes priority over auto-detect', async () => {
    fs.mkdirSync(path.join(tmpDir, '.cursor'), { recursive: true });
    const result = await resolvePlatform(host, tmpDir, undefined, 'claude');
    assert.equal(result, 'claudeCode');
  });

  it('auto-detects claude from .claude/ directory', async () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    const result = await resolvePlatform(host, tmpDir);
    assert.equal(result, 'claudeCode');
  });

  it('auto-detects cursor from .cursor/ directory', async () => {
    fs.mkdirSync(path.join(tmpDir, '.cursor'), { recursive: true });
    const result = await resolvePlatform(host, tmpDir);
    assert.equal(result, 'cursor');
  });

  it('returns null when no platform detected', async () => {
    const result = await resolvePlatform(host, tmpDir);
    assert.equal(result, null);
  });

  it('returns null when both platforms detected (ambiguous)', async () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.cursor'), { recursive: true });
    const result = await resolvePlatform(host, tmpDir);
    assert.equal(result, null);
  });

  it('maps cursor flag string', async () => {
    const result = await resolvePlatform(host, tmpDir, 'cursor');
    assert.equal(result, 'cursor');
  });
});

// ── Writer + manifest ────────────────────────────────────────

describe('writeScopedRules', () => {
  let tmpDir: string;
  const host = createNodeEmitterHost();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-scoped-'));
    fs.mkdirSync(path.join(tmpDir, '.claude', 'rules'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes rule files for detected platforms', async () => {
    const rules = [{
      slug: 'hub-src',
      description: 'Hub in src/',
      globs: ['src/**'],
      content: '## Hub\n- types.ts\n',
      source: 'hub' as const,
    }];
    const written = await writeScopedRules(host, tmpDir, rules, 'claudeCode');
    assert.equal(written.length, 1);
    assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'rules', 'ac-hub-src.md')));
  });

  it('creates manifest file', async () => {
    const rules = [{
      slug: 'hub-src',
      description: 'Hub',
      globs: ['src/**'],
      content: '## Hub\n',
      source: 'hub' as const,
    }];
    await writeScopedRules(host, tmpDir, rules, 'claudeCode');
    const manifestPath = path.join(tmpDir, '.aspectcode', 'scoped-rules.json');
    assert.ok(fs.existsSync(manifestPath));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.equal(manifest.version, 1);
    assert.equal(manifest.rules.length, 1);
    assert.equal(manifest.rules[0].slug, 'hub-src');
  });

  it('cleans up stale files from previous manifest', async () => {
    // Write initial rule
    const rules1 = [{
      slug: 'hub-old',
      description: 'Old hub',
      globs: ['old/**'],
      content: '## Old\n',
      source: 'hub' as const,
    }];
    await writeScopedRules(host, tmpDir, rules1, 'claudeCode');
    assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'rules', 'ac-hub-old.md')));

    // Write new rule (old one should be cleaned up)
    const rules2 = [{
      slug: 'hub-new',
      description: 'New hub',
      globs: ['new/**'],
      content: '## New\n',
      source: 'hub' as const,
    }];
    await writeScopedRules(host, tmpDir, rules2, 'claudeCode');
    assert.ok(!fs.existsSync(path.join(tmpDir, '.claude', 'rules', 'ac-hub-old.md')));
    assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'rules', 'ac-hub-new.md')));
  });

  it('writes cursor rules when platform is cursor', async () => {
    const rules = [{
      slug: 'hub-src',
      description: 'Hub',
      globs: ['src/**'],
      content: '## Hub\n',
      source: 'hub' as const,
    }];
    const written = await writeScopedRules(host, tmpDir, rules, 'cursor');
    assert.equal(written.length, 1);
    assert.ok(fs.existsSync(path.join(tmpDir, '.cursor', 'rules', 'ac-hub-src.mdc')));
  });

  it('handles empty rules gracefully', async () => {
    const written = await writeScopedRules(host, tmpDir, [], 'claudeCode');
    assert.equal(written.length, 0);
  });
});

