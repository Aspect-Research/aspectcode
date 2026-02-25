/**
 * Tests for the evaluator package.
 *
 * Covers probe generation, KB section parsing, behaviour evaluation parsing,
 * and diagnosis response parsing — all pure functions, no LLM calls.
 */

import * as assert from 'node:assert/strict';
import {
  generateProbes,
  extractSection,
  parseHubs,
  parseEntryPoints,
  parseConventions,
  parseDiffFiles,
} from '../src/probes';
import { buildDiagnosisPrompt, parseDiagnosisResponse } from '../src/diagnosis';
import type { ProbeResult, HarvestedPrompt } from '../src/types';

// ── Fixtures ────────────────────────────────────────────────

const SAMPLE_KB = `# Architecture

## High-Risk Architectural Hubs

| File | In | Out |
|------|-----|-----|
| \`src/core/db.ts\` | 12 | 3 |
| \`src/core/auth.ts\` | 8 | 5 |

## Entry Points

| File | Kind |
|------|------|
| \`src/routes/api.ts\` | HTTP handler |
| \`src/cli/main.ts\` | CLI command |

---

# Map

## Data Models

User, Session, Token

## Conventions

- Use camelCase for functions and variables
- Use PascalCase for classes and interfaces
- Suffix test files with .test.ts
- Prefix private methods with underscore

---

# Context

## Module Clusters

src/core/db.ts, src/core/auth.ts, src/core/session.ts
`;

const SAMPLE_DIFF = `--- a/src/core/db.ts
+++ b/src/core/db.ts
@@ -10,6 +10,7 @@
 import { Pool } from 'pg';
+import { Redis } from 'ioredis';
--- a/src/routes/api.ts
+++ b/src/routes/api.ts
@@ -5,3 +5,4 @@
 import { authenticate } from '../core/auth';
+import { rateLimit } from '../middleware/rateLimit';
`;

// ── KB section parsing ──────────────────────────────────────

describe('extractSection', () => {
  it('extracts a named section up to the next separator', () => {
    const arch = extractSection(SAMPLE_KB, '# Architecture');
    assert.ok(arch.includes('High-Risk Architectural Hubs'));
    assert.ok(arch.includes('Entry Points'));
    assert.ok(!arch.includes('Data Models'), 'should not leak into Map section');
  });

  it('returns empty string for missing section', () => {
    assert.equal(extractSection(SAMPLE_KB, '# NonExistent'), '');
  });
});

describe('parseHubs', () => {
  it('parses hub table rows', () => {
    const arch = extractSection(SAMPLE_KB, '# Architecture');
    const hubs = parseHubs(arch);
    assert.equal(hubs.length, 2);
    assert.equal(hubs[0].file, 'src/core/db.ts');
    assert.equal(hubs[0].inDegree, 12);
    assert.equal(hubs[0].outDegree, 3);
    assert.equal(hubs[1].file, 'src/core/auth.ts');
  });

  it('returns empty array when no hubs section exists', () => {
    assert.deepEqual(parseHubs('no hubs here'), []);
  });
});

describe('parseEntryPoints', () => {
  it('parses entry point table rows', () => {
    const arch = extractSection(SAMPLE_KB, '# Architecture');
    const entries = parseEntryPoints(arch);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].file, 'src/routes/api.ts');
    assert.equal(entries[0].kind, 'HTTP handler');
    assert.equal(entries[1].file, 'src/cli/main.ts');
    assert.equal(entries[1].kind, 'CLI command');
  });
});

describe('parseConventions', () => {
  it('parses bullet-list conventions', () => {
    const mapSection = extractSection(SAMPLE_KB, '# Map');
    const conventions = parseConventions(mapSection);
    assert.ok(conventions.length >= 3);
    assert.ok(conventions.some((c) => c.includes('camelCase')));
    assert.ok(conventions.some((c) => c.includes('PascalCase')));
  });
});

describe('parseDiffFiles', () => {
  it('extracts file paths from unified diff', () => {
    const files = parseDiffFiles(SAMPLE_DIFF);
    assert.ok(files.includes('src/core/db.ts'));
    assert.ok(files.includes('src/routes/api.ts'));
  });
});

// ── Probe generation ────────────────────────────────────────

