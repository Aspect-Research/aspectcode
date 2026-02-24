/**
 * File writer — writes AGENTS.md and optionally kb.md.
 *
 * AGENTS.md is owned completely — no markers, full-file write.
 * kb.md is optional (--kb flag) and written to workspace root.
 */

import type { EmitterHost } from '@aspectcode/emitters';

/**
 * Write AGENTS.md to the workspace root.
 * Completely owns the file — overwrites entirely.
 */
export async function writeAgentsMd(
  host: EmitterHost,
  workspaceRoot: string,
  content: string,
): Promise<void> {
  const filePath = host.join(workspaceRoot, 'AGENTS.md');
  await host.writeFile(filePath, content);
}

/**
 * Write kb.md to the workspace root (optional, --kb flag).
 */
export async function writeKbMd(
  host: EmitterHost,
  workspaceRoot: string,
  kbContent: string,
): Promise<void> {
  const filePath = host.join(workspaceRoot, 'kb.md');
  await host.writeFile(filePath, kbContent);
}
