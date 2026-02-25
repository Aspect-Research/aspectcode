/**
 * Tests for complaint prompt/response and the complaint agent.
 */

import * as assert from 'node:assert/strict';
import type { LlmProvider, ChatMessage } from '../src/types';
import { runComplaintAgent } from '../src/agent';
import { buildComplaintPrompt, parseComplaintResponse } from '../src/prompts';

/** Create a fake provider that returns canned responses in order. */
function fakeProvider(responses: string[]): LlmProvider {
  let callIndex = 0;
  return {
    name: 'fake',
    async chat(_messages: ChatMessage[]): Promise<string> {
      if (callIndex >= responses.length) {
        throw new Error(`Unexpected call #${callIndex + 1}`);
      }
      return responses[callIndex++];
    },
  };
}

const quietLog = {
  info(_msg: string) { /* noop */ },
  warn(_msg: string) { /* noop */ },
  error(_msg: string) { /* noop */ },
  debug(_msg: string) { /* noop */ },
};

describe('buildComplaintPrompt', () => {
  it('includes all complaints numbered', () => {
    const prompt = buildComplaintPrompt('## Rules\n1. Be safe.', [
      'AI forgot to run tests',
      'AI deleted my helper function',
    ]);
    assert.ok(prompt.includes('1. AI forgot to run tests'));
    assert.ok(prompt.includes('2. AI deleted my helper function'));
  });

  it('includes current instructions', () => {
    const prompt = buildComplaintPrompt('## My Rules\nAlways lint.', ['some complaint']);
    assert.ok(prompt.includes('My Rules'));
    assert.ok(prompt.includes('Always lint'));
  });

  it('enforces self-contained output rule', () => {
    const prompt = buildComplaintPrompt('instructions', ['complaint']);
    assert.ok(prompt.includes('self-contained'));
    assert.ok(prompt.includes('knowledge base') || prompt.includes('KB'));
  });

  it('requests full updated instructions (not diff)', () => {
    const prompt = buildComplaintPrompt('instructions', ['complaint']);
    assert.ok(prompt.includes('FULL updated instructions'));
  });
});

describe('parseComplaintResponse', () => {
  it('parses a well-formatted response', () => {
    const response = `CHANGES:
- Added rule about running tests before committing
- Strengthened helper function protection rule

INSTRUCTIONS:
## Rules
1. Always run tests before committing.
2. Never delete helper functions without checking callers.`;

    const result = parseComplaintResponse(response);
    assert.equal(result.changes.length, 2);
    assert.ok(result.changes[0].includes('running tests'));
    assert.ok(result.instructions.includes('Never delete helper'));
  });

  it('handles response with no CHANGES section', () => {
    const response = `INSTRUCTIONS:
## Rules
1. Updated rule.`;

    const result = parseComplaintResponse(response);
    assert.equal(result.changes.length, 0);
    assert.ok(result.instructions.includes('Updated rule'));
  });

  it('falls back to full response when no INSTRUCTIONS marker', () => {
    const response = `## Rules
1. Some updated instructions without markers.`;

    const result = parseComplaintResponse(response);
    assert.ok(result.instructions.includes('Some updated instructions'));
  });

  it('handles empty changes list', () => {
    const response = `CHANGES:

INSTRUCTIONS:
Unchanged instructions.`;

    const result = parseComplaintResponse(response);
    assert.equal(result.changes.length, 0);
    assert.ok(result.instructions.includes('Unchanged'));
  });
});

describe('runComplaintAgent', () => {
  it('processes complaints and returns updated instructions', async () => {
    const provider = fakeProvider([
      `CHANGES:
- Added test-first rule

INSTRUCTIONS:
## Rules
1. Always run tests first.
2. Keep functions small.`,
    ]);

    const result = await runComplaintAgent({
      currentInstructions: '## Rules\n1. Keep functions small.',
      kb: '## Architecture\nSmall project',
      complaints: ['AI never runs tests'],
      provider,
      log: quietLog,
    });

    assert.ok(result.optimizedInstructions.includes('Always run tests'));
    assert.equal(result.changes.length, 1);
    assert.ok(result.changes[0].includes('test-first'));
  });

  it('returns original instructions on LLM error', async () => {
    const provider: LlmProvider = {
      name: 'failing',
      async chat(): Promise<string> {
        throw new Error('Network error');
      },
    };

    const original = '## Rules\n1. Be safe.';
    const result = await runComplaintAgent({
      currentInstructions: original,
      kb: '## Architecture\nSmall project',
      complaints: ['something broke'],
      provider,
      log: quietLog,
    });

    assert.equal(result.optimizedInstructions, original);
    assert.ok(result.changes.some((c) => c.includes('Error')));
  });

  it('returns immediately when signal is already aborted', async () => {
    const provider = fakeProvider(['should never be called']);
    const controller = new AbortController();
    controller.abort();

    const result = await runComplaintAgent({
      currentInstructions: 'original',
      kb: 'kb',
      complaints: ['complaint'],
      provider,
      log: quietLog,
      signal: controller.signal,
    });

    assert.equal(result.optimizedInstructions, 'original');
    assert.equal(result.changes.length, 0);
  });
});
