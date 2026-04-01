/**
 * Usage tracker — wraps an LLM provider to intercept all calls
 * and accumulate token usage + estimated cost.
 */

import type { LlmProvider, ChatMessage, ChatResult, ChatOptions, ChatUsage } from '@aspectcode/optimizer';
import { store } from './ui/store';

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
  function recordUsage(usage: ChatUsage | undefined, meta?: Record<string, unknown>): void {
    if (!usage) return;
    const prev = store.state.sessionUsage;
    store.setSessionUsage({
      inputTokens: prev.inputTokens + usage.inputTokens,
      outputTokens: prev.outputTokens + usage.outputTokens,
      calls: prev.calls + 1,
    });

    // Update tier progress (for free/pro, server is authoritative but this gives instant feedback)
    if (store.state.userTier !== 'byok') {
      // If server returned authoritative tier usage, use that
      if (meta?.tierUsage) {
        const tu = meta.tierUsage as { tokensUsed: number; tokensCap: number; tier: string };
        const tier = (tu.tier === 'PRO' ? 'pro' : 'free') as 'free' | 'pro';
        store.setTierInfo(tier, tu.tokensUsed, tu.tokensCap);
      } else {
        // Fall back to local estimation
        store.addTierTokens(usage.inputTokens + usage.outputTokens);
      }
    }
  }

  return {
    name: provider.name,

    async chat(messages: ChatMessage[]): Promise<string> {
      // Try chatWithUsage first to capture token counts
      if (provider.chatWithUsage) {
        const result = await provider.chatWithUsage(messages);
        recordUsage(result.usage, result.meta);
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
        recordUsage(result.usage, result.meta);
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
        recordUsage(result.usage, result.meta);
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
