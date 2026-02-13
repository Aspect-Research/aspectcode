#!/usr/bin/env node

/**
 * check-boundaries.mjs
 *
 * Lightweight dependency-boundary checker.
 * Fails CI if layering rules are violated in import statements.
 *
 * Hard rules (exit 1):
 *   1. services/ files must NOT import from assistants/
 *   2. services/ files must NOT import from commandHandlers or extension.ts
 *   3. No file may import from dist/
 *   4. test/ files may import anything (excluded from checks)
 *
 * Soft rules (warn only — future ratchets):
 *   (none currently)
 *
 * Usage: node scripts/check-boundaries.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

// ── Configuration ────────────────────────────────────────────
const HARD_RULES = [
  {
    name: 'services/ must not import from assistants/',
    sourcePattern: /^src\/services\//,
    forbiddenImport: /from\s+['"]\.\.\/assistants\//,
  },
  {
    name: 'No file may import from dist/',
    sourcePattern: /^src\//,
    forbiddenImport: /from\s+['"]\.\.\/dist\//,
  },
  {
    name: 'services/ must not import from commandHandlers',
    sourcePattern: /^src\/services\//,
    forbiddenImport: /from\s+['"]\.\.\/commandHandlers/,
  },
  {
    name: 'services/ must not import from extension.ts',
    sourcePattern: /^src\/services\//,
    forbiddenImport: /from\s+['"]\.\.\/extension/,
  },
];

// Soft rules: warn only, do not fail CI. Track as future ratchets.
const SOFT_RULES = [];

// Files to skip
const SKIP = /^src\/test\//;

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
let warnings = 0;

for (const file of files) {
  const rel = relative(extensionRoot, file).replace(/\\/g, '/');
  if (SKIP.test(rel)) {
    continue;
  }

  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');

  // Hard rules — fail CI
  for (const rule of HARD_RULES) {
    if (!rule.sourcePattern.test(rel)) {
      continue;
    }

    for (let i = 0; i < lines.length; i++) {
      if (rule.forbiddenImport.test(lines[i])) {
        console.error(`FAIL: ${rel}:${i + 1} — violates "${rule.name}"`);
        console.error(`  ${lines[i].trim()}`);
        failures++;
      }
    }
  }

  // Soft rules — warn only
  for (const rule of SOFT_RULES) {
    if (!rule.sourcePattern.test(rel)) {
      continue;
    }

    for (let i = 0; i < lines.length; i++) {
      if (rule.forbiddenImport.test(lines[i])) {
        console.warn(`WARN: ${rel}:${i + 1} — "${rule.name}"`);
        console.warn(`  ${lines[i].trim()}`);
        warnings++;
      }
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} boundary violation(s) found.`);
  console.error('See docs/ARCHITECTURE.md for layering rules.');
  process.exit(1);
} else {
  const warnMsg = warnings > 0 ? ` (${warnings} soft warning(s) — future ratchets)` : '';
  console.log(`✓ All ${files.length} .ts files pass boundary checks.${warnMsg}`);
}
