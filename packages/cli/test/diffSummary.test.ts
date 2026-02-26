/**
 * Tests for diff summary utility.
 */

import * as assert from 'node:assert/strict';
import { diffSummary } from '../src/diffSummary';

describe('diffSummary', () => {
  it('reports no change for identical content', () => {
    const content = 'line one\nline two\nline three';
    const result = diffSummary(content, content);
    assert.equal(result.changed, false);
    assert.equal(result.added, 0);
    assert.equal(result.removed, 0);
  });

  it('counts added lines', () => {
    const old = 'line one\nline two';
    const now = 'line one\nline two\nline three\nline four';
    const result = diffSummary(old, now);
    assert.equal(result.changed, true);
    assert.equal(result.added, 2);
    assert.equal(result.removed, 0);
  });

  it('counts removed lines', () => {
    const old = 'line one\nline two\nline three';
    const now = 'line one';
    const result = diffSummary(old, now);
    assert.equal(result.changed, true);
    assert.equal(result.added, 0);
    assert.equal(result.removed, 2);
  });

  it('counts both added and removed', () => {
    const old = 'apple\nbanana\ncherry';
    const now = 'apple\ndate\nelderberry';
    const result = diffSummary(old, now);
    assert.equal(result.changed, true);
    // banana and cherry removed, date and elderberry added
    assert.equal(result.added, 2);
    assert.equal(result.removed, 2);
  });

  it('handles duplicate lines with frequencies', () => {
    const old = 'a\na\nb';
    const now = 'a\nb\nb';
    const result = diffSummary(old, now);
    assert.equal(result.changed, true);
    // one 'a' removed, one 'b' added
    assert.equal(result.added, 1);
    assert.equal(result.removed, 1);
  });

  it('handles empty old content (all added)', () => {
    const result = diffSummary('', 'line one\nline two');
    assert.equal(result.changed, true);
    assert.equal(result.added, 2);
    assert.equal(result.removed, 1); // empty string splits to one empty line removed
  });

  it('handles completely different content', () => {
    const old = 'foo\nbar\nbaz';
    const now = 'one\ntwo\nthree\nfour';
    const result = diffSummary(old, now);
    assert.equal(result.changed, true);
    assert.equal(result.added, 4);
    assert.equal(result.removed, 3);
  });
});
