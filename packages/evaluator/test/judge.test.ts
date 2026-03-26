/**
 * Tests for judgeProbe — async judge function with mocked LLM.
 */

import * as assert from 'node:assert/strict';
import { judgeProbe } from '../src/judge';
import { fakeProvider, quietLog } from './helpers';

describe('judgeProbe', () => {
  const baseOpts = {
    task: 'Fix the broken test',
    response: 'I found the issue in utils.ts and applied a fix.',
    expectedBehaviors: ['Localizes the file', 'Applies minimal fix'],
    probeId: 'test-probe-1',
    log: quietLog,
  };

  it('returns structured assessments from valid response', async () => {
    const judgeResponse = JSON.stringify({
      behavior_reviews: [
        { behavior: 'Localizes the file', assessment: 'strong', evidence: 'Found utils.ts', improvement: '' },
        { behavior: 'Applies minimal fix', assessment: 'partial', evidence: 'Fix was broad', improvement: 'Be more targeted' },
      ],
      proposed_edits: [
        { section: 'Validation', action: 'add', content: 'Run unit tests after changes' },
      ],
      overall_notes: 'Decent response',
    });
    const provider = fakeProvider([judgeResponse]);
    const result = await judgeProbe({ ...baseOpts, provider });
    assert.equal(result.behaviorReviews.length, 2);
    assert.equal(result.behaviorReviews[0].assessment, 'strong');
    assert.equal(result.behaviorReviews[1].assessment, 'partial');
    assert.equal(result.proposedEdits.length, 1);
    assert.equal(result.overallNotes, 'Decent response');
  });

  it('maps unknown assessment values to missing', async () => {
    const judgeResponse = JSON.stringify({
      behavior_reviews: [
        { behavior: 'test', assessment: 'excellent', evidence: '', improvement: '' },
      ],
      proposed_edits: [],
      overall_notes: '',
    });
    const provider = fakeProvider([judgeResponse]);
    const result = await judgeProbe({ ...baseOpts, provider });
    assert.equal(result.behaviorReviews[0].assessment, 'missing');
  });

  it('caps proposed_edits at 3', async () => {
    const judgeResponse = JSON.stringify({
      behavior_reviews: [],
      proposed_edits: [
        { section: 'A', action: 'add', content: '1' },
        { section: 'B', action: 'add', content: '2' },
        { section: 'C', action: 'add', content: '3' },
        { section: 'D', action: 'add', content: '4' },
        { section: 'E', action: 'add', content: '5' },
      ],
      overall_notes: '',
    });
    const provider = fakeProvider([judgeResponse]);
    const result = await judgeProbe({ ...baseOpts, provider });
    assert.ok(result.proposedEdits.length <= 3);
  });

  it('maps unknown action values to add', async () => {
    const judgeResponse = JSON.stringify({
      behavior_reviews: [],
      proposed_edits: [
        { section: 'Validation', action: 'update', content: 'Test rule' },
      ],
      overall_notes: '',
    });
    const provider = fakeProvider([judgeResponse]);
    const result = await judgeProbe({ ...baseOpts, provider });
    assert.equal(result.proposedEdits[0].action, 'add');
  });

  it('returns all-missing when provider throws', async () => {
    const provider = {
      name: 'failing',
      async chat(): Promise<string> { throw new Error('API error'); },
    };
    const result = await judgeProbe({ ...baseOpts, provider });
    assert.equal(result.behaviorReviews.length, 2);
    assert.ok(result.behaviorReviews.every((br) => br.assessment === 'missing'));
    assert.equal(result.proposedEdits.length, 0);
  });

  it('returns all-missing when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = fakeProvider(['should not be called']);
    const result = await judgeProbe({ ...baseOpts, provider, signal: controller.signal });
    assert.equal(result.behaviorReviews.length, 0);
    assert.equal(result.overallNotes, 'Cancelled');
  });
});
