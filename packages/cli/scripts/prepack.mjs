/**
 * prepack.mjs — materialise workspace deps so `bundledDependencies` works.
 *
 * npm workspaces hoist everything into the repo root `node_modules/` via
 * symlinks, which `npm pack` refuses to follow for bundled deps.
 * This script copies the built output of each scoped workspace package into
 * `packages/cli/node_modules/@aspectcode/<pkg>` so the tarball includes them.
 */

import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliDir    = join(__dirname, '..');
const pkgsDir   = join(cliDir, '..');

const BUNDLED = ['core', 'emitters', 'evaluator', 'optimizer'];

for (const name of BUNDLED) {
  const src  = join(pkgsDir, name);
  const dest = join(cliDir, 'node_modules', '@aspectcode', name);

  // Clean any stale copy
  if (existsSync(dest)) rmSync(dest, { recursive: true });
  mkdirSync(dest, { recursive: true });

  // package.json (required for Node resolution)
  cpSync(join(src, 'package.json'), join(dest, 'package.json'));

  // Compiled output
  if (existsSync(join(src, 'dist'))) {
    cpSync(join(src, 'dist'), join(dest, 'dist'), { recursive: true });
  }

  // .wasm grammars shipped by @aspectcode/core
  if (existsSync(join(src, 'parsers'))) {
    cpSync(join(src, 'parsers'), join(dest, 'parsers'), { recursive: true });
  }
}

console.log('✓ Workspace deps materialised for bundling');
