/**
 * Content summary — parses generated AGENTS.md to extract key statistics.
 *
 * Used by the dashboard to show a quick value summary after generation,
 * so users see *what* was produced, not just "file written".
 */

import type { ContentSummary } from './ui/store';

/** Regex to match backtick-wrapped file paths (e.g. `src/api/router.ts`). */
const FILE_PATH_RE = /`([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`/g;

/**
 * Parse generated AGENTS.md content and extract summary statistics.
 *
 * Counts: sections (H2 headers), rules (numbered or bulleted list items),
 * and file paths mentioned in backticks.
 */
export function summarizeContent(content: string): ContentSummary {
  const lines = content.split('\n');

  // Count H2 sections
  let sections = 0;
  for (const line of lines) {
    if (/^##\s+/.test(line)) sections++;
  }

  // Count rules (numbered items like "1. ..." or bullets like "- ...")
  let rules = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\d+\.\s+\*\*/.test(trimmed) || /^[-*]\s+\*\*/.test(trimmed)) {
      rules++;
    }
  }

  // Extract unique file paths from backtick-wrapped references
  const filePaths: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    let match: RegExpExecArray | null;
    FILE_PATH_RE.lastIndex = 0;
    while ((match = FILE_PATH_RE.exec(line)) !== null) {
      const p = match[1];
      // Filter to things that look like real file paths (have a directory separator)
      if (p.includes('/') && !seen.has(p)) {
        seen.add(p);
        filePaths.push(p);
      }
    }
  }

  return { sections, rules, filePaths };
}
