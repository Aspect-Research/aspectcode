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

/** Options passed to provider factory functions. */
export interface ProviderOptions {
  /** Model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514"). */
  model?: string;
  /** Sampling temperature (0–2). */
  temperature?: number;
  /** Max tokens for the response. */
  maxTokens?: number;
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
  /** Current AGENTS.md content. */
  currentInstructions: string;

  /** Full KB content (architecture + map + context). */
  kb: string;

  /** Line-level diff of KB changes (undefined on first run). */
  kbDiff?: string;

  /** Concatenated content from other AI tool instruction files (read-only context). */
  toolInstructions?: string;

  /** LLM provider to use. */
  provider: LlmProvider;

  /** Optional logger for progress reporting. */
  log?: OptLogger;

  /** AbortSignal for cooperative cancellation. */
  signal?: AbortSignal;

  /** Character budget for KB content in prompts. Default: 60000. */
  kbCharBudget?: number;

  /**
   * Progress callback invoked at each meaningful step inside the agent.
   * Useful for updating a CLI dashboard or progress bar.
   */
  onProgress?: (step: OptimizeStep) => void;
}

/** Progress step emitted by the optimization agent via `onProgress`. */
export interface OptimizeStep {
  /** Which sub-step is running. */
  kind: 'generating' | 'done';
  /** Optional human-readable detail. */
  detail?: string;
}

/** Final result of the optimization agent. */
export interface OptimizeResult {
  /** The optimized instructions content (to be placed between markers). */
  optimizedInstructions: string;

  /** Human-readable reasoning / status messages. */
  reasoning: string[];
}

// ── Environment / config ────────────────────────────────────

/** Supported provider keys looked up in the environment. */
export const PROVIDER_ENV_KEYS = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
} as const;

export type ProviderName = keyof typeof PROVIDER_ENV_KEYS;

// ── Complaint-driven optimization ───────────────────────────

/** Options for processing a user complaint against the current AGENTS.md. */
export interface ComplaintOptions {
  /** Current AGENTS.md content. */
  currentInstructions: string;

  /** Full KB content (architecture + map + context). */
  kb: string;

  /** One or more user-supplied complaints about AI behaviour. */
  complaints: string[];

  /** LLM provider to use. */
  provider: LlmProvider;

  /** Optional logger. */
  log?: OptLogger;

  /** Character budget for KB in prompts. Default: 60000. */
  kbCharBudget?: number;

  /** AbortSignal for cooperative cancellation. */
  signal?: AbortSignal;
}

/** Result of complaint-driven optimization. */
export interface ComplaintResult {
  /** Updated AGENTS.md content. */
  optimizedInstructions: string;

  /** Human-readable list of changes applied (one per complaint). */
  changes: string[];
}

/** Optional env-var to force a specific provider. */
export const LLM_PROVIDER_ENV = 'LLM_PROVIDER';

/** Optional env-var to override the default model. */
export const LLM_MODEL_ENV = 'LLM_MODEL';
