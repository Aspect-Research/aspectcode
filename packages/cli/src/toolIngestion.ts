/**
 * Tool instruction ingestion — reads other AI tool instruction files
 * as read-only context for LLM optimization.
 *
 * Scans the workspace root for known AI tool instruction files
 * (e.g. .cursorrules, CLAUDE.md, etc.) and returns their content.
 * AGENTS.md is excluded since that's what we're generating.
 */

import type { EmitterHost } from '@aspectcode/emitters';

/**
 * Known AI tool instruction file paths relative to workspace root.
 * AGENTS.md is intentionally omitted — we own that file.
 */
const TOOL_INSTRUCTION_PATHS: ReadonlyArray<{ tool: string; path: string }> = [
  { tool: 'GitHub Copilot',  path: '.github/copilot-instructions.md' },
  { tool: 'Cursor',          path: '.cursorrules' },
  { tool: 'Claude Code',     path: 'CLAUDE.md' },
  { tool: 'Windsurf',        path: '.windsurfrules' },
  { tool: 'Cline',           path: '.clinerules' },
  { tool: 'Gemini',          path: 'GEMINI.md' },
  { tool: 'Aider',           path: 'CONVENTIONS.md' },
];

/**
 * Read all existing AI tool instruction files from the workspace.
 * Returns a Map of tool name → file content (only files that exist).
 */
export async function readToolInstructions(
  host: EmitterHost,
  workspaceRoot: string,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  for (const entry of TOOL_INSTRUCTION_PATHS) {
    const fullPath = host.join(workspaceRoot, entry.path);
    try {
      if (await host.exists(fullPath)) {
        const content = await host.readFile(fullPath);
        if (content.trim().length > 0) {
          results.set(entry.tool, content);
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}
