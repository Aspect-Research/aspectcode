/**
 * Shared test helpers for @aspectcode/evaluator tests.
 */

import type { LlmProvider, OptLogger, Probe } from '../src/types';
import type { ChatMessage } from '@aspectcode/optimizer';

/** Create a fake provider that returns canned responses in order. */
export function fakeProvider(responses: string[]): LlmProvider {
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

/** No-op logger that swallows all output. */
export const quietLog: OptLogger = {
  info(_msg: string) { /* noop */ },
  warn(_msg: string) { /* noop */ },
  error(_msg: string) { /* noop */ },
  debug(_msg: string) { /* noop */ },
};

/** Create a valid Probe with sensible defaults. */
export function makeFakeProbe(overrides?: Partial<Probe>): Probe {
  return {
    id: 'test-probe-1',
    task: 'Fix the broken test in utils.ts',
    expectedBehaviors: ['Localizes the failing test', 'Applies minimal fix'],
    rationale: 'Tests basic probe response',
    ...overrides,
  };
}
