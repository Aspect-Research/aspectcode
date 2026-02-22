#!/usr/bin/env node
/**
 * Verify that extension/parsers/ and packages/core/parsers/ contain
 * identical WASM files.  Exits non-zero if any file is missing or
 * differs between the two directories.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');

const dirA = join(root, 'extension', 'parsers');
const dirB = join(root, 'packages', 'core', 'parsers');

async function hashFile(filePath) {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

async function listWasm(dir) {
  const entries = await readdir(dir).catch(() => []);
  return entries.filter((f) => f.endsWith('.wasm')).sort();
}

const [filesA, filesB] = await Promise.all([listWasm(dirA), listWasm(dirB)]);

const allFiles = [...new Set([...filesA, ...filesB])].sort();
const errors = [];

for (const file of allFiles) {
  const inA = filesA.includes(file);
  const inB = filesB.includes(file);

  if (!inA) {
    errors.push(`MISSING  extension/parsers/${file}  (exists in packages/core/parsers/)`);
    continue;
  }
  if (!inB) {
    errors.push(`MISSING  packages/core/parsers/${file}  (exists in extension/parsers/)`);
    continue;
  }

  const [hashA, hashB] = await Promise.all([
    hashFile(join(dirA, file)),
    hashFile(join(dirB, file)),
  ]);

  if (hashA !== hashB) {
    errors.push(`MISMATCH ${file}  extension=${hashA.slice(0, 12)}…  core=${hashB.slice(0, 12)}…`);
  }
}

if (errors.length > 0) {
  console.error('Parser parity check FAILED:\n');
  for (const e of errors) console.error(`  ${e}`);
  console.error(
    '\nThe WASM files in extension/parsers/ and packages/core/parsers/ must be identical.',
  );
  console.error('Copy the updated files to both directories and commit.');
  process.exit(1);
} else {
  console.log(`Parser parity OK — ${allFiles.length} WASM files match.`);
}
