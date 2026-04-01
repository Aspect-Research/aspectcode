/**
 * Tests for the single-pass generation agent.
 *
 * All LLM calls are mocked via a fake LlmProvider.
 */

import * as assert from 'node:assert/strict';
import type { LlmProvider, ChatMessage, OptimizeOptions } from '../src/types';
import { runGenerateAgent } from '../src/agent';
import { fakeProvider, quietLog } from './helpers';

function makeOptions(overrides: Partial<OptimizeOptions> & { provider: LlmProvider }): OptimizeOptions {
  return {
    currentInstructions: '## Golden Rules\n1. Follow types.\n2. Run tests.',
    kb: '## Architecture\nEntry points: main.ts\n## Map\nModels: User',
    log: quietLog,
    ...overrides,
  };
}

describe('runGenerateAgent', () => {
  it('returns generated instructions from a single LLM call', async () => {
    const provider = fakeProvider([
      '## Golden Rules\n1. Always check types before committing.\n2. Run full test suite.',
    ]);

    const result = await runGenerateAgent(makeOptions({ provider }));
    assert.ok(result.optimizedInstructions.includes('check types'));
    assert.ok(result.reasoning.length >= 1);
  });

  it('makes exactly one LLM call', async () => {
    let callCount = 0;
    const provider: LlmProvider = {
      name: 'counting',
      async chat(): Promise<string> {
        callCount++;
        return 'generated content';
      },
    };

    await runGenerateAgent(makeOptions({ provider }));
    assert.equal(callCount, 1);
  });

  it('handles LLM error gracefully', async () => {
    const provider: LlmProvider = {
      name: 'failing',
      async chat(): Promise<string> {
        throw new Error('API rate limit exceeded');
      },
    };

    const result = await runGenerateAgent(makeOptions({ provider }));
    // Should return fallback instructions
    assert.ok(result.optimizedInstructions.includes('Golden Rules'));
    assert.ok(result.reasoning.some((r) => r.includes('LLM error')));
  });

  it('includes kbDiff in the optimization context', async () => {
    const messages: ChatMessage[][] = [];
    const provider: LlmProvider = {
      name: 'recording',
      async chat(msgs: ChatMessage[]): Promise<string> {
        messages.push(msgs);
        return 'optimized';
      },
    };

    await runGenerateAgent(makeOptions({
      provider,
      kbDiff: '+ Added new entry point: api.ts',
    }));

    // The generate call should include the diff
    assert.equal(messages.length, 1);
    const userMsg = messages[0].find((m) => m.role === 'user');
    assert.ok(userMsg);
    assert.ok(userMsg.content.includes('api.ts'));
  });

  it('returns original instructions when cancelled via signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = fakeProvider(['should not be called']);

    const result = await runGenerateAgent(makeOptions({
      provider,
      signal: controller.signal,
    }));
    assert.ok(result.optimizedInstructions.includes('Golden Rules'));
    assert.ok(result.reasoning.some((r) => r.includes('Cancelled')));
  });

  it('invokes onProgress callback', async () => {
    const steps: string[] = [];
    const provider = fakeProvider(['optimized']);

    await runGenerateAgent(makeOptions({
      provider,
      onProgress: (step) => steps.push(step.kind),
    }));

    assert.ok(steps.includes('generating'));
    assert.ok(steps.includes('done'));
  });
});
