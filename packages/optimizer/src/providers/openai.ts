/**
 * OpenAI provider — implements LlmProvider using the OpenAI SDK.
 *
 * Features:
 * - Cached client instance (created once per provider, not per call)
 * - Configurable model, temperature, and max_tokens via ProviderOptions
 * - Retry with exponential backoff on transient errors
 * - Truncation detection (warns when finish_reason is 'length')
 */

import type { ChatMessage, ChatResult, LlmProvider, ProviderOptions } from '../types';
import { withRetry } from './retry';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Create an OpenAI-backed LlmProvider.
 *
 * Uses dynamic import so the `openai` package is only loaded
 * when this provider is actually used. The client is created once
 * and reused across all calls.
 */
export function createOpenAiProvider(apiKey: string, options?: ProviderOptions): LlmProvider {
  const modelId = options?.model ?? DEFAULT_MODEL;
  const temperature = options?.temperature ?? DEFAULT_TEMPERATURE;
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;

  // Lazily-initialized, cached client
  let clientPromise: Promise<InstanceType<typeof import('openai').default>> | undefined;

  async function getClient() {
    if (!clientPromise) {
      clientPromise = import('openai').then(({ default: OpenAI }) => new OpenAI({ apiKey }));
    }
    return clientPromise;
  }

  return {
    name: 'openai',

    async chat(messages: ChatMessage[]): Promise<string> {
      const result = await this.chatWithUsage!(messages);
      return result.content;
    },

    async chatWithUsage(messages: ChatMessage[]): Promise<ChatResult> {
      return withRetry(async () => {
        const client = await getClient();

        const response = await client.chat.completions.create({
          model: modelId,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          temperature,
          max_tokens: maxTokens,
        });

        const choice = response.choices[0];
        const content = choice?.message?.content;
        if (!content) {
          throw new Error('OpenAI returned an empty response');
        }

        // Warn on truncated output
        if (choice.finish_reason === 'length') {
          console.warn(
            `[optimizer] OpenAI response truncated (finish_reason=length). ` +
            `Consider increasing maxTokens (currently ${maxTokens}).`,
          );
        }

        return {
          content,
          usage: response.usage
            ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens }
            : undefined,
        };
      });
    },
  };
}
