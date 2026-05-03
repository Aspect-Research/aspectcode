/**
 * Aspect Code hosted LLM provider.
 *
 * Routes LLM calls through aspectcode.com/api/cli/llm instead of
 * directly to OpenAI/Anthropic. Authenticates via CLI token.
 */

import type { LlmProvider, ChatMessage, ChatResult, ChatOptions, ProviderOptions } from '../types';
import { withRetry } from './retry';

const DEFAULT_URL = 'https://aspectcode.com/api/cli/llm';

export function createAspectCodeProvider(
  cliToken: string,
  options: ProviderOptions = {},
): LlmProvider {
  const baseUrl = process.env.ASPECTCODE_WEB_URL
    ? `${process.env.ASPECTCODE_WEB_URL}/api/cli/llm`
    : DEFAULT_URL;

  const defaultTemp = options.temperature ?? 0.4;
  const defaultMaxTokens = options.maxTokens ?? 4096;
  const model = options.model ?? 'auto';

  async function call(
    messages: ChatMessage[],
    temperature?: number,
    maxTokens?: number,
  ): Promise<ChatResult> {
    const res = await withRetry(async () => {
      const resp = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cliToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages,
          temperature: temperature ?? defaultTemp,
          maxTokens: maxTokens ?? defaultMaxTokens,
          model,
        }),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');

        // Handle tier exhaustion (403)
        if (resp.status === 403) {
          try {
            const parsed = JSON.parse(body);
            if (parsed.error === 'token_limit_exceeded') {
              const err = new Error(parsed.message || 'TOKEN_LIMIT_EXCEEDED') as any;
              err.tierExhausted = true;
              err.tokensUsed = parsed.tokensUsed;
              err.tokensCap = parsed.tokensCap;
              throw err;
            }
          } catch (e) {
            if ((e as any).tierExhausted) throw e;
          }
        }

        const err = new Error(`Aspect Code API error ${resp.status}: ${body}`);
        (err as any).status = resp.status;
        throw err;
      }

      return resp.json() as Promise<{
        content: string;
        usage?: { inputTokens: number; outputTokens: number };
        tierUsage?: { tokensUsed: number; tokensCap: number; tier: string };
      }>;
    });

    return {
      content: res.content,
      usage: res.usage,
      meta: res.tierUsage ? { tierUsage: res.tierUsage } : undefined,
    };
  }

  return {
    name: `aspectcode (hosted)`,

    async chat(messages: ChatMessage[]): Promise<string> {
      const result = await call(messages);
      return result.content;
    },

    async chatWithUsage(messages: ChatMessage[]): Promise<ChatResult> {
      return call(messages);
    },

    async chatWithOptions(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
      const result = await call(messages, opts.temperature, opts.maxTokens);
      return result.content;
    },
  };
}
