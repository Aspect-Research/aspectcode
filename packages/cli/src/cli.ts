/**
 * aspectcode CLI — shared types, flag definitions, and interfaces.
 *
 * Ultra-simple: one command (`aspectcode`), minimal flags, auto-everything.
 */

import type { Logger } from './logger';

// ── Flag definitions (single source of truth) ───────────────

export type FlagType = 'boolean' | 'string';

export interface FlagDef {
  /** Long flag name (without --). */
  name: string;
  /** Short alias (without -), e.g. 'r'. */
  short?: string;
  /** Flag value type. */
  type: FlagType;
  /** Help-text description. */
  description: string;
  /** The property name on CliFlags (defaults to camelCase of `name`). */
  prop?: keyof CliFlags;
}

/**
 * Minimal flag set. No subcommands — `aspectcode` does one thing:
 * analyze, build KB in memory, optimize AGENTS.md, watch for changes.
 */
export const FLAG_DEFS: readonly FlagDef[] = [
  { name: 'help',             short: 'h', type: 'boolean', description: 'Show this help' },
  { name: 'version',          short: 'V', type: 'boolean', description: 'Print version' },
  { name: 'verbose',          short: 'v', type: 'boolean', description: 'Show debug output' },
  { name: 'quiet',            short: 'q', type: 'boolean', description: 'Suppress non-error output' },
  { name: 'root',             short: 'r', type: 'string',  description: 'Workspace root (default: cwd)' },
  { name: 'kb',                           type: 'boolean', description: 'Also write kb.md to disk' },
  { name: 'dry-run',                      type: 'boolean', description: 'Print output without writing', prop: 'dryRun' },
  { name: 'once',                         type: 'boolean', description: 'Run once then exit (no watch)' },
  { name: 'no-color',                     type: 'boolean', description: 'Disable colored output', prop: 'noColor' },
  { name: 'provider',         short: 'p', type: 'string',  description: 'LLM provider: openai|anthropic' },
  { name: 'model',            short: 'm', type: 'string',  description: 'LLM model override' },
  { name: 'max-iterations',   short: 'n', type: 'string',  description: 'Max LLM agent iterations (default: 3)', prop: 'maxIterations' },
  { name: 'accept-threshold',             type: 'string',  description: 'Min eval score to accept (1–10, default: 8)', prop: 'acceptThreshold' },
  { name: 'temperature',                  type: 'string',  description: 'Sampling temperature (0–2)' },
] as const;

// ── Parsed structures ────────────────────────────────────────

/** Parsed CLI flags — no command field, just flags. */
export interface CliFlags {
  help: boolean;
  version: boolean;
  verbose: boolean;
  quiet: boolean;
  root?: string;
  kb: boolean;
  dryRun: boolean;
  once: boolean;
  noColor: boolean;
  provider?: string;
  model?: string;
  maxIterations?: number;
  acceptThreshold?: number;
  temperature?: number;
}

/** Exit codes. */
export const ExitCode = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

// ── Runtime context ──────────────────────────────────────────

/**
 * Shared context built once in main() and passed to the pipeline.
 */
export interface RunContext {
  /** Resolved absolute workspace root. */
  root: string;
  /** Parsed CLI flags. */
  flags: CliFlags;
  /** Logger respecting --verbose / --quiet. */
  log: Logger;
}

// ── Flag-def helpers ─────────────────────────────────────────

/** Convert a kebab-case flag name to its CliFlags property key. */
export function flagPropName(def: FlagDef): string {
  if (def.prop) return def.prop;
  return def.name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
