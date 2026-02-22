/**
 * aspectcode CLI — version helper.
 *
 * Reads the version from cli/package.json at runtime, so it stays in sync
 * without a build step.
 */

import * as path from 'path';
import * as fs from 'fs';

let _cached: string | undefined;

export function getVersion(): string {
  if (_cached) return _cached;

  const pkgPath = path.resolve(__dirname, '..', 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf-8');
  const pkg = JSON.parse(raw) as { version: string };
  _cached = pkg.version;
  return _cached;
}
