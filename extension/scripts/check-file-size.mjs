#!/usr/bin/env node

/**
 * check-file-size.mjs
 *
 * Fails CI if any TypeScript source file exceeds the line limit.
 * Files that already exceed the limit are grandfathered with a separate,
 * higher cap — they must shrink over time, never grow.
 *
 * Usage: node scripts/check-file-size.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

// ── Thresholds ──────────────────────────────────────────────
const DEFAULT_MAX_LINES = 400;

// Grandfathered files: current size rounded up to nearest 100.
// Each Phase-N PR must reduce these caps as files are split.
const GRANDFATHERED = {
  'src/assistants/kb.ts': 4600,
  'src/services/DependencyAnalyzer.ts': 75,
  'src/extension.ts': 1300,
  'src/services/gitignoreService.ts': 800,
  'src/services/FileDiscoveryService.ts': 620,
  'src/test/kb.test.ts': 700,
  'src/commandHandlers.ts': 700,
  'src/assistants/instructions.ts': 700,
  'src/services/aspectSettings.ts': 600,
  'src/services/WorkspaceFingerprint.ts': 500,
};

// ── Helpers ──────────────────────────────────────────────────
function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'parsers', '.git'].includes(entry.name)) {
        continue;
      }
      results.push(...walk(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

// ── Main ─────────────────────────────────────────────────────
const extensionRoot = process.cwd();
const srcRoot = join(extensionRoot, 'src');
const files = walk(srcRoot);
let failures = 0;

for (const file of files) {
  const rel = relative(extensionRoot, file).replace(/\\/g, '/');
  const lines = readFileSync(file, 'utf8').split('\n').length;
  const cap = GRANDFATHERED[rel] ?? DEFAULT_MAX_LINES;

  if (lines > cap) {
    const kind = GRANDFATHERED[rel] ? 'GRANDFATHERED CAP' : 'DEFAULT CAP';
    console.error(`FAIL: ${rel} has ${lines} lines (${kind}: ${cap})`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} file(s) exceed their line cap.`);
  console.error(
    'New files must stay under ' +
      DEFAULT_MAX_LINES +
      ' lines. Grandfathered files must not grow.',
  );
  process.exit(1);
} else {
  console.log(`✓ All ${files.length} .ts files within line caps (default: ${DEFAULT_MAX_LINES}).`);
}
