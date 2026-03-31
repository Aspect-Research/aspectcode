/**
 * LLM utility — helpers for calling providers with per-call options.
 */

import type { ChatMessage } from '@aspectcode/optimizer';
import type { LlmProvider } from './types';

/**
 * Call the LLM with a specific temperature.
 * Uses `chatWithOptions` if available, falls back to `chat()`.
 *
 * When an AbortSignal is provided and fires, the returned promise
 * rejects immediately (the underlying HTTP call may still finish
 * in the background, but the caller stops waiting).
 */
export async function chatWithTemp(
  provider: LlmProvider,
  messages: ChatMessage[],
  temperature: number,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const chatPromise = provider.chatWithOptions
    ? provider.chatWithOptions(messages, { temperature })
    : provider.chat(messages);

  if (!signal) return chatPromise;

  // Race the chat against the abort signal, cleaning up the listener afterward
  let cleanup: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const handler = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', handler, { once: true });
    cleanup = () => signal.removeEventListener('abort', handler);
  });

  try {
    return await Promise.race([chatPromise, abortPromise]);
  } finally {
    cleanup?.();
  }
}
