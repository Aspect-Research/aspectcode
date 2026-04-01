/**
 * Shared test helpers for @aspectcode/optimizer tests.
 */

import type { LlmProvider } from '../src/types';
import type { ChatMessage } from '../src/types';

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
export const quietLog = {
  info(_msg: string) { /* noop */ },
  warn(_msg: string) { /* noop */ },
  error(_msg: string) { /* noop */ },
  debug(_msg: string) { /* noop */ },
};
