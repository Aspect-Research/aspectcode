/**
 * Tests for runProbes — probe execution with mocked LLM.
 */

import * as assert from 'node:assert/strict';
import { runProbes } from '../src/runner';
import { fakeProvider, quietLog, makeFakeProbe } from './helpers';

describe('runProbes', () => {
  it('returns simulation result for each probe', async () => {
    const probes = [
      makeFakeProbe({ id: 'p1', task: 'Task 1' }),
      makeFakeProbe({ id: 'p2', task: 'Task 2' }),
    ];
    const provider = fakeProvider(['Response 1', 'Response 2']);
    const results = await runProbes('# AGENTS.md', probes, provider, quietLog);
    assert.equal(results.length, 2);
    assert.equal(results[0].probeId, 'p1');
    assert.equal(results[0].response, 'Response 1');
    assert.equal(results[1].probeId, 'p2');
    assert.equal(results[1].response, 'Response 2');
  });

  it('stops early when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const probes = [makeFakeProbe({ id: 'p1' })];
    const provider = fakeProvider(['should not be called']);
    const results = await runProbes('# AGENTS.md', probes, provider, quietLog, controller.signal);
    assert.equal(results.length, 0);
  });

  it('returns empty response string when provider throws', async () => {
    const probes = [makeFakeProbe({ id: 'p1' })];
    const provider = {
      name: 'failing',
      async chat(): Promise<string> { throw new Error('API error'); },
    };
    const results = await runProbes('# AGENTS.md', probes, provider, quietLog);
    assert.equal(results.length, 1);
    assert.equal(results[0].response, '');
  });

  it('calls onProbeProgress callback for each probe', async () => {
    const probes = [makeFakeProbe({ id: 'p1' }), makeFakeProbe({ id: 'p2' })];
    const provider = fakeProvider(['r1', 'r2']);
    const progressCalls: string[] = [];
    await runProbes('# AGENTS.md', probes, provider, quietLog, undefined, (p) => {
      progressCalls.push(`${p.probeId}:${p.phase}`);
    });
    assert.ok(progressCalls.includes('p1:starting'));
    assert.ok(progressCalls.includes('p1:done'));
    assert.ok(progressCalls.includes('p2:starting'));
    assert.ok(progressCalls.includes('p2:done'));
  });

  it('returns empty array for empty probes list', async () => {
    const provider = fakeProvider([]);
    const results = await runProbes('# AGENTS.md', [], provider, quietLog);
    assert.deepEqual(results, []);
  });
});
