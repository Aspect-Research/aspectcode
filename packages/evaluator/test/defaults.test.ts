/**
 * Tests for default probe-and-refine configuration.
 */

import * as assert from 'node:assert/strict';
import { DEFAULT_PROBE_REFINE_CONFIG } from '../src/types';

describe('DEFAULT_PROBE_REFINE_CONFIG', () => {
  it('defaults to 1 iteration', () => {
    assert.equal(DEFAULT_PROBE_REFINE_CONFIG.maxIterations, 1);
  });

  it('defaults to 5 probes per iteration', () => {
    assert.equal(DEFAULT_PROBE_REFINE_CONFIG.targetProbesPerIteration, 5);
  });

  it('defaults to 5 edits per iteration', () => {
    assert.equal(DEFAULT_PROBE_REFINE_CONFIG.maxEditsPerIteration, 5);
  });

  it('defaults to 8000 char budget', () => {
    assert.equal(DEFAULT_PROBE_REFINE_CONFIG.charBudget, 8000);
  });
});
