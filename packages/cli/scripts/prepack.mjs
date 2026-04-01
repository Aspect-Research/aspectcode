/**
 * prepack.mjs — materialise workspace deps so `bundledDependencies` works.
 *
 * npm workspaces hoist everything into the repo root `node_modules/` via
 * symlinks, which `npm pack` refuses to follow for bundled deps.
 * This script copies the built output of each scoped workspace package into
 * `packages/cli/node_modules/@aspectcode/<pkg>` so the tarball includes them.
 *
 * It also copies third-party bundled deps (e.g. web-tree-sitter) from the
 * workspace root `node_modules/` into the CLI's local `node_modules/` so they
 * are included in the tarball alongside the workspace packages.
 *
 * The list of packages is derived from `bundledDependencies` in package.json
 * so there is a single source of truth — no separate array to keep in sync.
 */

import { cpSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliDir    = join(__dirname, '..');
const pkgsDir   = join(cliDir, '..');
const repoRoot  = join(pkgsDir, '..');

/* ---------- derive BUNDLED from package.json ---------- */
const cliPkg  = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8'));
const SCOPE   = '@aspectcode/';
const allBundled = cliPkg.bundledDependencies ?? [];

const workspaceBundled = allBundled
  .filter(d => d.startsWith(SCOPE))
  .map(d => d.slice(SCOPE.length));

const thirdPartyBundled = allBundled.filter(d => !d.startsWith(SCOPE));

if (workspaceBundled.length === 0) {
  console.error('✗ No @aspectcode/* bundledDependencies found in package.json');
  process.exit(1);
}

const errors = [];

/* ---------- materialise workspace packages ---------- */
for (const name of workspaceBundled) {
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

/* ---------- materialise third-party bundled deps ---------- */
for (const name of thirdPartyBundled) {
  const src  = join(repoRoot, 'node_modules', name);
  const dest = join(cliDir, 'node_modules', name);

  if (!existsSync(src)) {
    errors.push(`${name}: not found in workspace root node_modules/ (${src})`);
    continue;
  }

  // Clean any stale copy
  if (existsSync(dest)) rmSync(dest, { recursive: true });

  cpSync(src, dest, { recursive: true });
}

/* ---------- validate materialised packages ---------- */
for (const name of workspaceBundled) {
  const dest = join(cliDir, 'node_modules', '@aspectcode', name);
  if (!existsSync(join(dest, 'package.json'))) {
    errors.push(`${SCOPE}${name}: missing package.json in ${dest}`);
  }
  if (!existsSync(join(dest, 'dist'))) {
    errors.push(`${SCOPE}${name}: missing dist/ in ${dest} — was the package built?`);
  }
}

for (const name of thirdPartyBundled) {
  const dest = join(cliDir, 'node_modules', name);
  if (!existsSync(dest) || !existsSync(join(dest, 'package.json'))) {
    errors.push(`${name}: not materialised properly in ${dest}`);
  }
}

if (errors.length) {
  console.error('✗ Prepack validation failed:\n  ' + errors.join('\n  '));
  process.exit(1);
}

const allNames = [...workspaceBundled, ...thirdPartyBundled];
console.log(`✓ Bundled deps materialised (${allNames.join(', ')})`);
