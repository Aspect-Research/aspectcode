/**
 * Retry utility with exponential backoff for LLM API calls.
 *
 * Retries on transient errors (rate limits, server errors, network failures)
 * while immediately failing on permanent errors (auth, bad request).
 */

/** Default retry configuration. */
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 16_000;

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3). */
  maxRetries?: number;
  /** Base delay in ms before first retry (default: 1000). Doubles each retry. */
  baseDelayMs?: number;
  /** Maximum delay in ms between retries (default: 16000). */
  maxDelayMs?: number;
}

/**
 * Determine whether an error is transient and should be retried.
 *
 * Retries on:
 * - HTTP 429 (rate limit)
 * - HTTP 5xx (server errors)
 * - Network/timeout errors
 *
 * Does NOT retry:
 * - HTTP 401/403 (auth errors)
 * - HTTP 400 (bad request)
 * - Other client errors
 */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const msg = err.message.toLowerCase();

  // Network / timeout errors
  if (
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('timeout')
  ) {
    return true;
  }

  // Check for HTTP status codes in error
  const statusMatch = msg.match(/\b(4\d{2}|5\d{2})\b/);
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10);
    // Rate limit or server error → retry
    if (status === 429 || status >= 500) return true;
    // Other 4xx → permanent
    return false;
  }

  // OpenAI SDK may expose a `status` property
  const errWithStatus = err as Error & { status?: number };
  if (typeof errWithStatus.status === 'number') {
    const s = errWithStatus.status;
    if (s === 429 || s >= 500) return true;
    if (s >= 400) return false;
  }

  // Unknown error shape — don't retry by default
  return false;
}

/**
 * Execute `fn` with exponential backoff retries on transient errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelay = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelay = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let attempt = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;

      if (attempt > maxRetries || !isTransientError(err)) {
        throw err;
      }

      // Exponential backoff with jitter
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      const jitter = delay * (0.5 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, jitter));
    }
  }
}
