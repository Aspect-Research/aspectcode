/**
 * Update checker — checks npm for newer version on startup.
 * Returns a passive notification string for the dashboard header.
 */

import { execSync } from 'child_process';
import { getVersion } from './version';

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}

function fetchLatestVersion(): string | null {
  try {
    const raw = execSync('npm view aspectcode version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return raw.trim();
  } catch {
    return null;
  }
}

/**
 * Check for a newer version on npm.
 * Returns a notification message, or null if up-to-date/offline.
 */
export function checkForUpdate(): string | null {
  const current = getVersion();
  const latest = fetchLatestVersion();

  if (!latest) return null;
  if (compareSemver(latest, current) <= 0) return null;

  return `v${latest} available — run: npm i -g aspectcode`;
}