describe('generateProbes', () => {
  it('generates hub safety probes from KB', () => {
    const probes = generateProbes({ kb: SAMPLE_KB });
    const hubProbes = probes.filter((p) => p.category === 'hub-safety');
    assert.ok(hubProbes.length >= 1, 'should generate hub probes');
    assert.ok(hubProbes[0].id.includes('src-core-db'));
    assert.ok(hubProbes[0].contextFiles.includes('src/core/db.ts'));
    assert.ok(hubProbes[0].expectedBehaviors.length > 0);
  });

  it('generates entry point probes from KB', () => {
    const probes = generateProbes({ kb: SAMPLE_KB });
    const entryProbes = probes.filter((p) => p.category === 'entry-point');
    assert.ok(entryProbes.length >= 1, 'should generate entry point probes');
  });

  it('generates naming convention probes from KB', () => {
    const probes = generateProbes({ kb: SAMPLE_KB });
    const namingProbes = probes.filter((p) => p.category === 'naming');
    assert.ok(namingProbes.length >= 1, 'should generate naming probes');
  });

  it('prioritises diff-scoped probes when diff is provided', () => {
    const probes = generateProbes({ kb: SAMPLE_KB, kbDiff: SAMPLE_DIFF });
    // Diff probes should be first
    assert.equal(probes[0].category, 'architecture');
    assert.ok(probes[0].id.includes('diff-area'));
  });

  it('includes harvested prompt probes', () => {
    const harvested: HarvestedPrompt[] = [{
      source: 'claude-code',
      userPrompt: 'How do I add a new route?',
      assistantResponse: 'Add it in src/routes/api.ts...',
      filesReferenced: ['src/routes/api.ts'],
    }];
    const probes = generateProbes({ kb: SAMPLE_KB, harvestedPrompts: harvested });
    const harvestedProbes = probes.filter((p) => p.category === 'harvested');
    assert.ok(harvestedProbes.length >= 1, 'should generate harvested probes');
    assert.ok(harvestedProbes[0].contextFiles.includes('src/routes/api.ts'));
  });

  it('respects maxProbes cap', () => {
    const probes = generateProbes({ kb: SAMPLE_KB, maxProbes: 3 });
    assert.ok(probes.length <= 3, `expected <= 3 probes, got ${probes.length}`);
  });

  it('deduplicates probes by id', () => {
    const probes = generateProbes({ kb: SAMPLE_KB });
    const ids = probes.map((p) => p.id);
    assert.equal(ids.length, new Set(ids).size, 'probe ids should be unique');
  });

  it('returns empty array when KB is empty', () => {
    const probes = generateProbes({ kb: '' });
    assert.equal(probes.length, 0);
  });
});

// ── Diagnosis parsing ───────────────────────────────────────

describe('parseDiagnosisResponse', () => {
  it('parses a well-formed diagnosis response', () => {
    const response = `SUMMARY: The AGENTS.md lacks hub-safety guidance for db.ts.

EDIT_1:
SECTION: Golden Rules
ACTION: add
CONTENT: Always check db.ts dependents before modifying exports
MOTIVATED_BY: hub-safety-src-core-db

EDIT_2:
SECTION: Architecture
ACTION: strengthen
CONTENT: Mark db.ts as a critical hub — changes require updating all 12 dependents
MOTIVATED_BY: hub-safety-src-core-db, entry-point-src-routes-api`;

    const result = parseDiagnosisResponse(response, 2);
    assert.equal(result.summary, 'The AGENTS.md lacks hub-safety guidance for db.ts.');
    assert.equal(result.edits.length, 2);
    assert.equal(result.edits[0].section, 'Golden Rules');
    assert.equal(result.edits[0].action, 'add');
    assert.ok(result.edits[0].content.includes('db.ts'));
    assert.deepEqual(result.edits[0].motivatedBy, ['hub-safety-src-core-db']);
    assert.equal(result.edits[1].action, 'strengthen');
    assert.equal(result.edits[1].motivatedBy.length, 2);
    assert.equal(result.failureCount, 2);
  });

  it('returns empty edits when response is unparseable', () => {
    const result = parseDiagnosisResponse('This is just free text with no structure.', 1);
    assert.equal(result.edits.length, 0);
    assert.equal(result.failureCount, 1);
  });
});

describe('buildDiagnosisPrompt', () => {
  it('includes failure details and AGENTS.md content', () => {
    const failures: ProbeResult[] = [{
      probeId: 'hub-safety-db',
      passed: false,
      response: 'Just modify the file directly.',
      shortcomings: ['Did not mention dependents', 'Did not warn about breaking changes'],
      behaviorResults: [],
    }];

    const prompt = buildDiagnosisPrompt(failures, '## Rules\n1. Be careful.');
    assert.ok(prompt.includes('hub-safety-db'));
    assert.ok(prompt.includes('Did not mention dependents'));
    assert.ok(prompt.includes('## Rules'));
    assert.ok(prompt.includes('EDIT_1:'));
  });
});

// ── Diagnose edge case ──────────────────────────────────────

describe('diagnose', () => {
  it('returns no edits when passed empty failures', async () => {
    // Import the actual function (no LLM call for empty failures)
    const { diagnose } = await import('../src/diagnosis');
    const result = await diagnose([], '## Rules', null as any);
    assert.equal(result.edits.length, 0);
    assert.equal(result.summary, 'All probes passed.');
  });
});
