/**
 * @aspectcode/optimizer — public API.
 *
 * Re-exports types and provides the top-level `optimizeInstructions` entry point.
 */

export type {
  LlmProvider,
  ChatMessage,
  ChatUsage,
  ChatResult,
  ProviderOptions,
  OptimizeOptions,
  OptimizeResult,
  OptimizeStep,
  OptLogger,
  ProviderName,
  ComplaintOptions,
  ComplaintResult,
} from './types';
export { PROVIDER_ENV_KEYS, LLM_PROVIDER_ENV, LLM_MODEL_ENV } from './types';

export { resolveProvider, loadEnvFile, parseDotenv } from './providers/index';
export { createOpenAiProvider } from './providers/openai';
export { createAnthropicProvider } from './providers/anthropic';
export { withRetry } from './providers/retry';
export type { RetryOptions } from './providers/retry';
export { runGenerateAgent, runComplaintAgent } from './agent';
export {
  buildSystemPrompt,
  buildGeneratePrompt,
  truncateKb,
  buildComplaintPrompt,
  parseComplaintResponse,
} from './prompts';
