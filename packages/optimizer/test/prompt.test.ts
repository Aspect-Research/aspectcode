/**
 * Tests for prompt templates.
 */

import * as assert from 'node:assert/strict';
import {
  buildSystemPrompt,
  buildOptimizePrompt,
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
});

describe('buildSystemPrompt', () => {
  it('includes KB content in the system prompt', () => {
    const kb = '## Architecture\nHigh-risk files: app.ts';
    const prompt = buildSystemPrompt(kb);
    assert.ok(prompt.includes('High-risk files: app.ts'));
    assert.ok(prompt.includes('instruction optimizer'));
  });

  it('includes role description', () => {
    const prompt = buildSystemPrompt('minimal kb');
    assert.ok(prompt.includes('expert AI coding assistant'));
  });
});

describe('buildOptimizePrompt', () => {
  it('includes current instructions', () => {
    const prompt = buildOptimizePrompt('## Golden Rules\n1. Follow types.');
    assert.ok(prompt.includes('Golden Rules'));
    assert.ok(prompt.includes('Follow types'));
  });

  it('includes KB diff when provided', () => {
    const prompt = buildOptimizePrompt('instructions content', '+ new hub: auth.ts');
    assert.ok(prompt.includes('Recent KB Changes'));
    assert.ok(prompt.includes('new hub: auth.ts'));
  });

  it('omits diff section when not provided', () => {
    const prompt = buildOptimizePrompt('instructions content');
    assert.ok(!prompt.includes('Recent KB Changes'));
  });
});
