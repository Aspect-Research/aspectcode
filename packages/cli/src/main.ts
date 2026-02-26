/**
 * aspectcode CLI — main entry point.
 *
 * No subcommands. `aspectcode [flags]` runs the pipeline:
 *   analyze → build KB → ingest tool files → optimize → write AGENTS.md → watch
 */

import * as path from 'path';
import type { CliFlags } from './cli';
import { ExitCode, FLAG_DEFS, flagPropName } from './cli';
import type { SpinnerFactory } from './cli';
import { createLogger, createSpinner, disableColor, fmt } from './logger';
import { getVersion } from './version';
import { runPipeline, resolveRunMode } from './pipeline';
import { createDashboardLogger, createDashboardSpinner } from './ui/inkLogger';
import { store } from './ui/store';
import type { PipelinePhase } from './ui/store';

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
    compact: false,
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
${fmt.bold('aspectcode')} — generate AGENTS.md for your codebase

${fmt.bold('USAGE')}
  aspectcode [options]

  Analyzes your codebase, builds a knowledge base, reads existing AI tool
  instruction files for context, generates AGENTS.md via LLM (when API key
  is available), and watches for changes.

${fmt.bold('OPTIONS')}
${optionLines.join('\n')}

${fmt.bold('EXAMPLES')}
  aspectcode                      ${fmt.dim('# watch & auto-update AGENTS.md')}
  aspectcode --once               ${fmt.dim('# run once then exit')}
  aspectcode --once --kb          ${fmt.dim('# also write kb.md')}
  aspectcode --once --dry-run     ${fmt.dim('# preview without writing')}
  aspectcode --provider openai    ${fmt.dim('# force specific LLM provider')}
  aspectcode --compact            ${fmt.dim('# minimal dashboard layout')}
`.trimStart());
}

// ── Number-parsing helpers ───────────────────────────────────

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
  if (typeof flags.temperature === 'string') {
    flags.temperature = parseFloatFlag(flags.temperature, 0, 2);
  }

  const root = path.resolve(flags.root ?? process.cwd());

  // Resolve ownership + generate mode BEFORE mounting the ink dashboard.
  // selectPrompt uses raw stdin which conflicts with ink's useInput.
  const { ownership, generate } = await resolveRunMode(root);

  const useDashboard = !flags.quiet && !flags.noColor && process.stdout.isTTY === true;

  let log;
  let spin: SpinnerFactory;
  let unmount: (() => void) | undefined;

  if (useDashboard) {
    // Set compact mode before mounting dashboard
    if (flags.compact) {
      store.setCompact(true);
    }

    // ink-based dashboard mode
    log = createDashboardLogger();
    spin = (msg: string, phase?: string) =>
      createDashboardSpinner((phase ?? 'idle') as PipelinePhase, msg);

    try {
      // Clear screen content but preserve scrollback (avoids Ink re-render desync
      // that \x1bc causes — that sends a full terminal reset which confuses Ink's
      // cursor tracking and causes the banner to be reprinted on every render).
      process.stdout.write('\x1B[2J\x1B[H');

      const { render } = await import('ink');
      const React = await import('react');
      const Dashboard = (await import('./ui/Dashboard')).default;
      const instance = render(React.createElement(Dashboard));
      unmount = () => instance.unmount();
    } catch {
      // If ink rendering fails, fall back gracefully
      log = createLogger({ verbose: flags.verbose, quiet: flags.quiet });
      spin = (msg: string) => createSpinner(msg, { quiet: flags.quiet });
      unmount = undefined;
    }
  } else {
    log = createLogger({ verbose: flags.verbose, quiet: flags.quiet });
    spin = (msg: string) => createSpinner(msg, { quiet: flags.quiet });
  }

  try {
    process.exitCode = await runPipeline({ root, flags, log, spin, ownership, generate });
  } finally {
    if (unmount) unmount();
  }
}

/** Entry point — called from bin/aspectcode.js. */
export function run(): void {
  main().catch((err: Error) => {
    console.error(err.message);
    process.exitCode = ExitCode.ERROR;
  });
}
