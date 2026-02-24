/**
 * CLI process adapter — runs aspectcode as a subprocess.
 *
 * The extension delegates heavy lifting to the CLI so that all analysis,
 * detection, and artifact generation logic lives in shared packages. This
 * module provides the VS Code integration layer for spawning, cancelling,
 * and collecting output from CLI invocations.
 *
 * Resolution strategy (hybrid):
 *   1. Bundled: `<extensionPath>/cli-bundle/bin/aspectcode.js`
 *   2. Workspace-local: `<repoRoot>/packages/cli/bin/aspectcode.js`
 *   3. npm link / global: `aspectcode` on PATH
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';

/** Set by the extension activation to provide the extension install path. */
let extensionPath: string | undefined;

/** Called once during activation to set the extension path for CLI resolution. */
export function setExtensionPath(extPath: string): void {
  extensionPath = extPath;
}

// ============================================================================
// Types
// ============================================================================

/** Result of a CLI invocation. */
export interface CliResult<T = unknown> {
  /** Process exit code. */
  exitCode: number;
  /** Parsed JSON payload (only when `--json` was requested and stdout is valid JSON). */
  data?: T;
  /** Raw stdout text. */
  stdout: string;
  /** Raw stderr text. */
  stderr: string;
}

/** JSON payload emitted by `aspectcode generate --json`. */
export interface GenerateJsonPayload {
  schemaVersion: number;
  wrote: Array<{ path: string; bytes: number }>;
  skipped?: Array<{ id: string; reason: string }>;
  stats?: Record<string, unknown>;
  connections?: Array<{
    source: string;
    target: string;
    type: string;
    bidirectional: boolean;
    symbols: string[];
    lines: number[];
  }>;
}

/** Options for a single CLI invocation. */
export interface CliRunOptions {
  /** Workspace root (passed as `--root`). */
  root: string;
  /** CLI arguments (e.g. `['generate', '--json']`). */
  args: string[];
  /** Optional cancellation token. */
  token?: vscode.CancellationToken;
  /** Optional output channel for logging. */
  outputChannel?: vscode.OutputChannel;
  /** Timeout in ms (0 = no timeout). Default: 120_000 (2 min). */
  timeoutMs?: number;
}

// ============================================================================
// CLI Resolution
// ============================================================================

/**
 * Resolve the CLI entry script. Prefers the bundled copy inside the extension,
 * then workspace-local, then PATH.
 */
