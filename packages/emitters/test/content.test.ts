/**
 * Tests for generateCanonicalContentForMode — tiered content generation.
 *
 * Verifies that:
 * - Safe mode produces rules-only and KB-aware variants
 * - Permissive mode produces its own distinct variants
 * - KB-aware content references kb.md
 * - Rules-only content does NOT reference kb.md
 * - Off mode is handled upstream (not by content generator)
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import {
  generateCanonicalContentForMode,
  generateCanonicalContentSafe,
  generateCanonicalContentPermissive,
} from '../src/instructions/content';

describe('generateCanonicalContentForMode', () => {
  describe('safe mode', () => {
    it('returns rules-only content without KB flag', () => {
      const content = generateCanonicalContentForMode('safe');
      assert.ok(content.includes('## Aspect Code'));
      assert.ok(content.includes('Golden Rules'));
      assert.ok(!content.includes('kb.md'), 'Rules-only should not reference kb.md');
    });

    it('returns KB-aware content with KB flag', () => {
      const content = generateCanonicalContentForMode('safe', true);
      assert.ok(content.includes('kb.md'), 'KB-aware content should reference kb.md');
      assert.ok(content.includes('Knowledge Base'));
      assert.ok(content.includes('Architecture'));
      assert.ok(content.includes('Map'));
      assert.ok(content.includes('Context'));
    });

    it('safe KB content includes How to Use section', () => {
      const content = generateCanonicalContentForMode('safe', true);
      assert.ok(content.includes('How to Use kb.md'));
    });
  });

  describe('permissive mode', () => {
    it('returns permissive rules-only without KB flag', () => {
      const content = generateCanonicalContentForMode('permissive');
      assert.ok(content.includes('Pragmatic, Not Rigid') || content.includes('orientation'));
      assert.ok(!content.includes('kb.md'), 'Rules-only should not reference kb.md');
    });

    it('returns permissive KB-aware with KB flag', () => {
      const content = generateCanonicalContentForMode('permissive', true);
      assert.ok(content.includes('kb.md'));
      assert.ok(content.includes('KB-First'));
    });

    it('permissive allows refactoring', () => {
      const content = generateCanonicalContentForMode('permissive');
      assert.ok(content.includes('You May'));
      assert.ok(content.includes('Refactor'));
    });
  });

  describe('content quality', () => {
    it('safe content is non-empty and well-structured', () => {
      const safe = generateCanonicalContentSafe();
      assert.ok(safe.length > 500, 'Safe content should be substantial');
      assert.ok(safe.startsWith('## Aspect Code'));
      assert.ok(!safe.endsWith('\n\n'), 'Should be trimmed');
    });

    it('permissive content is non-empty and well-structured', () => {
      const perm = generateCanonicalContentPermissive();
      assert.ok(perm.length > 200, 'Permissive content should be substantial');
      assert.ok(perm.startsWith('## Aspect Code'));
      assert.ok(!perm.endsWith('\n\n'), 'Should be trimmed');
    });

    it('safe and permissive produce different content', () => {
      const safe = generateCanonicalContentSafe();
      const perm = generateCanonicalContentPermissive();
      assert.notEqual(safe, perm);
    });

    it('KB-aware variants are longer than rules-only', () => {
      const safeRules = generateCanonicalContentForMode('safe');
      const safeKB = generateCanonicalContentForMode('safe', true);
      assert.ok(safeKB.length > safeRules.length, 'KB content should be more detailed');
    });
  });
});
