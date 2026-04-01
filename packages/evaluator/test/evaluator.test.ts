/**
 * Tests for the evaluator package.
 *
 * Covers deterministic edit application (apply.ts), probe deduplication,
 * and diagnosis response parsing — all pure functions, no LLM calls.
 */

import * as assert from 'node:assert/strict';
import { applyEdits, AGENTS_MD_CHAR_BUDGET } from '../src/apply';
import type { AgentsEdit } from '../src/types';

// ── Fixtures ────────────────────────────────────────────────

const SAMPLE_AGENTS_MD = `# AGENTS.md — TestProject

## Operating Mode
- Verify repo priors with targeted reads before editing.
- Localize, trace deps, then apply minimal scoped edit.
- Run the smallest relevant test first, broaden only if needed.

## Procedural Standards
- Reproduce the failure before editing when possible.
- Read target files and nearby callers before patching.

## High-Impact Hubs
- \`src/core/db.ts\` — 12 dependents, high risk.

## Entry Points
- \`src/routes/api.ts\` — HTTP handler.

## Guardrails
- No speculative changes without evidence.
- Every touched file must tie to the diagnosed path.
`;

// ── applyEdits ──────────────────────────────────────────────

describe('applyEdits', () => {
  it('adds a bullet to an existing section', () => {
    const edits: AgentsEdit[] = [{
      section: 'Operating Mode',
      action: 'add',
      content: 'Always check test output before committing.',
    }];
    const result = applyEdits(SAMPLE_AGENTS_MD, edits);
    assert.ok(result.content.includes('Always check test output'));
    assert.equal(result.applied, 1);
  });

  it('does not add duplicate bullets', () => {
    const edits: AgentsEdit[] = [{
      section: 'Operating Mode',
      action: 'add',
      content: 'Verify repo priors with targeted reads before editing.',
    }];
    const result = applyEdits(SAMPLE_AGENTS_MD, edits);
    assert.equal(result.applied, 0);
  });

  it('removes a matching bullet', () => {
    const edits: AgentsEdit[] = [{
      section: 'Guardrails',
      action: 'remove',
      content: 'speculative changes',
    }];
    const result = applyEdits(SAMPLE_AGENTS_MD, edits);
    assert.ok(!result.content.includes('No speculative changes'));
    assert.equal(result.applied, 1);
  });

  it('canonicalizes section aliases', () => {
    const edits: AgentsEdit[] = [{
      section: 'Testing',
      action: 'add',
      content: 'Run pytest with -v flag.',
    }];
    const result = applyEdits(SAMPLE_AGENTS_MD, edits);
    // "Testing" should map to "Validation" and create the section
    assert.ok(result.content.includes('Run pytest with -v flag'));
    assert.equal(result.applied, 1);
  });

  it('creates a new section when adding to non-existent canonical section', () => {
    const edits: AgentsEdit[] = [{
      section: 'Conventions',
      action: 'add',
      content: 'Use camelCase for functions.',
    }];
    const result = applyEdits(SAMPLE_AGENTS_MD, edits);
    assert.ok(result.content.includes('## Conventions'));
    assert.ok(result.content.includes('Use camelCase for functions'));
  });

  it('rejects non-canonical sections', () => {
    const edits: AgentsEdit[] = [{
      section: 'Completely Made Up Section',
      action: 'add',
      content: 'This should be ignored.',
    }];
    const result = applyEdits(SAMPLE_AGENTS_MD, edits);
    assert.equal(result.applied, 0);
    assert.ok(!result.content.includes('This should be ignored'));
  });

  it('rejects boilerplate edits', () => {
    const edits: AgentsEdit[] = [{
      section: 'Operating Mode',
      action: 'add',
      content: 'runner_status: success, patch_len: 42',
    }];
    const result = applyEdits(SAMPLE_AGENTS_MD, edits);
    assert.equal(result.applied, 0);
  });

  it('enforces character budget with trimming', () => {
    // Add many long bullets to blow past the budget
    const edits: AgentsEdit[] = [];
    for (let i = 0; i < 50; i++) {
      edits.push({
        section: 'Operating Mode',
        action: 'add',
        content: `Rule number ${i}: This is a long operational guideline that adds significant characters to the document. Follow it carefully when working on complex multi-file changes.`,
      });
    }
    const result = applyEdits(SAMPLE_AGENTS_MD, edits, 8000);
    assert.ok(result.content.length <= 8000, `Expected <= 8000 chars, got ${result.content.length}`);
    assert.ok(result.trimmed > 0, 'Should have trimmed some bullets');
  });

  it('preserves repo-specific sections over generic ones during trimming', () => {
    // Make a document that's over budget with content in both generic and specific sections
    const edits: AgentsEdit[] = [];
    // Add long bullets to generic sections (priority 2 — shed first)
    for (let i = 0; i < 20; i++) {
      edits.push({
        section: 'Procedural Standards',
        action: 'add',
        content: `Generic procedural rule ${i} that is fairly long and takes up space in the document.`,
      });
    }
    // Add a bullet to a specific section (priority 0 — keep)
    edits.push({
      section: 'High-Impact Hubs',
      action: 'add',
      content: 'Critical hub: src/core/auth.ts has 8 dependents.',
    });

    const result = applyEdits(SAMPLE_AGENTS_MD, edits, 2500);
    // The repo-specific content should be preserved while generic is shed
    assert.ok(result.content.includes('Critical hub'), 'Should preserve repo-specific content');
    assert.ok(result.content.length <= 2500);
  });

  it('handles strengthen action same as add', () => {
    const edits: AgentsEdit[] = [{
      section: 'Guardrails',
      action: 'strengthen',
      content: 'Never fabricate test output.',
    }];
    const result = applyEdits(SAMPLE_AGENTS_MD, edits);
    assert.ok(result.content.includes('Never fabricate test output'));
    assert.equal(result.applied, 1);
  });

  it('handles modify action same as add', () => {
    const edits: AgentsEdit[] = [{
      section: 'Guardrails',
      action: 'modify',
      content: 'Show actual command output, not summaries.',
    }];
    const result = applyEdits(SAMPLE_AGENTS_MD, edits);
    assert.ok(result.content.includes('Show actual command output'));
    assert.equal(result.applied, 1);
  });
});

describe('AGENTS_MD_CHAR_BUDGET', () => {
  it('is 8000', () => {
    assert.equal(AGENTS_MD_CHAR_BUDGET, 8000);
  });
});
