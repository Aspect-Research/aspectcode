/**
 * aspectcode CLI — main entry point.
 *
 * No subcommands. `aspectcode [flags]` runs the pipeline:
 *   analyze → build KB → ingest tool files → optimize → write AGENTS.md → watch
 */

import * as path from 'path';
import type { CliFlags } from './cli';
import { ExitCode, FLAG_DEFS, flagPropName } from './cli';
import { createLogger, disableColor, fmt } from './logger';
import { getVersion } from './version';
import { runPipeline } from './pipeline';

// ── Build lookup tables from FLAG_DEFS ───────────────────────

/** Map --long-name → FlagDef */
const longMap = new Map(FLAG_DEFS.map((d) => [`--${d.name}`, d]));
/** Map -x → FlagDef */
const shortMap = new Map(
  FLAG_DEFS.filter((d) => d.short).map((d) => [`-${d.short}`, d]),
);

// ── Argv parsing ─────────────────────────────────────────────

export function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    help: false,
    version: false,
    verbose: false,
    quiet: false,
    kb: false,
    dryRun: false,
    once: false,
    noColor: false,
  };

  const args = argv.slice(2); // skip node + script
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    const eqIdx = arg.indexOf('=');
    const key = eqIdx > 0 ? arg.slice(0, eqIdx) : arg;
    const def = longMap.get(key) ?? shortMap.get(key);

    if (def) {
      const prop = flagPropName(def) as keyof CliFlags;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = flags as any;
      if (def.type === 'boolean') {
        record[prop] = true;
      } else {
        const val = eqIdx > 0 ? arg.slice(eqIdx + 1) : args[++i];
        record[prop] = val;
      }
    } else if (arg.startsWith('-')) {
      process.stderr.write(`Warning: unknown flag ${arg}\n`);
    }
    // positionals are ignored — no subcommands

    i++;
  }

  return flags;
}

// ── Help text ────────────────────────────────────────────────

function printHelp(): void {
  const optionLines: string[] = [];

  for (const def of FLAG_DEFS) {
    const shortPart = def.short ? `-${def.short}, ` : '    ';
    const longPart = `--${def.name}`;
    const valuePart = def.type === 'string' ? ' <value>' : '';
    const left = `  ${shortPart}${longPart}${valuePart}`;
    const pad = Math.max(2, 30 - left.length);
    optionLines.push(`${left}${' '.repeat(pad)}${def.description}`);
  }

  console.log(`
${fmt.bold('aspectcode')} — optimize AGENTS.md for your codebase

${fmt.bold('USAGE')}
  aspectcode [options]

  Analyzes your codebase, builds a knowledge base, reads existing AI tool
  instruction files for context, optimizes AGENTS.md via LLM (when API key
  is available), and watches for changes.

${fmt.bold('OPTIONS')}
${optionLines.join('\n')}

${fmt.bold('EXAMPLES')}
  aspectcode                      ${fmt.dim('# watch & auto-update AGENTS.md')}
  aspectcode --once               ${fmt.dim('# run once then exit')}
  aspectcode --once --kb          ${fmt.dim('# also write kb.md')}
  aspectcode --once --dry-run     ${fmt.dim('# preview without writing')}
  aspectcode --provider openai    ${fmt.dim('# force specific LLM provider')}
`.trimStart());
}

// ── Number-parsing helpers ───────────────────────────────────

function parseIntFlag(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function parseFloatFlag(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'string') return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parseArgs(process.argv);

  // Global flags that exit early
  if (flags.version) {
    console.log(getVersion());
    process.exitCode = ExitCode.OK;
    return;
  }

  if (flags.help) {
    printHelp();
    process.exitCode = ExitCode.OK;
    return;
  }

  if (flags.noColor) {
    disableColor();
  }

  // Parse numeric string flags
  if (typeof flags.maxIterations === 'string') {
    flags.maxIterations = parseIntFlag(flags.maxIterations, 1, 20, 3);
  }
  if (typeof flags.acceptThreshold === 'string') {
    flags.acceptThreshold = parseIntFlag(flags.acceptThreshold, 1, 10, 8);
  }
  if (typeof flags.temperature === 'string') {
    flags.temperature = parseFloatFlag(flags.temperature, 0, 2);
  }

  const log = createLogger({ verbose: flags.verbose, quiet: flags.quiet });
  const root = path.resolve(flags.root ?? process.cwd());

  process.exitCode = await runPipeline({ root, flags, log });
}

/** Entry point — called from bin/aspectcode.js. */
export function run(): void {
  main().catch((err: Error) => {
    console.error(err.message);
    process.exitCode = ExitCode.ERROR;
  });
}
