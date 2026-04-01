/**
 * File writer — writes AGENTS.md.
 *
 * Supports two ownership modes:
 * - 'full'    — overwrites the entire file (default)
 * - 'section' — wraps content in HTML comment markers and preserves
 *               the rest of the file.
 */

import type { EmitterHost } from '@aspectcode/emitters';

/** Markers used to delimit the AspectCode-owned section. */
export const MARKER_START = '<!-- aspectcode:start -->';
export const MARKER_END = '<!-- aspectcode:end -->';

export type OwnershipMode = 'full' | 'section';

/**
 * Detect whether an existing file contains AspectCode section markers.
 */
export function hasMarkers(content: string): boolean {
  return content.includes(MARKER_START) && content.includes(MARKER_END);
}

/**
 * Replace the marked section in an existing file, or append one.
 */
function applySectionContent(existingContent: string, newSection: string): string {
  const wrapped = `${MARKER_START}\n${newSection}\n${MARKER_END}`;

  if (hasMarkers(existingContent)) {
    // Replace between markers (inclusive)
    const startIdx = existingContent.indexOf(MARKER_START);
    const endIdx = existingContent.indexOf(MARKER_END) + MARKER_END.length;
    return existingContent.slice(0, startIdx) + wrapped + existingContent.slice(endIdx);
  }

  // No markers yet — append the section at the end
  const separator = existingContent.endsWith('\n') ? '\n' : '\n\n';
  return existingContent + separator + wrapped + '\n';
}

/**
 * Write AGENTS.md to the workspace root.
 *
 * In 'full' mode: overwrites the file entirely.
 * In 'section' mode: preserves user content outside the markers.
 */
export async function writeAgentsMd(
  host: EmitterHost,
  workspaceRoot: string,
  content: string,
  ownership: OwnershipMode = 'full',
): Promise<void> {
  const filePath = host.join(workspaceRoot, 'AGENTS.md');

  if (ownership === 'section') {
    let existing = '';
    try {
      existing = await host.readFile(filePath);
    } catch {
      // File doesn't exist yet — will create with markers
    }
    await host.writeFile(filePath, applySectionContent(existing, content));
  } else {
    await host.writeFile(filePath, content);
  }
}