function resolveCliBin(workspaceRoot: string): { node: string; script: string } | { bin: string } {
  // 1. Bundled inside extension VSIX
  if (extensionPath) {
    const bundledScript = path.join(extensionPath, 'cli-bundle', 'bin', 'aspectcode.js');
    try {
      require('fs').accessSync(bundledScript);
      return { node: process.execPath, script: bundledScript };
    } catch {
      // Not found — fall through.
    }
  }

  // 2. Workspace-local (monorepo layout)
  const localScript = path.join(workspaceRoot, 'packages', 'cli', 'bin', 'aspectcode.js');
  try {
    require('fs').accessSync(localScript);
    return { node: process.execPath, script: localScript };
  } catch {
    // Not found — fall through.
  }

  // 3. Try resolving from node_modules (npm link / workspace hoisting)
  try {
    const resolved = require.resolve('aspectcode/bin/aspectcode.js');
    return { node: process.execPath, script: resolved };
  } catch {
    // Not installed.
  }

  // 4. Global / PATH fallback
  return { bin: 'aspectcode' };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run a CLI command and return the result.
 *
 * Example:
 * ```ts
 * const result = await runCli<GenerateJsonPayload>({
 *   root: workspaceRoot,
 *   args: ['generate', '--json'],
 * });
 * if (result.exitCode === 0 && result.data) {
 *   console.log(result.data.wrote.length, 'files written');
 * }
 * ```
 */
export function runCli<T = unknown>(opts: CliRunOptions): Promise<CliResult<T>> {
  const { root, args, token, outputChannel, timeoutMs = 120_000 } = opts;

  return new Promise<CliResult<T>>((resolve) => {
    const resolved = resolveCliBin(root);

    let command: string;
    let spawnArgs: string[];

    if ('script' in resolved) {
      command = resolved.node;
      spawnArgs = [resolved.script, '--root', root, ...args];
    } else {
      command = resolved.bin;
      spawnArgs = ['--root', root, ...args];
    }

    outputChannel?.appendLine(`[CLI] Spawning: ${command} ${spawnArgs.join(' ')}`);

    let child: ChildProcess;
    try {
      child = spawn(command, spawnArgs, {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        // On Windows, use shell to resolve PATH-based commands.
        shell: !('script' in resolved),
        // Prevent inheriting the extension host's NODE_OPTIONS.
        env: { ...process.env, NODE_OPTIONS: '' },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outputChannel?.appendLine(`[CLI] Failed to spawn: ${msg}`);
      resolve({ exitCode: 1, stdout: '', stderr: msg });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (exitCode: number) => {
      if (settled) return;
      settled = true;

      // Try to parse JSON from stdout.
      let data: T | undefined;
      const trimmed = stdout.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          data = JSON.parse(trimmed) as T;
        } catch {
          // Not valid JSON — leave data undefined.
        }
      }

      outputChannel?.appendLine(
        `[CLI] Exited with code ${exitCode} (stdout=${stdout.length}B, stderr=${stderr.length}B)`,
      );
      resolve({ exitCode, data, stdout, stderr });
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      // Stream stderr to output channel for real-time visibility.
      if (outputChannel) {
        for (const line of text.split('\n').filter(Boolean)) {
          outputChannel.appendLine(`[CLI:err] ${line}`);
        }
      }
    });

    child.on('error', (err) => {
      outputChannel?.appendLine(`[CLI] Process error: ${err.message}`);
      settle(1);
    });

    child.on('close', (code) => {
      settle(code ?? 1);
    });

    // Cancellation via VS Code token.
    if (token) {
      const disposable = token.onCancellationRequested(() => {
        if (!settled) {
          outputChannel?.appendLine('[CLI] Cancellation requested — killing process');
          child.kill('SIGTERM');
          // Force-kill after grace period on Windows.
          setTimeout(() => {
            if (!settled) child.kill('SIGKILL');
          }, 3000);
        }
        disposable.dispose();
      });
    }

    // Timeout guard.
    if (timeoutMs > 0) {
      setTimeout(() => {
        if (!settled) {
          outputChannel?.appendLine(`[CLI] Timeout (${timeoutMs}ms) — killing process`);
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!settled) child.kill('SIGKILL');
          }, 3000);
        }
      }, timeoutMs);
    }
  });
}

// ============================================================================
// Convenience helpers
// ============================================================================

/**
 * Run `aspectcode generate --json` and return the parsed report.
 */
export async function cliGenerate(
  root: string,
  options?: {
    outputChannel?: vscode.OutputChannel;
    token?: vscode.CancellationToken;
    /** Additional CLI args (e.g. `['--kb-only']`). */
    extraArgs?: string[];
  },
): Promise<CliResult<GenerateJsonPayload>> {
  const { extraArgs = [], ...rest } = options ?? {};
  return runCli<GenerateJsonPayload>({
    root,
    args: ['generate', '--json', ...extraArgs],
    ...rest,
  });
}

/**
 * Run `aspectcode watch` as a long-running background process.
 * Returns the child process handle for lifecycle management.
 */
export function cliWatch(
  root: string,
  options?: {
    mode?: 'manual' | 'onChange' | 'idle';
    outputChannel?: vscode.OutputChannel;
  },
): ChildProcess {
  const resolved = resolveCliBin(root);
  const watchArgs = ['watch'];
  if (options?.mode) watchArgs.push('--mode', options.mode);

  let command: string;
  let spawnArgs: string[];

  if ('script' in resolved) {
    command = resolved.node;
    spawnArgs = [resolved.script, '--root', root, ...watchArgs];
  } else {
    command = resolved.bin;
    spawnArgs = ['--root', root, ...watchArgs];
  }

  options?.outputChannel?.appendLine(`[CLI] Spawning watch: ${command} ${spawnArgs.join(' ')}`);

  const child = spawn(command, spawnArgs, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: !('script' in resolved),
    env: { ...process.env, NODE_OPTIONS: '' },
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    for (const line of text.split('\n').filter(Boolean)) {
      options?.outputChannel?.appendLine(`[CLI:watch] ${line}`);
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    for (const line of text.split('\n').filter(Boolean)) {
      options?.outputChannel?.appendLine(`[CLI:watch:err] ${line}`);
    }
  });

  return child;
}

