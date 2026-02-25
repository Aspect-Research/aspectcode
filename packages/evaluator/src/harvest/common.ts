/**
 * Shared utilities for prompt harvesters.
 */

import * as path from 'path';
import * as os from 'os';
import type { HarvestedPrompt, OptLogger } from '../types';

/** Default maximum prompts harvested per source. */
export const DEFAULT_MAX_PER_SOURCE = 50;

/**
 * Extract workspace-relative file paths from a text block.
 * Looks for paths that match common code patterns.
 */
export function extractFilePaths(text: string, _root: string): string[] {
  // Match file-like patterns: word/word.ext, src/foo/bar.ts, etc.
  const pathPattern = /(?:^|\s|`|"|')([a-zA-Z0-9_./-]+\.[a-zA-Z]{1,10})(?:\s|`|"|'|$|[),;:])/gm;
  const found = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(text)) !== null) {
    const candidate = match[1];
    // Filter out URLs, version numbers, etc.
    if (candidate.includes('://')) continue;
    if (/^\d+\.\d+\.\d+/.test(candidate)) continue;
    if (candidate.startsWith('.')) continue;
    // Normalise to forward slashes
    const normalised = candidate.replace(/\\/g, '/');
    found.add(normalised);
  }

  return [...found];
}

/**
 * Filter prompts to only include those relevant to the current workspace.
 * A prompt is relevant if it references at least one file path that exists
 * somewhere in the conversation text matching a known workspace file.
 */
export function filterRecent(
  prompts: HarvestedPrompt[],
  since: Date | undefined,
  max: number,
): HarvestedPrompt[] {
  let filtered = prompts;
  if (since) {
    const sinceMs = since.getTime();
    filtered = filtered.filter((p) => {
      if (!p.timestamp) return true; // Keep prompts without timestamps
      return new Date(p.timestamp).getTime() >= sinceMs;
    });
  }
  // Take most recent first (sort by timestamp descending if available)
  filtered.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });
  return filtered.slice(0, max);
}

/**
 * Resolve the VS Code-style globalStorage path for an extension.
 */
export function vscodeGlobalStoragePath(extensionId: string): string {
  const platform = os.platform();
  const home = os.homedir();
  let base: string;
  if (platform === 'win32') {
    base = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'globalStorage');
  } else if (platform === 'darwin') {
    base = path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage');
  } else {
    base = path.join(home, '.config', 'Code', 'User', 'globalStorage');
  }
  return path.join(base, extensionId);
}

/**
 * Resolve the VS Code-style workspaceStorage path.
 */
export function vscodeWorkspaceStoragePath(): string {
  const platform = os.platform();
  const home = os.homedir();
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'workspaceStorage');
  } else if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage');
  } else {
    return path.join(home, '.config', 'Code', 'User', 'workspaceStorage');
  }
}

/**
 * Resolve a VS Code fork's storage paths (Cursor, Windsurf).
 * Returns [globalStoragePath, workspaceStoragePath].
 */
export function vscodeForkStoragePaths(appName: string): [string, string] {
  const platform = os.platform();
  const home = os.homedir();
  let base: string;
  if (platform === 'win32') {
    base = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), appName, 'User');
  } else if (platform === 'darwin') {
    base = path.join(home, 'Library', 'Application Support', appName, 'User');
  } else {
    base = path.join(home, '.config', appName, 'User');
  }
  return [
    path.join(base, 'globalStorage', 'state.vscdb'),
    path.join(base, 'workspaceStorage'),
  ];
}

/**
 * No-op logger for when no logger is provided.
 */
export const noopLogger: OptLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

/**
 * Truncate a string to a maximum length, appending "…" if truncated.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}
