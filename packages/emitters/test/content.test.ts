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
  generateKbCustomContent,
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

// ─── KB fixture resembling real emitter output ───────────────

const SAMPLE_KB = `# Architecture

_Read this first. Describes the project layout and "Do Not Break" zones._

**Files:** 42 | **Dependencies:** 120 | **Cycles:** 0

## ⚠️ High-Risk Architectural Hubs

| File | In | Out | Role | Risk |
|------|-----|------|------|------|
| src/core/engine.ts | 12 | 3 | Core engine | High |
| src/api/router.ts | 8 | 5 | HTTP router | High |

## Entry Points

- **HTTP** — \`src/api/router.ts\` — Express router (GET /health, POST /run)
- **CLI** — \`src/cli/main.ts\` — yargs CLI entry

## Directory Layout

\`\`\`
src/
  api/       HTTP handlers
  cli/       CLI entry point
  core/      Business logic
  models/    Data models
\`\`\`

## ⚠️ Circular Dependencies

- src/a.ts ↔ src/b.ts

---

# Map

_Symbol index with signatures and conventions._

## Data Models

| Model | File | Type |
|-------|------|------|
| User | src/models/user.ts | interface |

## Conventions

### File Naming
- **Use:** camelCase for files, PascalCase for classes

### Import Style
- **Use:** named imports with explicit paths

---

# Context

_Data flow and co-location context._

## External Integrations

| Service | File | Type |
|---------|------|------|
| PostgreSQL | src/db/pool.ts | Database |
| Stripe | src/billing/client.ts | HTTP API |

## Module Clusters

- src/api/router.ts, src/api/middleware.ts — API layer
`;

describe('generateKbCustomContent', () => {
  describe('safe mode', () => {
    it('embeds high-risk hubs from KB', () => {
      const content = generateKbCustomContent(SAMPLE_KB, 'safe');
      assert.ok(content.includes('src/core/engine.ts'), 'Should embed hub file path');
      assert.ok(content.includes('src/api/router.ts'), 'Should embed hub file path');
      assert.ok(content.includes('High-Risk Hubs'), 'Should have hubs heading');
    });

    it('embeds entry points from KB', () => {
      const content = generateKbCustomContent(SAMPLE_KB, 'safe');
      assert.ok(content.includes('src/cli/main.ts'), 'Should embed CLI entry point');
      assert.ok(content.includes('Entry Points'), 'Should have entry points heading');
    });

    it('embeds directory layout from KB', () => {
      const content = generateKbCustomContent(SAMPLE_KB, 'safe');
      assert.ok(content.includes('Business logic') || content.includes('core/'), 'Should embed layout');
    });

    it('embeds conventions from KB', () => {
      const content = generateKbCustomContent(SAMPLE_KB, 'safe');
      assert.ok(content.includes('camelCase'), 'Should embed naming convention');
      assert.ok(content.includes('Coding Conventions'), 'Should have conventions heading');
    });

    it('embeds external integrations from KB', () => {
      const content = generateKbCustomContent(SAMPLE_KB, 'safe');
      assert.ok(content.includes('PostgreSQL'), 'Should embed integration');
      assert.ok(content.includes('Stripe'), 'Should embed integration');
    });

    it('embeds circular dependencies from KB', () => {
      const content = generateKbCustomContent(SAMPLE_KB, 'safe');
      assert.ok(content.includes('src/a.ts'), 'Should embed circular dep');
    });

    it('includes golden rules', () => {
      const content = generateKbCustomContent(SAMPLE_KB, 'safe');
      assert.ok(content.includes('Golden Rules'), 'Should have golden rules');
      assert.ok(content.includes('Read before you write'), 'Should include rules');
    });

    it('references kb.md for detailed lookup', () => {
      const content = generateKbCustomContent(SAMPLE_KB, 'safe');
      assert.ok(content.includes('kb.md'), 'Should reference kb.md');
    });

    it('is well-structured and trimmed', () => {
      const content = generateKbCustomContent(SAMPLE_KB, 'safe');
      assert.ok(content.startsWith('## Aspect Code'));
      assert.ok(!content.endsWith('\n\n'), 'Should be trimmed');
      assert.ok(content.length > 500, 'Should be substantial');
    });
  });

  describe('permissive mode', () => {
    it('embeds hubs and uses permissive tone', () => {
      const content = generateKbCustomContent(SAMPLE_KB, 'permissive');
      assert.ok(content.includes('src/core/engine.ts'), 'Should embed hub');
      assert.ok(content.includes('orientation') || content.includes('Pragmatic'), 'Should have permissive tone');
    });

    it('includes You May section', () => {
      const content = generateKbCustomContent(SAMPLE_KB, 'permissive');
      assert.ok(content.includes('You May'), 'Should allow broad edits');
    });
  });

  describe('fallback behavior', () => {
    it('falls back to generic template for empty KB', () => {
      const content = generateKbCustomContent('', 'safe');
      // Should fall back to the generic KB-aware template
      assert.ok(content.includes('Knowledge Base'));
      assert.ok(content.includes('kb.md'));
    });

    it('falls back to generic template when no sections found', () => {
      const content = generateKbCustomContent('# Some unrelated content\nNo sections here.', 'safe');
      assert.ok(content.includes('Knowledge Base'));
    });
  });
});
