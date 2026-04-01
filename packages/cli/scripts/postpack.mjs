/**
 * postpack.mjs — remove the materialised deps created by prepack.
 */

import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliDir    = join(__dirname, '..');

const cliPkg  = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8'));
const SCOPE   = '@aspectcode/';
const allBundled = cliPkg.bundledDependencies ?? [];
const thirdPartyBundled = allBundled.filter(d => !d.startsWith(SCOPE));

// Remove workspace deps
const aspectDir = join(cliDir, 'node_modules', '@aspectcode');
if (existsSync(aspectDir)) {
  rmSync(aspectDir, { recursive: true });
  console.log('✓ Cleaned up materialised workspace deps');
}

// Remove third-party bundled deps
for (const name of thirdPartyBundled) {
  const dest = join(cliDir, 'node_modules', name);
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true });
    console.log(`✓ Cleaned up materialised ${name}`);
  }
}
