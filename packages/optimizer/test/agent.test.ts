/**
 * Tests for the optimization agent loop.
 *
 * All LLM calls are mocked via a fake LlmProvider.
 */

import * as assert from 'node:assert/strict';
import type { LlmProvider, ChatMessage, OptimizeOptions } from '../src/types';
import { runOptimizeAgent } from '../src/agent';

/** Create a fake provider that returns canned responses in order. */
function fakeProvider(responses: string[]): LlmProvider {
  let callIndex = 0;
  return {
    name: 'fake',
    async chat(_messages: ChatMessage[]): Promise<string> {
      if (callIndex >= responses.length) {
        throw new Error(`Unexpected call #${callIndex + 1} (only ${responses.length} responses provided)`);
      }
      return responses[callIndex++];
    },
  };
}

/** Quiet logger that swallows all output. */
const quietLog = {
  info(_msg: string) { /* noop */ },
  warn(_msg: string) { /* noop */ },
  error(_msg: string) { /* noop */ },
  debug(_msg: string) { /* noop */ },
};

function makeOptions(overrides: Partial<OptimizeOptions> & { provider: LlmProvider }): OptimizeOptions {
  return {
    currentInstructions: '## Golden Rules\n1. Follow types.\n2. Run tests.',
    kb: '## Architecture\nEntry points: main.ts\n## Map\nModels: User',
    maxIterations: 3,
    log: quietLog,
    ...overrides,
  };
}

describe('runOptimizeAgent', () => {
  it('returns optimized instructions after a single iteration when score >= 8', async () => {
    const provider = fakeProvider([
      // Optimize response
      '## Golden Rules\n1. Always check types before committing.\n2. Run full test suite.',
      // Eval response
      'SCORE: 9\nFEEDBACK: Excellent specificity.\nSUGGESTIONS:\n- None needed',
    ]);

    const result = await runOptimizeAgent(makeOptions({ provider }));
    assert.equal(result.iterations, 1);
    assert.ok(result.optimizedInstructions.includes('check types'));
    assert.ok(result.reasoning.length >= 1);
    assert.ok(result.reasoning[0].includes('score=9'));
  });

  it('iterates when score is below threshold', async () => {
    const provider = fakeProvider([
      // Iteration 1: optimize
      'First attempt at instructions.',
      // Iteration 1: eval
      'SCORE: 5\nFEEDBACK: Too vague.\nSUGGESTIONS:\n- Be more specific',
      // Iteration 2: optimize (with feedback)
      '## Rules\n1. Use TypeScript strict mode.\n2. All files under 400 lines.',
      // Iteration 2: eval
      'SCORE: 8\nFEEDBACK: Good improvement.\nSUGGESTIONS:\n- Minor polish',
    ]);

    const result = await runOptimizeAgent(makeOptions({ provider, maxIterations: 3 }));
    assert.equal(result.iterations, 2);
    assert.ok(result.optimizedInstructions.includes('TypeScript strict'));
    assert.equal(result.reasoning.length, 2);
  });

  it('respects maxIterations and returns best candidate', async () => {
    const provider = fakeProvider([
      // Iteration 1
      'Attempt 1',
      'SCORE: 4\nFEEDBACK: Poor.\nSUGGESTIONS:\n- Improve',
      // Iteration 2
      'Attempt 2 - better',
      'SCORE: 6\nFEEDBACK: Better.\nSUGGESTIONS:\n- More',
    ]);

    const result = await runOptimizeAgent(makeOptions({ provider, maxIterations: 2 }));
    assert.equal(result.iterations, 2);
    // Should return best candidate (Attempt 2, score 6)
    assert.ok(result.optimizedInstructions.includes('Attempt 2'));
  });

  it('handles LLM error gracefully', async () => {
    const provider: LlmProvider = {
      name: 'failing',
      async chat(): Promise<string> {
        throw new Error('API rate limit exceeded');
      },
    };

    const result = await runOptimizeAgent(makeOptions({ provider, maxIterations: 2 }));
    // Should return original instructions as best candidate
    assert.ok(result.optimizedInstructions.includes('Golden Rules'));
    assert.ok(result.reasoning.some((r) => r.includes('LLM error')));
  });

  it('handles eval error gracefully and tracks candidate', async () => {
    let callCount = 0;
    const provider: LlmProvider = {
      name: 'partial-fail',
      async chat(): Promise<string> {
        callCount++;
        if (callCount === 1) return 'Optimized content here';
        throw new Error('Eval failed');
      },
    };

    const result = await runOptimizeAgent(makeOptions({ provider, maxIterations: 2 }));
    // Agent should track the candidate as best-effort but continue iterating
    assert.equal(result.iterations, 2);
    assert.ok(result.optimizedInstructions.includes('Optimized content'));
    assert.ok(result.reasoning.some((r) => r.includes('eval error')));
  });

  it('includes kbDiff in the optimization context', async () => {
    const messages: ChatMessage[][] = [];
    const provider: LlmProvider = {
      name: 'recording',
      async chat(msgs: ChatMessage[]): Promise<string> {
        messages.push(msgs);
        if (messages.length === 1) return 'optimized';
        return 'SCORE: 9\nFEEDBACK: Good.\nSUGGESTIONS:\n- None';
      },
    };

    await runOptimizeAgent(makeOptions({
      provider,
      kbDiff: '+ Added new entry point: api.ts',
      maxIterations: 1,
    }));

    // The optimize call should include the diff
    assert.ok(messages.length >= 1);
    const userMsg = messages[0].find((m) => m.role === 'user');
    assert.ok(userMsg);
    assert.ok(userMsg.content.includes('api.ts'));
  });

  it('maxIterations=1 runs exactly one iteration', async () => {
    const provider = fakeProvider([
      'Single pass result',
      'SCORE: 6\nFEEDBACK: Ok.\nSUGGESTIONS:\n- Improve',
    ]);

    const result = await runOptimizeAgent(makeOptions({ provider, maxIterations: 1 }));
    assert.equal(result.iterations, 1);
  });
});
