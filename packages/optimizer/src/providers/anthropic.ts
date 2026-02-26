/**
 * Anthropic provider — implements LlmProvider using the Anthropic SDK.
 *
 * Features:
 * - Cached client instance (created once per provider, not per call)
 * - Configurable model, temperature, and max_tokens via ProviderOptions
 * - Retry with exponential backoff on transient errors
 * - Truncation detection (warns when stop_reason is 'max_tokens')
 * - Proper system prompt handling (Anthropic uses a separate `system` field)
 */

import type { ChatMessage, ChatResult, LlmProvider, ProviderOptions } from '../types';
import { withRetry } from './retry';

const DEFAULT_MODEL = 'claude-3-5-haiku-20241022';
const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Create an Anthropic-backed LlmProvider.
 *
 * Uses dynamic import so the `@anthropic-ai/sdk` package is only loaded
 * when this provider is actually used. The client is created once
 * and reused across all calls.
 */
export function createAnthropicProvider(apiKey: string, options?: ProviderOptions): LlmProvider {
  const modelId = options?.model ?? DEFAULT_MODEL;
  const temperature = options?.temperature ?? DEFAULT_TEMPERATURE;
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;

  // Lazily-initialized, cached client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let clientPromise: Promise<any> | undefined;

  async function getClient() {
    if (!clientPromise) {
      clientPromise = import('@anthropic-ai/sdk').then(
        ({ default: Anthropic }) => new Anthropic({ apiKey }),
      );
    }
    return clientPromise;
  }

  return {
    name: 'anthropic',

    async chat(messages: ChatMessage[]): Promise<string> {
      const result = await this.chatWithUsage!(messages);
      return result.content;
    },

    async chatWithUsage(messages: ChatMessage[]): Promise<ChatResult> {
      return withRetry(async () => {
        const client = await getClient();

        // Anthropic handles system prompts as a separate field,
        // not as a message with role 'system'.
        let systemPrompt: string | undefined;
        const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

        for (const msg of messages) {
          if (msg.role === 'system') {
            // Concatenate multiple system messages if present
            systemPrompt = systemPrompt
              ? `${systemPrompt}\n\n${msg.content}`
              : msg.content;
          } else {
            anthropicMessages.push({
              role: msg.role,
              content: msg.content,
            });
          }
        }

        // Anthropic requires at least one user message
        if (anthropicMessages.length === 0) {
          throw new Error('Anthropic requires at least one user message');
        }

        const requestParams: Record<string, unknown> = {
          model: modelId,
          messages: anthropicMessages,
          temperature,
          max_tokens: maxTokens,
        };
        if (systemPrompt) {
          requestParams.system = systemPrompt;
        }

        const response = await client.messages.create(requestParams);

        // Extract text from content blocks
        const textBlocks = response.content?.filter(
          (block: { type: string }) => block.type === 'text',
        );
        const content = textBlocks
          ?.map((block: { text: string }) => block.text)
          .join('');

        if (!content) {
          throw new Error('Anthropic returned an empty response');
        }

        // Warn on truncated output
        if (response.stop_reason === 'max_tokens') {
          console.warn(
            `[optimizer] Anthropic response truncated (stop_reason=max_tokens). ` +
            `Consider increasing maxTokens (currently ${maxTokens}).`,
          );
        }

        return {
          content,
          usage: response.usage
            ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
            : undefined,
        };
      });
    },
  };
}
