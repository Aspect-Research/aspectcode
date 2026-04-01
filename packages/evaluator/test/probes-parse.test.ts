/**
 * Tests for probe parsing and deduplication -- pure functions.
 */

import * as assert from 'node:assert/strict';
import { parseProbeResponse, normalizeProbeText, isDuplicate } from '../src/probes';

describe('parseProbeResponse', () => {
  const validArray = [
    { task: 'Fix the bug', expected_behaviors: ['Find the file', 'Apply fix'], rationale: 'Basic test' },
  ];

  it('parses clean JSON array', () => {
    const result = parseProbeResponse(JSON.stringify(validArray));
    assert.equal(result.length, 1);
    assert.equal(result[0].task, 'Fix the bug');
  });

  it('parses array wrapped in code fences', () => {
    const raw = '```json\n' + JSON.stringify(validArray) + '\n```';
    const result = parseProbeResponse(raw);
    assert.equal(result.length, 1);
  });

  it('strips <think> tags before parsing', () => {
    const raw = '<think>Generating probes...</think>\n' + JSON.stringify(validArray);
    const result = parseProbeResponse(raw);
    assert.equal(result.length, 1);
  });

  it('extracts JSON array from surrounding prose', () => {
    const raw = 'Here are the probes:\n' + JSON.stringify(validArray) + '\nDone.';
    const result = parseProbeResponse(raw);
    assert.equal(result.length, 1);
  });

  it('returns empty array for invalid JSON', () => {
    const result = parseProbeResponse('not json at all');
    assert.deepEqual(result, []);
  });

  it('returns empty array for JSON object (not array)', () => {
    const result = parseProbeResponse('{"key": "value"}');
    assert.deepEqual(result, []);
  });

  it('returns empty array for empty string', () => {
    const result = parseProbeResponse('');
    assert.deepEqual(result, []);
  });
});

describe('normalizeProbeText', () => {
  it('lowercases text', () => {
    assert.equal(normalizeProbeText('Hello WORLD'), 'hello world');
  });

  it('strips non-alphanumeric characters', () => {
    assert.equal(normalizeProbeText('fix: the bug!'), 'fix the bug');
  });

  it('collapses whitespace', () => {
    assert.equal(normalizeProbeText('a   b    c'), 'a b c');
  });

  it('trims leading/trailing whitespace', () => {
    assert.equal(normalizeProbeText('  hello  '), 'hello');
  });

  it('handles empty string', () => {
    assert.equal(normalizeProbeText(''), '');
  });
});

describe('isDuplicate', () => {
  it('detects exact normalized match', () => {
    assert.ok(isDuplicate('Fix the bug', ['fix the bug']));
  });

  it('detects new task as substring of existing', () => {
    assert.ok(isDuplicate('fix bug', ['fix bug in utils module']));
  });

  it('detects existing task as substring of new', () => {
    assert.ok(isDuplicate('fix the critical bug in utils', ['fix the critical bug']));
  });

  it('returns false for unrelated tasks', () => {
    assert.ok(!isDuplicate('add new feature', ['fix the bug']));
  });

  it('is case-insensitive', () => {
    assert.ok(isDuplicate('FIX THE BUG', ['fix the bug']));
  });

  it('ignores punctuation differences', () => {
    assert.ok(isDuplicate('Fix: the bug!', ['fix the bug']));
  });

  it('handles empty existing list', () => {
    assert.ok(!isDuplicate('anything', []));
  });
});
