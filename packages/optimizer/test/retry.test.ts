/**
 * Tests for retry utility — isTransientError and withRetry.
 */

import * as assert from 'node:assert/strict';
import { isTransientError, withRetry } from '../src/providers/retry';

describe('isTransientError', () => {
  it('true for 429 rate limit in message', () => {
    assert.ok(isTransientError(new Error('HTTP 429 rate limit exceeded')));
  });

  it('true for 500 in message', () => {
    assert.ok(isTransientError(new Error('Server returned 500')));
  });

  it('true for 502 in message', () => {
    assert.ok(isTransientError(new Error('Bad gateway 502')));
  });

  it('true for 503 in message', () => {
    assert.ok(isTransientError(new Error('Service unavailable 503')));
  });

  it('true for 504 in message', () => {
    assert.ok(isTransientError(new Error('Gateway timeout 504')));
  });

  it('false for 401 auth error in message', () => {
    assert.ok(!isTransientError(new Error('HTTP 401 unauthorized')));
  });

  it('false for 403 forbidden in message', () => {
    assert.ok(!isTransientError(new Error('HTTP 403 forbidden')));
  });

  it('false for 400 bad request in message', () => {
    assert.ok(!isTransientError(new Error('HTTP 400 bad request')));
  });

  it('true for ECONNRESET', () => {
    assert.ok(isTransientError(new Error('read ECONNRESET')));
  });

  it('true for ECONNREFUSED', () => {
    assert.ok(isTransientError(new Error('connect ECONNREFUSED 127.0.0.1:443')));
  });

  it('true for ETIMEDOUT', () => {
    assert.ok(isTransientError(new Error('connect ETIMEDOUT')));
  });

  it('true for socket hang up', () => {
    assert.ok(isTransientError(new Error('socket hang up')));
  });

  it('true for error with .status = 429', () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 });
    assert.ok(isTransientError(err));
  });

  it('false for error with .status = 401', () => {
    const err = Object.assign(new Error('unauthorized'), { status: 401 });
    assert.ok(!isTransientError(err));
  });

  it('false for non-Error objects', () => {
    assert.ok(!isTransientError('just a string'));
    assert.ok(!isTransientError(42));
    assert.ok(!isTransientError(null));
    assert.ok(!isTransientError(undefined));
  });

  it('false for generic Error with no status info', () => {
    assert.ok(!isTransientError(new Error('something went wrong')));
  });
});

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const result = await withRetry(() => Promise.resolve('ok'), {
      baseDelayMs: 1, maxDelayMs: 1,
    });
    assert.equal(result, 'ok');
  });

  it('retries on transient error and succeeds on retry', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts === 1) throw new Error('HTTP 500 server error');
      return 'recovered';
    }, { baseDelayMs: 1, maxDelayMs: 1 });
    assert.equal(result, 'recovered');
    assert.equal(attempts, 2);
  });

  it('throws immediately on permanent error without retry', async () => {
    let attempts = 0;
    await assert.rejects(async () => {
      await withRetry(async () => {
        attempts++;
        throw new Error('HTTP 401 unauthorized');
      }, { baseDelayMs: 1, maxDelayMs: 1 });
    }, /401/);
    assert.equal(attempts, 1);
  });

  it('throws after maxRetries exhausted', async () => {
    let attempts = 0;
    await assert.rejects(async () => {
      await withRetry(async () => {
        attempts++;
        throw new Error('HTTP 500 server error');
      }, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 });
    }, /500/);
    assert.equal(attempts, 3); // 1 initial + 2 retries
  });

  it('respects custom maxRetries option', async () => {
    let attempts = 0;
    await assert.rejects(async () => {
      await withRetry(async () => {
        attempts++;
        throw new Error('HTTP 500 server error');
      }, { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 });
    });
    assert.equal(attempts, 2); // 1 initial + 1 retry
  });

  it('respects maxRetries: 0 (no retries)', async () => {
    let attempts = 0;
    await assert.rejects(async () => {
      await withRetry(async () => {
        attempts++;
        throw new Error('HTTP 500 server error');
      }, { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 });
    });
    assert.equal(attempts, 1);
  });

  it('defaults to 3 retries', async () => {
    let attempts = 0;
    await assert.rejects(async () => {
      await withRetry(async () => {
        attempts++;
        throw new Error('HTTP 500 server error');
      }, { baseDelayMs: 1, maxDelayMs: 1 });
    });
    assert.equal(attempts, 4); // 1 initial + 3 retries
  });
});
