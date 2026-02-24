/**
 * Format target registry — defines output targets for each AI coding tool.
 *
 * Each `FormatTarget` maps an AI tool to its expected instruction file path,
 * optional content wrapping, and whether parent directories should be created.
 */

// ── AI Tool Identifiers ──────────────────────────────────────

/**
 * Identifiers for supported AI coding tools.
 * Used for auto-detection and multi-format instruction output.
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

// ── Format targets ───────────────────────────────────────────

/** Defines how to write instructions for a specific AI tool. */
export interface FormatTarget {
  /** Which AI tool this targets. */
  id: AiToolId | 'agents';
  /** Display name for user-facing prompts. */
  displayName: string;
  /** Relative path from workspace root where the file should be written. */
  filePath: string;
  /** Default header to use when creating a new file. */
  defaultHeader: string;
  /** Whether parent directories should be created if missing. */
  createParentDir: boolean;
}

/**
 * Registry of all format targets.
 * `agents` is always written (universal fallback).
 * Tool-specific formats are opt-in via `outputFormats` config.
 */
export const FORMAT_TARGETS: readonly FormatTarget[] = [
  {
    id: 'agents',
    displayName: 'AGENTS.md (universal)',
    filePath: 'AGENTS.md',
    defaultHeader: '# AI Coding Agent Instructions\n\n',
    createParentDir: false,
  },
  {
    id: 'copilot',
    displayName: 'GitHub Copilot',
    filePath: '.github/copilot-instructions.md',
    defaultHeader: '# Copilot Instructions\n\n',
    createParentDir: true,
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    filePath: '.cursorrules',
    defaultHeader: '',
    createParentDir: false,
  },
  {
    id: 'claudeCode',
    displayName: 'Claude Code',
    filePath: 'CLAUDE.md',
    defaultHeader: '# Claude Code Instructions\n\n',
    createParentDir: false,
  },
  {
    id: 'windsurf',
    displayName: 'Windsurf',
    filePath: '.windsurfrules',
    defaultHeader: '',
    createParentDir: false,
  },
  {
    id: 'cline',
    displayName: 'Cline',
    filePath: '.clinerules',
    defaultHeader: '',
    createParentDir: false,
  },
  {
    id: 'gemini',
    displayName: 'Gemini',
    filePath: 'GEMINI.md',
    defaultHeader: '# Gemini Instructions\n\n',
    createParentDir: false,
  },
  {
    id: 'aider',
    displayName: 'Aider',
    filePath: 'CONVENTIONS.md',
    defaultHeader: '# Conventions\n\n',
    createParentDir: false,
  },
  {
    id: 'amazonq',
    displayName: 'Amazon Q',
    filePath: '.amazonq/rules/aspectcode.md',
    defaultHeader: '',
    createParentDir: true,
  },
  {
    id: 'codex',
    displayName: 'OpenAI Codex',
    filePath: 'AGENTS.md',
    defaultHeader: '# AI Coding Agent Instructions\n\n',
    createParentDir: false,
  },
];

// ── Helpers ──────────────────────────────────────────────────

/**
 * Get the format target for a given format ID.
 * Returns undefined if the ID is not recognized.
 */
export function getFormatTarget(id: string): FormatTarget | undefined {
  return FORMAT_TARGETS.find((t) => t.id === id);
}

/**
 * Resolve which format targets to emit based on a list of format IDs.
 * Always includes 'agents' as the universal fallback.
 * De-duplicates by filePath (e.g. 'agents' and 'codex' both write AGENTS.md).
 */
export function resolveFormatTargets(formatIds: string[]): FormatTarget[] {
  // Always include agents
  const ids = new Set(['agents', ...formatIds]);

  const targets: FormatTarget[] = [];
  const seenPaths = new Set<string>();

  for (const id of ids) {
    const target = FORMAT_TARGETS.find((t) => t.id === id);
    if (target && !seenPaths.has(target.filePath)) {
      targets.push(target);
      seenPaths.add(target.filePath);
    }
  }

  return targets;
}
