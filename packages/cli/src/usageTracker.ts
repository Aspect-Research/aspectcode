/**
 * Usage tracker — wraps an LLM provider to intercept all calls
 * and accumulate token usage + estimated cost.
 */

import type { LlmProvider, ChatMessage, ChatResult, ChatOptions, ChatUsage } from '@aspectcode/optimizer';
import { store } from './ui/store';

// Haiku 4.5 pricing (per 1M tokens)
const COST_PER_M_INPUT = 1.00;
const COST_PER_M_OUTPUT = 5.00;

export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * COST_PER_M_INPUT
       + (outputTokens / 1_000_000) * COST_PER_M_OUTPUT;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Wrap a provider to track all LLM calls. Usage is accumulated
 * in the dashboard store and displayed in the terminal.
 */
export function withUsageTracking(provider: LlmProvider): LlmProvider {
  function recordUsage(usage: ChatUsage | undefined): void {
    if (!usage) return;
    const prev = store.state.sessionUsage;
    store.setSessionUsage({
      inputTokens: prev.inputTokens + usage.inputTokens,
      outputTokens: prev.outputTokens + usage.outputTokens,
      calls: prev.calls + 1,
    });
  }

  return {
    name: provider.name,

    async chat(messages: ChatMessage[]): Promise<string> {
      // Try chatWithUsage first to capture token counts
      if (provider.chatWithUsage) {
        const result = await provider.chatWithUsage(messages);
        recordUsage(result.usage);
        return result.content;
      }
      const content = await provider.chat(messages);
      // Estimate tokens from message length when provider doesn't report usage
      const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
      recordUsage({ inputTokens: Math.round(inputChars / 4), outputTokens: Math.round(content.length / 4) });
      return content;
    },

    async chatWithUsage(messages: ChatMessage[]): Promise<ChatResult> {
      if (provider.chatWithUsage) {
        const result = await provider.chatWithUsage(messages);
        recordUsage(result.usage);
        return result;
      }
      const content = await provider.chat(messages);
      const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
      const estimated: ChatUsage = { inputTokens: Math.round(inputChars / 4), outputTokens: Math.round(content.length / 4) };
      recordUsage(estimated);
      return { content, usage: estimated };
    },

    async chatWithOptions(messages: ChatMessage[], options: ChatOptions): Promise<string> {
      // chatWithOptions typically doesn't return usage, but try chatWithUsage first
      if (provider.chatWithUsage) {
        const result = await provider.chatWithUsage(messages);
        recordUsage(result.usage);
        return result.content;
      }
      const content = provider.chatWithOptions
        ? await provider.chatWithOptions(messages, options)
        : await provider.chat(messages);
      // Estimate
      const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0);
      recordUsage({ inputTokens: Math.round(inputChars / 4), outputTokens: Math.round(content.length / 4) });
      return content;
    },
  };
}