/** JSON payload emitted by `aspectcode optimize --json`. */
export interface OptimizeJsonPayload {
  iterations: number;
  reasoning: string[];
  path: string;
  elapsedMs: number;
  dryRun?: boolean;
  optimizedInstructions?: string;
}

/**
 * Run `aspectcode optimize --json` and return the parsed report.
 */
export async function cliOptimize(
  root: string,
  options?: {
    outputChannel?: vscode.OutputChannel;
    token?: vscode.CancellationToken;
    maxIterations?: number;
    dryRun?: boolean;
    provider?: string;
    model?: string;
    acceptThreshold?: number;
    temperature?: number;
  },
): Promise<CliResult<OptimizeJsonPayload>> {
  const args = ['optimize', '--json'];
  if (options?.maxIterations) args.push('--max-iterations', String(options.maxIterations));
  if (options?.dryRun) args.push('--dry-run');
  if (options?.provider) args.push('--provider', options.provider);
  if (options?.model) args.push('--model', options.model);
  if (options?.acceptThreshold) args.push('--accept-threshold', String(options.acceptThreshold));
  if (options?.temperature !== undefined) args.push('--temperature', String(options.temperature));

  return runCli<OptimizeJsonPayload>({
    root,
    args,
    outputChannel: options?.outputChannel,
    token: options?.token,
    // Optimize can be slow (multiple LLM calls) — 5 minute timeout
    timeoutMs: 300_000,
  });
}

// ============================================================================
// Init — interactive setup
// ============================================================================

/**
 * Open a VS Code terminal and run `aspectcode init` interactively.
 * Returns the created terminal so callers can listen for close events.
 */
export function cliInit(
  root: string,
  options?: { outputChannel?: vscode.OutputChannel },
): vscode.Terminal {
  const resolved = resolveCliBin(root);

  let shellCommand: string;
  if ('script' in resolved) {
    shellCommand = `node "${resolved.script}" --root "${root}" init`;
  } else {
    shellCommand = `aspectcode --root "${root}" init`;
  }

  options?.outputChannel?.appendLine(`[CLI] Opening terminal for init: ${shellCommand}`);

  const terminal = vscode.window.createTerminal({
    name: 'Aspect Code: Init',
    cwd: root,
    env: { NODE_OPTIONS: '' },
  });
  terminal.show();
  terminal.sendText(shellCommand);
  return terminal;
}

// ============================================================================
// Watch daemon — managed lifecycle
// ============================================================================

export interface WatchDaemonHandle {
  /** The underlying child process. */
  child: ChildProcess;
  /** Stop the watch daemon. */
  stop(): void;
  /** Whether the daemon is still running. */
  readonly running: boolean;
}

/**
 * Start `aspectcode watch` as a managed daemon.
 * Provides a clean handle for the extension to track lifecycle and stop on deactivation.
 */
export function cliWatchDaemon(
  root: string,
  options?: {
    mode?: 'manual' | 'onChange' | 'idle';
    outputChannel?: vscode.OutputChannel;
    onExit?: (code: number | null) => void;
  },
): WatchDaemonHandle {
  const child = cliWatch(root, {
    mode: options?.mode,
    outputChannel: options?.outputChannel,
  });

  let running = true;

  child.on('close', (code) => {
    running = false;
    options?.outputChannel?.appendLine(`[CLI:watch] Daemon exited with code ${code}`);
    options?.onExit?.(code);
  });

  child.on('error', (err) => {
    running = false;
    options?.outputChannel?.appendLine(`[CLI:watch] Daemon error: ${err.message}`);
    options?.onExit?.(1);
  });

  return {
    child,
    stop() {
      if (running) {
        options?.outputChannel?.appendLine('[CLI:watch] Stopping daemon');
        child.kill('SIGTERM');
        // Force-kill after 3s if still alive (Windows needs this).
        setTimeout(() => {
          if (running) child.kill('SIGKILL');
        }, 3000);
      }
    },
    get running() {
      return running;
    },
  };
}
