/**
 * Additional tests for stableStringify — edge cases and type coverage.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { stableStringify } from '../src/stableJson';

describe('stableStringify (extended)', () => {
  it('handles null', () => {
    assert.equal(stableStringify(null), 'null');
  });

  it('handles primitive string', () => {
    assert.equal(stableStringify('hello'), '"hello"');
  });

  it('handles primitive number', () => {
    assert.equal(stableStringify(42), '42');
  });

  it('handles boolean', () => {
    assert.equal(stableStringify(true), 'true');
  });

  it('handles arrays (preserves element order)', () => {
    const input = [3, 1, 2];
    const json = stableStringify(input);
    assert.deepEqual(JSON.parse(json), [3, 1, 2]);
  });

  it('sorts keys inside array elements', () => {
    const input = [{ b: 2, a: 1 }];
    const json = stableStringify(input);
    assert.ok(json.indexOf('"a"') < json.indexOf('"b"'));
  });

  it('handles deeply nested objects', () => {
    const input = { z: { y: { x: 1 } } };
    const json = stableStringify(input);
    const parsed = JSON.parse(json);
    assert.equal(parsed.z.y.x, 1);
  });

  it('handles empty object', () => {
    assert.equal(stableStringify({}), '{}');
  });

  it('handles empty array', () => {
    assert.equal(stableStringify([]), '[]');
  });

  it('respects custom space parameter', () => {
    const json4 = stableStringify({ a: 1 }, 4);
    assert.ok(json4.includes('    "a"'), 'Should use 4-space indent');

    const json0 = stableStringify({ a: 1 }, 0);
    assert.ok(!json0.includes('\n'), 'No newlines with space=0');
  });

  it('is deterministic across runs', () => {
    const input = { c: [{ z: 99, a: 1 }], a: 'first', b: null };
    const run1 = stableStringify(input);
    const run2 = stableStringify(input);
    assert.equal(run1, run2);

    // Key order: a, b, c
    assert.ok(run1.indexOf('"a"') < run1.indexOf('"b"'));
    assert.ok(run1.indexOf('"b"') < run1.indexOf('"c"'));
  });

  it('handles null prototype objects', () => {
    const obj = Object.create(null);
    obj.b = 2;
    obj.a = 1;
    const json = stableStringify(obj);
    assert.ok(json.indexOf('"a"') < json.indexOf('"b"'));
  });

  it('handles mixed nested arrays and objects', () => {
    const input = {
      items: [
        { name: 'z' },
        { name: 'a' },
      ],
      meta: { version: 1 },
    };
    const json = stableStringify(input);
    const parsed = JSON.parse(json);
    assert.equal(parsed.items[0].name, 'z');
    assert.equal(parsed.items[1].name, 'a');
    assert.ok(json.indexOf('"items"') < json.indexOf('"meta"'));
  });
});
