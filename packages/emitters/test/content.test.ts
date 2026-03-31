/**
 * Tests for content generation — clean format matching sweagent_bench.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import {
  generateCanonicalContentForMode,
  generateCanonicalContentSafe,
  generateCanonicalContentPermissive,
  generateKbCustomContent,
} from '../src/instructions/content';

describe('generateCanonicalContentForMode', () => {
  describe('safe mode', () => {
    it('returns clean format with Operating Mode', () => {
      const content = generateCanonicalContentForMode('safe');
      assert.ok(content.includes('Operating Mode'));
      assert.ok(content.includes('Procedural Standards'));
      assert.ok(content.includes('Guardrails'));
    });

    it('does not include old verbose content', () => {
      const content = generateCanonicalContentForMode('safe');
      assert.ok(!content.includes('Golden Rules'), 'Should not have Golden Rules');
      assert.ok(!content.includes('kb.md'), 'Should not reference kb.md');
      assert.ok(!content.includes('Aspect Code analyzed'), 'Should not have old header');
      assert.ok(!content.includes('When Things Go Wrong'), 'Should not have old section');
    });

    it('KB flag returns same clean format', () => {
      const content = generateCanonicalContentForMode('safe', true);
      assert.ok(content.includes('Operating Mode'));
      assert.ok(!content.includes('kb.md'));
    });
  });

  describe('permissive mode', () => {
    it('returns same clean format as safe mode', () => {
      const safe = generateCanonicalContentForMode('safe');
      const permissive = generateCanonicalContentForMode('permissive');
      assert.equal(safe, permissive);
    });
  });
});

describe('generateCanonicalContentSafe', () => {
  it('includes Operating Mode and Guardrails', () => {
    const content = generateCanonicalContentSafe();
    assert.ok(content.includes('Operating Mode'));
    assert.ok(content.includes('Guardrails'));
  });
});

describe('generateCanonicalContentPermissive', () => {
  it('returns same as safe', () => {
    assert.equal(generateCanonicalContentPermissive(), generateCanonicalContentSafe());
  });
});

describe('generateKbCustomContent', () => {
  it('returns clean format with Repo Priors when KB has hubs', () => {
    const kb = `## High-Risk Architectural Hubs

| Rank | File | Imports | Imported By | Risk |
|------|------|---------|-------------|------|
| 1 | \`src/core.ts\` | 5 | 12 | High |
`;
    const content = generateKbCustomContent(kb, 'safe');
    assert.ok(content.includes('Operating Mode'));
    assert.ok(content.includes('High-Impact Hubs'));
    assert.ok(content.includes('src/core.ts'));
    assert.ok(!content.includes('kb.md'));
  });

  it('returns clean format even with empty KB', () => {
    const content = generateKbCustomContent('', 'safe');
    assert.ok(content.includes('Operating Mode'));
    assert.ok(content.includes('Guardrails'));
  });
});
