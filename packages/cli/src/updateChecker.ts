/**
 * Auto-update checker — checks npm for newer version on startup.
 * If a newer version exists, updates in-place via `npm install -g`.
 */

import { execSync } from 'child_process';
import { getVersion } from './version';

/**
 * Compare two semver strings. Returns:
 *  1 if a > b, -1 if a < b, 0 if equal.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}

/**
 * Fetch the latest version from npm registry.
 * Returns null if the check fails (offline, timeout, etc.).
 */
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
 * Check for updates and auto-install if available.
 * Returns a status message for the dashboard, or null if up-to-date.
 */
export function checkForUpdate(): { updated: boolean; message: string } | null {
  const current = getVersion();
  const latest = fetchLatestVersion();

  if (!latest) return null; // offline or check failed
  if (compareSemver(latest, current) <= 0) return null; // up to date

  // Newer version available — update in place
  try {
    execSync(`npm install -g aspectcode@${latest}`, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { updated: true, message: `Updated to v${latest}` };
  } catch {
    return { updated: false, message: `v${latest} available — run: npm i -g aspectcode` };
  }
}
