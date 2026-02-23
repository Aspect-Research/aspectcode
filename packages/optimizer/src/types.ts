/**
 * @aspectcode/optimizer — core types.
 *
 * Provider-agnostic interfaces for LLM integration, agent loop
 * configuration, and optimization results.
 */

// ── LLM provider abstraction ────────────────────────────────

/** A single message in a chat conversation. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Provider-agnostic LLM interface.
 *
 * Implementations call a specific API (OpenAI, Anthropic, etc.)
 * and return the assistant's text response.
 */
export interface LlmProvider {
  /** Human-readable provider name (e.g. "openai", "anthropic"). */
  readonly name: string;

  /** Send a chat completion request and return the assistant reply. */
  chat(messages: ChatMessage[]): Promise<string>;
}

// ── Optimization options & results ──────────────────────────

/** Logger interface matching the CLI logger shape. */
export interface OptLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

/** Options for a single optimization run. */
export interface OptimizeOptions {
  /** Current AGENTS.md content (the marked section only). */
  currentInstructions: string;

  /** Full kb.md content. */
  kb: string;

  /** Line-level diff of KB changes (undefined on first run). */
  kbDiff?: string;

  /** Maximum agent iterations (optimize → eval → refine). */
  maxIterations: number;

  /** LLM provider to use. */
  provider: LlmProvider;

  /** Optional logger for progress reporting. */
  log?: OptLogger;
}

/** Self-evaluation result from one iteration. */
export interface EvalResult {
  /** Quality score 1–10. */
  score: number;

  /** Free-text feedback on the candidate. */
  feedback: string;

  /** Concrete improvement suggestions. */
  suggestions: string[];
}

/** Final result of the optimization agent. */
export interface OptimizeResult {
  /** The optimized instructions content (to be placed between markers). */
  optimizedInstructions: string;

  /** Number of iterations actually executed. */
  iterations: number;

  /** Per-iteration reasoning / eval feedback. */
  reasoning: string[];
}

// ── Environment / config ────────────────────────────────────

/** Supported provider keys looked up in the environment. */
export const PROVIDER_ENV_KEYS = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
} as const;

export type ProviderName = keyof typeof PROVIDER_ENV_KEYS;

/** Optional env-var to force a specific provider. */
export const LLM_PROVIDER_ENV = 'LLM_PROVIDER';

/** Optional env-var to override the default model. */
export const LLM_MODEL_ENV = 'LLM_MODEL';
