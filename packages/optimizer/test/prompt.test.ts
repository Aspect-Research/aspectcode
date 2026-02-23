/**
 * Tests for prompt templates and eval response parsing.
 */

import * as assert from 'node:assert/strict';
import {
  buildSystemPrompt,
  buildOptimizePrompt,
  buildEvalPrompt,
  parseEvalResponse,
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

  it('includes prior feedback when provided', () => {
    const prompt = buildOptimizePrompt('instructions', undefined, 'Score: 5\nBe more specific.');
    assert.ok(prompt.includes('Prior Evaluation Feedback'));
    assert.ok(prompt.includes('Be more specific'));
  });
});

describe('buildEvalPrompt', () => {
  it('includes candidate instructions and KB', () => {
    const prompt = buildEvalPrompt('candidate text', 'kb content');
    assert.ok(prompt.includes('candidate text'));
    assert.ok(prompt.includes('kb content'));
    assert.ok(prompt.includes('SCORE'));
  });
});

describe('parseEvalResponse', () => {
  it('parses a well-formatted response', () => {
    const response = `SCORE: 8
FEEDBACK: The instructions are specific and actionable, with good coverage.
SUGGESTIONS:
- Add guidance about error handling patterns
- Mention the test conventions used in the project
- Reference the layered architecture explicitly`;

    const result = parseEvalResponse(response);
    assert.equal(result.score, 8);
    assert.ok(result.feedback.includes('specific and actionable'));
    assert.equal(result.suggestions.length, 3);
    assert.ok(result.suggestions[0].includes('error handling'));
  });

  it('handles missing score gracefully (defaults to 5)', () => {
    const result = parseEvalResponse('Some random text');
    assert.equal(result.score, 5);
  });

  it('clamps score to 1-10 range', () => {
    const result = parseEvalResponse('SCORE: 15\nFEEDBACK: Great\nSUGGESTIONS:\n- ok');
    assert.equal(result.score, 10);
  });

  it('handles missing feedback gracefully', () => {
    const result = parseEvalResponse('SCORE: 7\nSUGGESTIONS:\n- first');
    assert.equal(result.score, 7);
    assert.ok(result.feedback.length > 0);
    assert.equal(result.suggestions.length, 1);
  });

  it('handles empty suggestions', () => {
    const result = parseEvalResponse('SCORE: 6\nFEEDBACK: Decent attempt.\nSUGGESTIONS:');
    assert.equal(result.score, 6);
    assert.equal(result.suggestions.length, 0);
  });
});
