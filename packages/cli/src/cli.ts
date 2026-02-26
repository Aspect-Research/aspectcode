/**
 * aspectcode CLI — shared types, flag definitions, and interfaces.
 *
 * Ultra-simple: one command (`aspectcode`), minimal flags, auto-everything.
 */

import type { Logger, Spinner } from './logger';

/** Factory to create a spinner — allows dashboard to intercept. */
export type SpinnerFactory = (msg: string, phase?: string) => Spinner;

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
  { name: 'temperature',                  type: 'string',  description: 'Sampling temperature (0–2)' },
  { name: 'compact',                       type: 'boolean', description: 'Compact dashboard (no banner)' },
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
  temperature?: number;
  compact: boolean;
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
  /** Spinner factory (dashboard-aware or plain). */
  spin: SpinnerFactory;
  /** Pre-resolved AGENTS.md ownership mode. */
  ownership: 'full' | 'section';
}

// ── Flag-def helpers ─────────────────────────────────────────

/** Convert a kebab-case flag name to its CliFlags property key. */
export function flagPropName(def: FlagDef): string {
  if (def.prop) return def.prop;
  return def.name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
