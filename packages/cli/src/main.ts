/**
 * aspectcode CLI — main entry point.
 *
 * Subcommands: login, logout, whoami.
 * Default (no subcommand): `aspectcode [flags]` runs the pipeline:
 *   analyze → build KB → ingest tool files → optimize → write AGENTS.md → watch
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import type { CliFlags } from './cli';
import { ExitCode, FLAG_DEFS, flagPropName } from './cli';
import type { SpinnerFactory } from './cli';
import { createLogger, createSpinner, disableColor, fmt } from './logger';
import { getVersion } from './version';
import { runPipeline, resolveRunMode } from './pipeline';
import { createDashboardLogger, createDashboardSpinner } from './ui/inkLogger';
import { store } from './ui/store';
import type { PipelinePhase } from './ui/store';
import { loginCommand, logoutCommand, whoamiCommand, upgradeCommand, usageCommand, loadCredentials } from './auth';

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
    dryRun: false,
    once: false,
    noColor: false,
    compact: false,
    background: false,
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
  aspectcode <command>

  Analyzes your codebase, builds a knowledge base, reads existing AI tool
  instruction files for context, generates AGENTS.md via LLM (when API key
  is available), and watches for changes.

${fmt.bold('COMMANDS')}
  login                           ${fmt.dim('# Authenticate via browser (Google OAuth)')}
  logout                          ${fmt.dim('# Clear stored credentials')}
  whoami                          ${fmt.dim('# Show current logged-in user')}
  upgrade                         ${fmt.dim('# Open Pro upgrade page in browser')}
  usage                           ${fmt.dim('# Show current tier and token usage')}

${fmt.bold('OPTIONS')}
${optionLines.join('\n')}

${fmt.bold('EXAMPLES')}
  aspectcode                      ${fmt.dim('# watch & auto-update AGENTS.md')}
  aspectcode login                ${fmt.dim('# authenticate with your account')}
  aspectcode --once               ${fmt.dim('# run once then exit')}
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

// ── Background: spawn in a new terminal ──────────────────────

/** Spawn aspectcode in a new terminal window. Returns true if successful. */
function spawnInTerminal(): boolean {
  const binPath = path.resolve(__dirname, '..', 'bin', 'aspectcode.js');
  const forwardedArgs = process.argv.slice(2).filter((a) => a !== '--background');
  const nodeExe = process.execPath;

  try {
    let child;

    if (process.platform === 'win32') {
      // Write a temp .bat file to avoid quoting hell with spaces in paths.
      // cmd /k + start can't reliably handle "C:\Program Files\..." nesting.
      const batPath = path.join(os.tmpdir(), `aspectcode-bg-${Date.now()}.bat`);
      const argsStr = forwardedArgs.length > 0 ? ' ' + forwardedArgs.join(' ') : '';
      fs.writeFileSync(batPath, `@echo off\r\n"${nodeExe}" "${binPath}"${argsStr}\r\n`);

      child = spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', batPath], {
        detached: true,
        stdio: 'ignore',
      });

      // Clean up bat file after a delay (the new terminal has already read it)
      setTimeout(() => { try { fs.unlinkSync(batPath); } catch { /* ignore */ } }, 5000);

    } else if (process.platform === 'darwin') {
      const escaped = [nodeExe, binPath, ...forwardedArgs]
        .map((a) => a.replace(/\\/g, '\\\\').replace(/"/g, '\\"'))
        .join(' ');
      child = spawn('osascript', ['-e', `tell app "Terminal" to do script "${escaped}"`], {
        detached: true,
        stdio: 'ignore',
      });

    } else {
      // Linux: try gnome-terminal, fall back to xterm
      try {
        child = spawn('gnome-terminal', ['--', nodeExe, binPath, ...forwardedArgs], {
          detached: true,
          stdio: 'ignore',
        });
      } catch {
        child = spawn('xterm', ['-e', nodeExe, binPath, ...forwardedArgs], {
          detached: true,
          stdio: 'ignore',
        });
      }
    }

    child.unref();
    console.log('◆ aspect code running in background');
    process.exitCode = ExitCode.OK;
    return true;
  } catch {
    console.log('◆ could not open terminal window — running headless');
    return false;
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Handle subcommands
  const firstArg = process.argv[2];
  if (firstArg === 'logout') { await logoutCommand(); return; }
  if (firstArg === 'whoami') { await whoamiCommand(); return; }
  if (firstArg === 'upgrade') { await upgradeCommand(); return; }
  if (firstArg === 'usage') { await usageCommand(); return; }

  // Login then continue to pipeline
  if (firstArg === 'login') {
    await loginCommand(process.argv.slice(3));
    if (process.exitCode) return; // login failed
    // Strip 'login' (and optional code arg) from argv before parsing flags
    process.argv = [process.argv[0], process.argv[1]];
  }

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

  // Background mode: spawn in a new terminal window and exit immediately
  if (flags.background) {
    if (spawnInTerminal()) return;
    // Spawn failed — fall through to run headless in this process
    flags.background = false;
  }

  // Require login for the pipeline
  if (!loadCredentials()) {
    console.log(`${fmt.bold('Login required.')} Press any key to open browser login...`);
    await new Promise<void>((resolve) => {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.once('data', () => {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        resolve();
      });
    });
    await loginCommand([]);
    if (!loadCredentials()) {
      process.exitCode = ExitCode.ERROR;
      return;
    }
  }

  // Check for updates (non-blocking — runs sync but fast, 5s timeout)
  try {
    const { checkForUpdate } = await import('./updateChecker');
    const updateResult = checkForUpdate();
    if (updateResult) {
      if (updateResult.updated) {
        // Re-exec with the new version
        console.log(`✓ ${updateResult.message} — restarting...`);
        const { execSync } = await import('child_process');
        execSync(`aspectcode ${process.argv.slice(2).join(' ')}`, { stdio: 'inherit' });
        return;
      }
      // Store message for dashboard display
      (globalThis as any).__updateMessage = updateResult.message;
    }
  } catch { /* update check is best-effort */ }

  if (flags.noColor) {
    disableColor();
  }

  // Parse numeric string flags
  if (typeof flags.temperature === 'string') {
    flags.temperature = parseFloatFlag(flags.temperature, 0, 2);
  }

  const root = path.resolve(flags.root ?? process.cwd());

  // Resolve ownership + platforms BEFORE mounting the ink dashboard.
  // selectPrompt / multiSelectPrompt use raw stdin which conflicts with ink's useInput.
  const { ownership, generate } = await resolveRunMode(root);
  const { resolvePlatforms } = await import('./pipeline');
  const activePlatforms = await resolvePlatforms(root);

  const useDashboard = !flags.quiet && !flags.noColor && !flags.background && process.stdout.isTTY === true;

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
    process.exitCode = await runPipeline({ root, flags, log, spin, ownership, generate, platforms: activePlatforms });
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
