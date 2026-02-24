/**
 * aspectcode CLI — shared types, flag definitions, and interfaces.
 */

import type { EmitReport } from '@aspectcode/emitters';
import type { AspectCodeConfig } from './config';
import type { Logger } from './logger';

// ── Flag definitions (single source of truth) ───────────────

export type FlagType = 'boolean' | 'string' | 'enum';

export interface FlagDef {
  /** Long flag name (without --). */
  name: string;
  /** Short alias (without -), e.g. 'r'. */
  short?: string;
  /** Flag value type. */
  type: FlagType;
  /** Allowed enum values (when type === 'enum'). */
  values?: readonly string[];
  /** Help-text description. */
  description: string;
  /** Which commands this flag applies to, or 'global'. */
  appliesTo: 'global' | string[];
  /** The property name on CliFlags (defaults to camelCase of `name`). */
  prop?: keyof CliFlags;
}

/**
 * Canonical list of every CLI flag. Adding a new flag is a single entry here
 * — parseArgs() and printHelp() derive from this array automatically.
 */
export const FLAG_DEFS: readonly FlagDef[] = [
  { name: 'help',       short: 'h', type: 'boolean', description: 'Show this help',                    appliesTo: 'global' },
  { name: 'version',    short: 'V', type: 'boolean', description: 'Print version',                     appliesTo: 'global' },
  { name: 'verbose',    short: 'v', type: 'boolean', description: 'Show debug output',                 appliesTo: 'global' },
  { name: 'quiet',      short: 'q', type: 'boolean', description: 'Suppress non-error output',         appliesTo: 'global' },
  { name: 'root',       short: 'r', type: 'string',  description: 'Workspace root (default: cwd)',     appliesTo: 'global' },
  { name: 'out',        short: 'o', type: 'string',  description: 'Output directory override',         appliesTo: ['generate'] },
  { name: 'json',                   type: 'boolean', description: 'Print JSON output (for automation)', appliesTo: 'global' },
  { name: 'force',      short: 'f', type: 'boolean', description: 'Overwrite existing config (init)',  appliesTo: ['init'] },
  { name: 'no-color',               type: 'boolean', description: 'Disable colored output',            appliesTo: 'global', prop: 'noColor' },
  { name: 'file',                   type: 'string',  description: 'Filter by file path',               appliesTo: ['generate', 'impact', 'deps'] },
  { name: 'list-connections',       type: 'boolean', description: 'Print dependency connections',      appliesTo: ['generate'], prop: 'listConnections' },
  { name: 'mode',                   type: 'enum',    description: 'Watch mode: manual|onChange|idle',   appliesTo: ['watch'], values: ['manual', 'onChange', 'idle'] },
  { name: 'kb-only',                type: 'boolean', description: 'Generate KB artifacts only (skip instruction files)', appliesTo: ['generate'], prop: 'kbOnly' },
  { name: 'instructions-mode',      type: 'enum',    description: 'Instruction mode: safe|permissive|off', appliesTo: ['generate'], values: ['safe', 'permissive', 'off'], prop: 'instructionsMode' },
  { name: 'max-iterations',  short: 'n', type: 'string',  description: 'Max LLM agent iterations (default: 3)', appliesTo: ['optimize'], prop: 'maxIterations' },
  { name: 'dry-run',                     type: 'boolean', description: 'Print proposed changes without writing',  appliesTo: ['optimize'], prop: 'dryRun' },
  { name: 'provider',         short: 'p', type: 'enum',    description: 'LLM provider: openai|anthropic',         appliesTo: ['optimize'], values: ['openai', 'anthropic'] },
  { name: 'model',            short: 'm', type: 'string',  description: 'LLM model override',                     appliesTo: ['optimize'] },
  { name: 'temperature',                  type: 'string',  description: 'Sampling temperature (0–2)',              appliesTo: ['optimize'] },
  { name: 'accept-threshold',             type: 'string',  description: 'Min eval score to accept (1–10, default: 8)', appliesTo: ['optimize'], prop: 'acceptThreshold' },
  { name: 'auto-optimize',               type: 'boolean', description: 'Run optimize after each generate',        appliesTo: ['watch'], prop: 'autoOptimize' },
] as const;

// ── Parsed structures ────────────────────────────────────────

/** Parsed CLI arguments. */
export interface CliArgs {
  command: string;
  flags: CliFlags;
  positionals: string[];
}

/** Named flags extracted from argv. */
export interface CliFlags {
  help: boolean;
  version: boolean;
  verbose: boolean;
  quiet: boolean;

  /** --root / -r : workspace root override (defaults to cwd). */
  root?: string;

  /** --out / -o : output directory override. */
  out?: string;

  /** --list-connections: print dependency connections in text form. */
  listConnections: boolean;

  /** --json: machine-readable output. */
  json: boolean;

  /** --file <path>: filter dependency output to one workspace file. */
  file?: string;

  /** --force / -f : overwrite existing config during init. */
  force: boolean;

  /** --mode: watch mode override. */
  mode?: 'manual' | 'onChange' | 'idle';

  /** --kb-only: generate KB artifacts only, skip instruction files. */
  kbOnly: boolean;

  /** --instructions-mode: instruction generation mode. */
  instructionsMode?: 'safe' | 'permissive' | 'off';

  /** --no-color: disable ANSI color output. */
  noColor: boolean;

  /** --max-iterations / -n: max LLM agent iterations for optimize. */
  maxIterations?: number;

  /** --dry-run: print proposed optimize changes without writing. */
  dryRun: boolean;

  /** --provider / -p: LLM provider for optimize. */
  provider?: 'openai' | 'anthropic';

  /** --model / -m: LLM model override for optimize. */
  model?: string;

  /** --temperature: sampling temperature for optimize. */
  temperature?: number;

  /** --accept-threshold: min eval score to accept (1–10). */
  acceptThreshold?: number;

  /** --auto-optimize: chain optimize after each generate in watch mode. */
  autoOptimize: boolean;
}

/** Exit codes. */
export const ExitCode = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** Result returned by every command handler. */
export interface CommandResult {
  exitCode: ExitCodeValue;
  report?: EmitReport;
}

// ── Command context ──────────────────────────────────────────

/**
 * Shared context built once in main() and passed to every command handler.
 *
 * Eliminates repetitive 4-parameter threading and makes it trivial
 * to add cross-cutting capabilities (timing, telemetry) later.
 */
export interface CommandContext {
  /** Resolved absolute workspace root. */
  root: string;
  /** Parsed CLI flags. */
  flags: CliFlags;
  /** Loaded config (undefined when no aspectcode.json exists). */
  config: AspectCodeConfig | undefined;
  /** Logger respecting --verbose / --quiet. */
  log: Logger;
  /** Raw positional arguments after the command name. */
  positionals: string[];
}

// ── Flag-def helpers ─────────────────────────────────────────

/** Convert a kebab-case flag name to its CliFlags property key. */
export function flagPropName(def: FlagDef): string {
  if (def.prop) return def.prop;
  // kebab-case → camelCase
  return def.name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
