/**
 * Tests for generateProbes — async probe generation with mocked LLM.
 */

import * as assert from 'node:assert/strict';
import { generateProbes } from '../src/probes';
import { fakeProvider, quietLog } from './helpers';

describe('generateProbes', () => {
  const baseOpts = {
    kb: '## Architecture\nEntry points: main.ts',
    currentAgentsMd: '## Operating Mode\n- Rule 1',
    priorProbeTasks: [] as string[],
    maxProbes: 3,
    projectName: 'test-project',
    log: quietLog,
  };

  it('returns probes parsed from LLM response', async () => {
    const llmResponse = JSON.stringify([
      { task: 'Fix broken test in utils', expected_behaviors: ['Find the file', 'Apply fix'], rationale: 'Basic' },
      { task: 'Debug serialization error', expected_behaviors: ['Trace data flow'], rationale: 'Data' },
      { task: 'Fix race condition', expected_behaviors: ['Identify async issue'], rationale: 'Async' },
    ]);
    const provider = fakeProvider([llmResponse]);
    const result = await generateProbes({ ...baseOpts, provider });
    assert.equal(result.length, 3);
    assert.ok(result[0].task.includes('utils'));
    assert.ok(result[0].expectedBehaviors.length > 0);
  });

  it('deduplicates against priorProbeTasks', async () => {
    const llmResponse = JSON.stringify([
      { task: 'Fix broken test in utils', expected_behaviors: ['Find file'], rationale: 'r' },
      { task: 'Brand new unique task', expected_behaviors: ['Do it'], rationale: 'r' },
      { task: 'Another unique probe task', expected_behaviors: ['Check'], rationale: 'r' },
    ]);
    const provider = fakeProvider([llmResponse]);
    const result = await generateProbes({
      ...baseOpts,
      provider,
      priorProbeTasks: ['Fix broken test in utils'], // should be deduped
    });
    assert.ok(result.every((p) => !p.task.includes('utils')));
  });

  it('falls back to hardcoded templates when LLM fails', async () => {
    const provider = {
      name: 'failing',
      async chat(): Promise<string> { throw new Error('API error'); },
    };
    const result = await generateProbes({ ...baseOpts, provider, maxProbes: 3 });
    assert.ok(result.length > 0);
    assert.ok(result[0].id.startsWith('fallback-'));
  });

  it('fills remaining slots with fallback probes', async () => {
    // LLM returns only 1 probe, maxProbes is 3
    const llmResponse = JSON.stringify([
      { task: 'One LLM probe task', expected_behaviors: ['Check'], rationale: 'r' },
    ]);
    const provider = fakeProvider([llmResponse]);
    const result = await generateProbes({ ...baseOpts, provider, maxProbes: 3 });
    assert.equal(result.length, 3);
    // First should be LLM-generated, rest fallbacks
    assert.ok(result[0].id.startsWith('probe-'));
    assert.ok(result.some((p) => p.id.startsWith('fallback-')));
  });

  it('returns empty when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = fakeProvider(['should not be called']);
    const result = await generateProbes({
      ...baseOpts,
      provider,
      signal: controller.signal,
    });
    assert.deepEqual(result, []);
  });

  it('caps at maxProbes', async () => {
    const probes = Array.from({ length: 10 }, (_, i) => ({
      task: `Unique probe task number ${i}`,
      expected_behaviors: ['Check'],
      rationale: 'r',
    }));
    const provider = fakeProvider([JSON.stringify(probes)]);
    const result = await generateProbes({ ...baseOpts, provider, maxProbes: 3 });
    assert.equal(result.length, 3);
  });

  it('skips probes with missing task or expected_behaviors', async () => {
    const llmResponse = JSON.stringify([
      { task: '', expected_behaviors: ['Check'], rationale: 'r' },
      { task: 'Valid task', expected_behaviors: [], rationale: 'r' },
      { task: 'Good probe', expected_behaviors: ['Do it'], rationale: 'r' },
    ]);
    const provider = fakeProvider([llmResponse]);
    const result = await generateProbes({ ...baseOpts, provider, maxProbes: 5 });
    // Only 'Good probe' should pass validation, rest from fallbacks
    const llmProbes = result.filter((p) => p.id.startsWith('probe-'));
    assert.equal(llmProbes.length, 1);
    assert.ok(llmProbes[0].task.includes('Good probe'));
  });
});
