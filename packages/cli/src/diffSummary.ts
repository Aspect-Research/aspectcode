/**
 * Diff summary — lightweight line-level comparison for AGENTS.md.
 *
 * Zero dependencies. Used to show a compact change summary in the
 * dashboard when AGENTS.md is regenerated during watch mode.
 */

import type { DiffSummary } from './ui/store';

/**
 * Compare two strings and return a line-level diff summary.
 *
 * Uses a simple set-based approach: counts lines present in `newContent`
 * but not `oldContent` (added) and vice-versa (removed).
 * This is not a proper LCS diff but is fast and good enough
 * for showing "+N lines, -M lines" in the dashboard.
 */
export function diffSummary(oldContent: string, newContent: string): DiffSummary {
  if (oldContent === newContent) {
    return { added: 0, removed: 0, changed: false };
  }

  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Build frequency maps
  const oldFreq = new Map<string, number>();
  for (const line of oldLines) {
    oldFreq.set(line, (oldFreq.get(line) ?? 0) + 1);
  }

  const newFreq = new Map<string, number>();
  for (const line of newLines) {
    newFreq.set(line, (newFreq.get(line) ?? 0) + 1);
  }

  // Lines in new but not (or less frequent) in old → added
  let added = 0;
  for (const [line, count] of newFreq) {
    const oldCount = oldFreq.get(line) ?? 0;
    if (count > oldCount) added += count - oldCount;
  }

  // Lines in old but not (or less frequent) in new → removed
  let removed = 0;
  for (const [line, count] of oldFreq) {
    const newCount = newFreq.get(line) ?? 0;
    if (count > newCount) removed += count - newCount;
  }

  return { added, removed, changed: added > 0 || removed > 0 };
}
