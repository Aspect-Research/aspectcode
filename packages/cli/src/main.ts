/**
 * aspectcode CLI — main entry point.
 *
 * Hand-rolled argv parser (no external deps). Routes to command handlers.
 * Flag definitions live in cli.ts (FLAG_DEFS) — parseArgs and printHelp
 * derive from that single source of truth.
 */

import * as path from 'path';
import type { CliArgs, CliFlags, CommandResult } from './cli';
import { ExitCode, FLAG_DEFS, flagPropName } from './cli';
import type { CommandContext } from './cli';
import { loadConfig } from './config';
import { createLogger, disableColor, fmt } from './logger';
import { getVersion } from './version';
import { runGenerate } from './commands/generate';
import { runDepsList, runDepsImpact } from './commands/deps';
import { runWatch } from './commands/watch';
import {
  runAddExclude,
  runRemoveExclude,
  runSetUpdateRate,
  runShowConfig,
} from './commands/settings';

// ── Build lookup tables from FLAG_DEFS ───────────────────────

/** Map --long-name → FlagDef */
const longMap = new Map(FLAG_DEFS.map((d) => [`--${d.name}`, d]));
/** Map -x → FlagDef */
const shortMap = new Map(
  FLAG_DEFS.filter((d) => d.short).map((d) => [`-${d.short}`, d]),
);

// ── Argv parsing ─────────────────────────────────────────────

export function parseArgs(argv: string[]): CliArgs {
  const flags: CliFlags = {
    help: false,
    version: false,
    verbose: false,
    quiet: false,
    listConnections: false,
    json: false,
    kbOnly: false,
    kb: false,
    noColor: false,
  };
  const positionals: string[] = [];
  let command = '';

  const args = argv.slice(2); // skip node + script
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    // Try --long-name or -x lookup
    const eqIdx = arg.indexOf('=');
    const key = eqIdx > 0 ? arg.slice(0, eqIdx) : arg;
    const def = longMap.get(key) ?? shortMap.get(key);

    if (def) {
      const prop = flagPropName(def) as keyof CliFlags;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const record = flags as any;
      if (def.type === 'boolean') {
        record[prop] = true;
      } else if (def.type === 'string') {
        const val = eqIdx > 0 ? arg.slice(eqIdx + 1) : args[++i];
        record[prop] = val;
      } else if (def.type === 'enum' && def.values) {
        const val = eqIdx > 0 ? arg.slice(eqIdx + 1) : args[++i];
        if (def.values.includes(val)) {
          record[prop] = val;
        }
      }
    } else if (arg.startsWith('--') && eqIdx > 0) {
      // Unknown --flag=value — try lookup by prefix before '='
      const stderr = process.stderr;
      if (stderr && typeof stderr.write === 'function') {
        stderr.write(`Warning: unknown flag ${key}\n`);
      }
    } else if (arg.startsWith('-')) {
      // Unknown flag — warn but keep going for forward compat
      const stderr = process.stderr;
      if (stderr && typeof stderr.write === 'function') {
        stderr.write(`Warning: unknown flag ${arg}\n`);
      }
    } else if (!command) {
      command = arg;
    } else {
      positionals.push(arg);
    }

    i++;
  }

  return { command, flags, positionals };
}

// ── Help text ────────────────────────────────────────────────

function printHelp(): void {
  const optionLines: string[] = [];

  for (const def of FLAG_DEFS) {
    const shortPart = def.short ? `-${def.short}, ` : '    ';
    const longPart = `--${def.name}`;
    const valuePart =
      def.type === 'string' ? ' <value>' :
      def.type === 'enum' ? ` <${(def.values ?? []).join('|')}>` : '';
    const left = `  ${shortPart}${longPart}${valuePart}`;
    const pad = Math.max(2, 30 - left.length);
    optionLines.push(`${left}${' '.repeat(pad)}${def.description}`);
  }

  console.log(`
${fmt.bold('aspectcode')} — generate AI-assistant knowledge bases from your codebase

${fmt.bold('USAGE')}
  aspectcode <command> [options]

${fmt.bold('COMMANDS')}
  generate  ${fmt.dim('(gen, g)')}       Discover, analyze, and emit KB artifacts
  watch                    Watch source files and regenerate on changes
  deps list                List dependency connections
  deps impact              Compute impact analysis for a file
  show-config              Show current ${fmt.cyan('aspectcode.json')} values
  set-update-rate <mode>   Set updateRate to manual|onChange|idle
  add-exclude <path>       Add an exclude path
  remove-exclude <path>    Remove an exclude path

${fmt.bold('OPTIONS')}
${optionLines.join('\n')}

${fmt.bold('EXAMPLES')}
  aspectcode generate
  aspectcode generate --kb
  aspectcode g --json
  aspectcode deps impact --file src/app.ts
  aspectcode deps list --file src/app.ts
  aspectcode watch --mode idle
`.trimStart());
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  const { command, flags } = parsed;

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

  if (!command) {
    printHelp();
    process.exitCode = ExitCode.USAGE;
    return;
  }

  // Apply --no-color before any output
  if (flags.noColor) {
    disableColor();
  }

  const log = createLogger({ verbose: flags.verbose, quiet: flags.quiet });
  const root = path.resolve(flags.root ?? process.cwd());

  // Build shared context — loadConfig returns undefined when no aspectcode.json exists
  const config = loadConfig(root);

  const ctx: CommandContext = {
    root,
    flags,
    config,
    log,
    positionals: parsed.positionals,
  };

  let result: CommandResult;

  switch (command) {
    case 'generate':
    case 'gen':
    case 'g':
      result = await runGenerate(ctx);
      break;

    case 'deps': {
      const sub = parsed.positionals[0] ?? 'list';
      if (sub === 'list') {
        result = await runDepsList(ctx);
      } else if (sub === 'impact') {
        result = await runDepsImpact(ctx);
      } else {
        log.error(`Unknown deps subcommand: ${fmt.bold(sub)}`);
        result = { exitCode: ExitCode.USAGE };
      }
      break;
    }

    case 'watch':
      result = await runWatch(ctx);
      break;

    case 'show-config':
      result = await runShowConfig(ctx);
      break;

    case 'set-update-rate': {
      const value = parsed.positionals[0] ?? '';
      result = await runSetUpdateRate(ctx, value);
      break;
    }

    case 'add-exclude': {
      const value = parsed.positionals[0] ?? '';
      result = await runAddExclude(ctx, value);
      break;
    }

    case 'remove-exclude': {
      const value = parsed.positionals[0] ?? '';
      result = await runRemoveExclude(ctx, value);
      break;
    }

    default:
      log.error(`Unknown command: ${fmt.bold(command)}`);
      log.info(`Run ${fmt.bold('aspectcode --help')} for usage.`);
      result = { exitCode: ExitCode.USAGE };
  }

  process.exitCode = result.exitCode;
}

/** Entry point — called from bin/aspectcode.js. */
export function run(): void {
  main().catch((err: Error) => {
    console.error(err.message);
    process.exitCode = ExitCode.ERROR;
  });
}
