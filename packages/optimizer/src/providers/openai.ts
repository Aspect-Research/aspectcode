/**
 * OpenAI provider — implements LlmProvider using the OpenAI SDK.
 */

import type { ChatMessage, LlmProvider } from '../types';

const DEFAULT_MODEL = 'gpt-4o';

/**
 * Create an OpenAI-backed LlmProvider.
 *
 * Uses dynamic import so the `openai` package is only loaded
 * when this provider is actually used.
 */
export function createOpenAiProvider(apiKey: string, model?: string): LlmProvider {
  const modelId = model ?? DEFAULT_MODEL;

  return {
    name: 'openai',

    async chat(messages: ChatMessage[]): Promise<string> {
      // Dynamic import avoids requiring `openai` at module load time,
      // keeping the package light for users who don't call optimize.
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey });

      const response = await client.chat.completions.create({
        model: modelId,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: 0.4,
        max_tokens: 4096,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI returned an empty response');
      }
      return content;
    },
  };
}
