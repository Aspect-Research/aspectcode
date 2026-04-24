/**
 * Pure Node.js recursive file walker for source file discovery.
 *
 * No vscode dependency — uses only `fs` and `path`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_EXCLUSIONS, SUPPORTED_EXTENSIONS } from './exclusions';

// ── Public types ─────────────────────────────────────────────

export interface DiscoverOptions {
  /** Directory names to exclude (defaults to DEFAULT_EXCLUSIONS) */
  exclude?: readonly string[];
  /** File extensions to include, with leading dot (defaults to SUPPORTED_EXTENSIONS) */
  extensions?: readonly string[];
  /** Maximum number of files to return (0 = unlimited) */
  maxFiles?: number;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Recursively discover source files under `root`.
 *
 * Returns absolute paths, sorted lexicographically for determinism.
 *
 * @param root     Absolute path to the workspace root
 * @param options  Optional filters
 */
export async function discoverFiles(
  root: string,
  options?: DiscoverOptions,
): Promise<string[]> {
  const excludeSet = new Set(
    (options?.exclude ?? DEFAULT_EXCLUSIONS).map((d) => d.toLowerCase()),
  );
  const extSet = new Set(
    (options?.extensions ?? SUPPORTED_EXTENSIONS).map((e) => e.toLowerCase()),
  );
  const maxFiles = options?.maxFiles ?? 10_000;

  const result: string[] = [];

  await walkDir(root, excludeSet, extSet, maxFiles, result);

  result.sort();
  return result;
}

// ── Internals ────────────────────────────────────────────────

async function walkDir(
  dir: string,
  excludeSet: Set<string>,
  extSet: Set<string>,
  maxFiles: number,
  result: string[],
): Promise<void> {
  if (maxFiles > 0 && result.length >= maxFiles) return;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    // Permission denied, symlink loop, etc. — skip silently.
    return;
  }

  // Sort entries for deterministic traversal order
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (maxFiles > 0 && result.length >= maxFiles) return;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (excludeSet.has(entry.name.toLowerCase())) continue;
      await walkDir(full, excludeSet, extSet, maxFiles, result);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extSet.has(ext)) {
        result.push(full);
      }
    }
  }
}
