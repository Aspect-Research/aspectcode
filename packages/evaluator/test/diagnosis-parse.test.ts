/**
 * Tests for parseDiagnoseResponse -- pure function, no LLM calls.
 */

import * as assert from 'node:assert/strict';
import { parseDiagnoseResponse } from '../src/diagnosis';

describe('parseDiagnoseResponse', () => {
  const validEdits = [
    { section: 'Validation', action: 'add', content: 'Run tests before committing' },
    { section: 'Guardrails', action: 'strengthen', content: 'No speculative changes' },
  ];

  it('parses clean JSON array of edits', () => {
    const result = parseDiagnoseResponse(JSON.stringify(validEdits));
    assert.equal(result.length, 2);
    assert.equal(result[0].section, 'Validation');
    assert.equal(result[1].action, 'strengthen');
  });

  it('strips code fences', () => {
    const raw = '```json\n' + JSON.stringify(validEdits) + '\n```';
    const result = parseDiagnoseResponse(raw);
    assert.equal(result.length, 2);
  });

  it('strips <think> tags', () => {
    const raw = '<think>Analyzing the probes...</think>\n' + JSON.stringify(validEdits);
    const result = parseDiagnoseResponse(raw);
    assert.equal(result.length, 2);
  });

  it('extracts array from surrounding text', () => {
    const raw = 'Here are the proposed edits:\n' + JSON.stringify(validEdits) + '\nEnd of edits.';
    const result = parseDiagnoseResponse(raw);
    assert.equal(result.length, 2);
  });

  it('returns empty array for invalid JSON', () => {
    assert.deepEqual(parseDiagnoseResponse('not valid json'), []);
  });

  it('returns empty array for empty string', () => {
    assert.deepEqual(parseDiagnoseResponse(''), []);
  });

  it('returns empty array for JSON object (not array)', () => {
    assert.deepEqual(parseDiagnoseResponse('{"key": "value"}'), []);
  });

  it('handles empty array []', () => {
    const result = parseDiagnoseResponse('[]');
    assert.deepEqual(result, []);
  });
});
