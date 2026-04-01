/**
 * Tests for diagnose — async diagnosis function with mocked LLM.
 *
 * Note: parseDiagnoseResponse tests are in diagnosis-parse.test.ts.
 */

import * as assert from 'node:assert/strict';
import { diagnose } from '../src/diagnosis';
import { fakeProvider, quietLog } from './helpers';
import type { JudgedProbeResult } from '../src/types';

function makeJudgedResult(overrides: Partial<JudgedProbeResult> = {}): JudgedProbeResult {
  return {
    probeId: 'probe-1',
    task: 'Fix test',
    response: 'I fixed it',
    behaviorReviews: [
      { behavior: 'Localizes', assessment: 'partial', evidence: '', improvement: 'Be more specific' },
    ],
    proposedEdits: [],
    overallNotes: 'Needs work',
    ...overrides,
  };
}

describe('diagnose', () => {
  it('returns edits from LLM diagnosis response', async () => {
    const llmResponse = JSON.stringify([
      { section: 'Validation', action: 'add', content: 'Run tests first' },
      { section: 'Guardrails', action: 'strengthen', content: 'No speculative edits' },
    ]);
    const provider = fakeProvider([llmResponse]);
    const result = await diagnose({
      judgedResults: [makeJudgedResult()],
      agentsContent: '# AGENTS.md',
      provider,
      log: quietLog,
    });
    assert.equal(result.length, 2);
    assert.equal(result[0].section, 'Validation');
    assert.equal(result[1].action, 'strengthen');
  });

  it('returns empty when no judged results provided', async () => {
    const provider = fakeProvider(['should not be called']);
    const result = await diagnose({
      judgedResults: [],
      agentsContent: '# AGENTS.md',
      provider,
      log: quietLog,
    });
    assert.deepEqual(result, []);
  });

  it('returns empty when all probes are strong', async () => {
    const strongResult = makeJudgedResult({
      behaviorReviews: [
        { behavior: 'test', assessment: 'strong', evidence: 'good', improvement: '' },
      ],
    });
    const provider = fakeProvider(['should not be called']);
    const result = await diagnose({
      judgedResults: [strongResult],
      agentsContent: '# AGENTS.md',
      provider,
      log: quietLog,
    });
    assert.deepEqual(result, []);
  });

  it('caps edits at 8', async () => {
    const edits = Array.from({ length: 12 }, (_, i) => ({
      section: 'Validation', action: 'add', content: `Rule ${i}`,
    }));
    const provider = fakeProvider([JSON.stringify(edits)]);
    const result = await diagnose({
      judgedResults: [makeJudgedResult()],
      agentsContent: '# AGENTS.md',
      provider,
      log: quietLog,
    });
    assert.ok(result.length <= 8);
  });

  it('filters edits with missing required fields', async () => {
    const llmResponse = JSON.stringify([
      { section: 'Validation', action: 'add', content: 'Good edit' },
      { section: '', action: 'add', content: 'Missing section' },
      { section: 'Guardrails', action: '', content: 'Missing action' },
      { section: 'Guardrails', action: 'add', content: '' },  // valid (content can be empty for scoped deletes)
    ]);
    const provider = fakeProvider([llmResponse]);
    const result = await diagnose({
      judgedResults: [makeJudgedResult()],
      agentsContent: '# AGENTS.md',
      provider,
      log: quietLog,
    });
    // Good edit + empty content edit (section+action present) = 2
    assert.equal(result.length, 2);
    assert.equal(result[0].content, 'Good edit');
  });

  it('returns empty when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = fakeProvider(['should not be called']);
    const result = await diagnose({
      judgedResults: [makeJudgedResult()],
      agentsContent: '# AGENTS.md',
      provider,
      log: quietLog,
      signal: controller.signal,
    });
    assert.deepEqual(result, []);
  });

  it('returns empty when LLM call fails', async () => {
    const provider = {
      name: 'failing',
      async chat(): Promise<string> { throw new Error('Network error'); },
    };
    const result = await diagnose({
      judgedResults: [makeJudgedResult()],
      agentsContent: '# AGENTS.md',
      provider,
      log: quietLog,
    });
    assert.deepEqual(result, []);
  });
});
