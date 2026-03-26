/**
 * Tests for prompt templates.
 */

import * as assert from 'node:assert/strict';
import {
  buildSystemPrompt,
  buildGeneratePrompt,
  truncateKb,
} from '../src/prompts';

describe('truncateKb', () => {
  it('returns short KB content unchanged', () => {
    const kb = '# Architecture\nSmall KB content.';
    assert.equal(truncateKb(kb), kb);
  });

  it('truncates KB content exceeding the budget', () => {
    const kb = 'x'.repeat(100_000);
    const result = truncateKb(kb);
    assert.ok(result.length < kb.length);
    assert.ok(result.includes('[... KB truncated'));
  });

  it('result length does not exceed budget', () => {
    const kb = 'x'.repeat(100_000);
    const result = truncateKb(kb);
    // The budget is internal, but the result should be much shorter than input
    assert.ok(result.length < 80_000);
  });
});

describe('buildSystemPrompt', () => {
  it('includes KB content in the system prompt', () => {
    const kb = '## Architecture\nHigh-risk files: app.ts';
    const prompt = buildSystemPrompt(kb);
    assert.ok(prompt.includes('High-risk files: app.ts'));
    assert.ok(prompt.includes('instruction author'));
  });

  it('includes role description', () => {
    const prompt = buildSystemPrompt('minimal kb');
    assert.ok(prompt.includes('expert AI coding assistant'));
    assert.ok(prompt.includes('instruction author'));
  });
});

describe('buildGeneratePrompt', () => {
  it('asks LLM to generate from scratch', () => {
    const prompt = buildGeneratePrompt();
    assert.ok(prompt.includes('Generate AGENTS.md'));
    assert.ok(prompt.includes('from scratch'));
  });

  it('includes KB diff when provided', () => {
    const prompt = buildGeneratePrompt('+ new hub: auth.ts');
    assert.ok(prompt.includes('Recent KB Changes'));
    assert.ok(prompt.includes('new hub: auth.ts'));
  });

  it('omits diff section when not provided', () => {
    const prompt = buildGeneratePrompt();
    assert.ok(!prompt.includes('Recent KB Changes'));
  });
});
