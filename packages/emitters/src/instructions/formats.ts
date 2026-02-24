/**
 * Format registry — AI tool identifiers and detection paths.
 */

// ── AI Tool Identifiers ──────────────────────────────────────

/**
 * Identifiers for supported AI coding tools.
 */
export type AiToolId =
  | 'copilot'
  | 'cursor'
  | 'claudeCode'
  | 'windsurf'
  | 'cline'
  | 'gemini'
  | 'aider'
  | 'amazonq'
  | 'codex';

// ── Detection paths ──────────────────────────────────────────

/**
 * Filesystem paths that indicate a given AI tool is in use.
 * Detection checks whether any of these paths exist in the workspace root.
 */
export const AI_TOOL_DETECTION_PATHS: ReadonlyArray<{
  id: AiToolId;
  /** Paths relative to workspace root to check for existence. */
  paths: string[];
}> = [
  { id: 'copilot',    paths: ['.github/copilot-instructions.md', '.github'] },
  { id: 'cursor',     paths: ['.cursorrules', '.cursor'] },
  { id: 'claudeCode', paths: ['CLAUDE.md', '.claude'] },
  { id: 'windsurf',   paths: ['.windsurfrules'] },
  { id: 'cline',      paths: ['.clinerules'] },
  { id: 'gemini',     paths: ['GEMINI.md'] },
  { id: 'aider',      paths: ['CONVENTIONS.md', '.aider'] },
  { id: 'amazonq',    paths: ['.amazonq'] },
  { id: 'codex',      paths: ['AGENTS.md'] },
];
