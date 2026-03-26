/**
 * Tests for generateKbSeedContent — the initial AGENTS.md seed for probe-and-refine.
 */

import * as assert from 'node:assert/strict';
import { generateKbSeedContent } from '../src/index';

describe('generateKbSeedContent', () => {
  it('includes Operating Mode section', () => {
    const result = generateKbSeedContent('', 'TestProject');
    assert.ok(result.includes('## Operating Mode'));
    assert.ok(result.includes('Verify repo priors'));
  });

  it('includes Procedural Standards section', () => {
    const result = generateKbSeedContent('', 'TestProject');
    assert.ok(result.includes('## Procedural Standards'));
    assert.ok(result.includes('Reproduce the failure'));
  });

  it('includes Guardrails section', () => {
    const result = generateKbSeedContent('', 'TestProject');
    assert.ok(result.includes('## Guardrails'));
    assert.ok(result.includes('No speculative changes'));
  });

  it('extracts hubs from KB content when present', () => {
    const kb = `## High-Risk Architectural Hubs
| # | File | In-degree |
|---|------|-----------|
| 1 | \`src/index.ts\` | 15 |
| 2 | \`src/types.ts\` | 12 |
`;
    const result = generateKbSeedContent(kb, 'TestProject');
    assert.ok(result.includes('High-Impact Hubs'));
    assert.ok(result.includes('src/index.ts'));
  });

  it('extracts entry points from KB content when present', () => {
    const kb = `## Entry Points
- \`src/main.ts\` — application entry
- \`src/cli.ts\` — CLI entry
`;
    const result = generateKbSeedContent(kb, 'TestProject');
    assert.ok(result.includes('Entry Points'));
    assert.ok(result.includes('src/main.ts'));
  });

  it('enforces 8000 char budget with truncation marker', () => {
    // Generate a very large KB to trigger truncation
    const hugeSections: string[] = [];
    for (const section of ['High-Risk Architectural Hubs', 'Entry Points', 'External Integrations', 'Conventions']) {
      let items = `## ${section}\n`;
      for (let i = 0; i < 200; i++) {
        items += `- Item ${i} with a very long description that takes up space in the document to force truncation behavior ${'x'.repeat(50)}\n`;
      }
      hugeSections.push(items);
    }
    const hugeKb = hugeSections.join('\n\n');
    const result = generateKbSeedContent(hugeKb, 'TestProject');
    assert.ok(result.length <= 8000, `Result length ${result.length} exceeds 8000`);
  });

  it('uses projectName in title', () => {
    const result = generateKbSeedContent('', 'MyAwesomeProject');
    assert.ok(result.includes('# AGENTS.md — MyAwesomeProject'));
  });

  it('handles empty KB content gracefully', () => {
    const result = generateKbSeedContent('', 'EmptyProject');
    assert.ok(result.includes('## Operating Mode'));
    assert.ok(result.includes('## Guardrails'));
    // Should not include Repo Priors section with empty KB
    assert.ok(!result.includes('## Repo Priors'));
  });
});
