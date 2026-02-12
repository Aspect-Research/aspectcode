import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { stableStringify } from '../src/stableJson';

describe('stableStringify', () => {
  it('sorts object keys recursively', () => {
    const input = { b: 1, a: { d: 2, c: 1 } };
    const json = stableStringify(input, 2);

    // Top-level ordering: a then b
    assert.ok(json.indexOf('"a"') < json.indexOf('"b"'));

    // Nested ordering: c then d
    assert.ok(json.indexOf('"c"') < json.indexOf('"d"'));
  });
});
