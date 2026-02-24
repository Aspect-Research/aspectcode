/**
 * `aspectcode generate` — discover, analyze, and emit artifacts.
 *
 * Pipeline: discoverFiles → readAll → analyzeRepoWithDependencies → runEmitters → report
 */

import * as path from 'path';
import * as readline from 'readline';
import {
  analyzeRepoWithDependencies,
} from '@aspectcode/core';
import {
  createNodeEmitterHost,
  runEmitters,
  detectAiTools,
  resolveFormatTargets,
} from '@aspectcode/emitters';
import type { EmitOptions } from '@aspectcode/emitters';
import type { CommandContext, CommandResult } from '../cli';
import { ExitCode } from '../cli';
import { fmt, createSpinner } from '../logger';
import { loadWorkspaceFiles } from '../workspace';
import { collectConnections, filterConnectionsByFile } from '../connections';
import { loadRawConfig, saveRawConfig } from '../config';

export async function runGenerate(ctx: CommandContext): Promise<CommandResult> {
  const { root, flags, config, log } = ctx;
  const startMs = Date.now();

  // ── 1. Resolve options ────────────────────────────────────
  const resolvedOut = flags.out ? path.resolve(root, flags.out) : root;
  if (!flags.json) {
    log.info(`Workspace: ${fmt.cyan(root)}`);
    if (flags.out) log.info(`Output:    ${fmt.cyan(resolvedOut)}`);
    log.blank();
  }

  // ── 2. Discover & read files ───────────────────────────────
  const workspace = await loadWorkspaceFiles(root, config, log, { quiet: flags.quiet });

  if (workspace.discoveredPaths.length === 0) {
    log.warn('Check your exclude patterns.');
    return { exitCode: ExitCode.ERROR };
  }

  const { relativeFiles: fileContents, absoluteFiles: absoluteFileContents } = workspace;

  // ── 3. Analyze ────────────────────────────────────────────
  const spinAnalyze = createSpinner('Analyzing…', { quiet: flags.quiet });
  const model = await analyzeRepoWithDependencies(
    root,
    fileContents,
    absoluteFileContents,
    workspace.host,
  );
  spinAnalyze.stop(
    `Analyzed ${model.files.length} files, ${model.graph.edges.length} edges`,
  );

  // ── 4. Resolve instruction target ─────────────────────────
  const host = createNodeEmitterHost();

  const instructionsMode = flags.kbOnly
    ? 'off'
    : (flags.instructionsMode ?? 'safe');

  // KB generation: explicit --kb flag, --kb-only, or config setting
  const generateKb = flags.kb || flags.kbOnly || config?.generateKb || false;

  // ── 4b. Resolve output formats ────────────────────────────
  let outputFormats = resolveOutputFormats(flags.outputFormats, config?.outputFormats);

  // Auto-detect AI tools if requested and running interactively
  if (flags.detectTools && !flags.json && process.stdout.isTTY) {
    const detected = await detectAiTools(host, root);
    const knownFormats = new Set(outputFormats);
    const newTools = [...detected].filter((id) => !knownFormats.has(id) && id !== 'codex');

    if (newTools.length > 0) {
      const confirmed = await promptForNewFormats(newTools);
      if (confirmed.length > 0) {
        outputFormats = [...new Set([...outputFormats, ...confirmed])];
        // Persist to aspectcode.json
        await persistOutputFormats(root, outputFormats);
      }
    }
  }

  const formatTargets = resolveFormatTargets(outputFormats);

  if (!flags.kbOnly && !flags.json) {
    const targetNames = formatTargets.map((t) => t.filePath).join(', ');
    log.info(`Instructions: ${fmt.cyan(targetNames)} (mode: ${instructionsMode})`);
  }

  // ── 5. Emit artifacts ─────────────────────────────────────
  const spinEmit = createSpinner('Writing artifacts…', { quiet: flags.quiet });

  const emitOpts: EmitOptions = {
    workspaceRoot: root,
    outDir: resolvedOut,
    instructionsMode,
    generateKb,
    fileContents,
    outputFormats,
  };

  const report = await runEmitters(model, host, emitOpts);
  spinEmit.stop(`Wrote ${report.wrote.length} files`);

  let connections: Awaited<ReturnType<typeof collectConnections>> | undefined;
  if (flags.listConnections || flags.json) {
    const spinDeps = createSpinner('Computing dependencies…', { quiet: flags.quiet });
    const allConnections = await collectConnections(root, config, log);
    const filtered = filterConnectionsByFile(allConnections, root, flags.file);

    if (filtered.error) {
      spinDeps.fail('Dependency error');
      log.error(filtered.error);
      return { exitCode: ExitCode.USAGE };
    }

    connections = filtered.connections;
    spinDeps.stop(`Found ${connections.length} connections`);

    if (filtered.fileFilter && !flags.json) {
      log.info(`Filtered by: ${fmt.cyan(filtered.fileFilter)}`);
    }
  }

  // ── 6. Report ─────────────────────────────────────────────
  const elapsedMs = Date.now() - startMs;

  if (flags.json) {
    const payload = {
      schemaVersion: report.schemaVersion,
      wrote: report.wrote.map((w) => ({
        path: path.relative(root, w.path).replace(/\\/g, '/'),
        bytes: w.bytes,
      })),
      skipped: report.skipped,
      stats: report.stats,
      connections,
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    log.blank();
    for (const w of report.wrote) {
      const rel = path.relative(root, w.path).replace(/\\/g, '/');
      log.success(`${rel} (${formatBytes(w.bytes)})`);
    }
  }

  if (report.skipped) {
    for (const s of report.skipped) {
      log.debug(`  skipped: ${s.id} — ${s.reason}`);
    }
  }

  if (flags.listConnections && !flags.json) {
    log.blank();
    log.info(fmt.bold('Dependency connections:'));
    for (const row of connections ?? []) {
      const symbols = row.symbols.length > 0 ? ` [${row.symbols.join(', ')}]` : '';
      const lineInfo = row.lines.length > 0 ? ` @${row.lines.join(',')}` : '';
      const bidi = row.bidirectional ? ' <->' : '';
      log.info(
        `${fmt.cyan(row.source)} -> ${fmt.cyan(row.target)} ` +
          `(${row.type})${bidi}${symbols}${lineInfo}`,
      );
    }
  }

  if (!flags.json) {
    log.blank();
    log.info(
      fmt.dim(`Done in ${(elapsedMs / 1000).toFixed(1)}s — `) +
        `${report.wrote.length} files written`,
    );
  }

  return { exitCode: ExitCode.OK, report };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

// ── Output format helpers ────────────────────────────────────

/**
 * Resolve output format IDs from CLI flag (comma-separated string) and config.
 * CLI flag takes precedence over config.
 */
function resolveOutputFormats(
  flagValue: string | undefined,
  configValue: string[] | undefined,
): string[] {
  if (flagValue) {
    return flagValue.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return configValue ?? [];
}

/**
 * Prompt the user to confirm enabling output for newly-detected AI tools.
 * Returns the list of confirmed format IDs.
 */
async function promptForNewFormats(toolIds: string[]): Promise<string[]> {
  const { getFormatTarget } = await import('@aspectcode/emitters');
  const confirmed: string[] = [];

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, resolve));

  try {
    for (const id of toolIds) {
      const target = getFormatTarget(id);
      if (!target) continue;
      const answer = await ask(
        `  ${fmt.cyan(target.displayName)} detected. Write ${fmt.bold(target.filePath)}? (Y/n) `,
      );
      if (!answer || answer.toLowerCase().startsWith('y')) {
        confirmed.push(id);
      }
    }
  } finally {
    rl.close();
  }

  return confirmed;
}

/**
 * Persist confirmed output formats to aspectcode.json.
 */
async function persistOutputFormats(root: string, formats: string[]): Promise<void> {
  try {
    const raw = loadRawConfig(root) ?? {};
    raw.outputFormats = formats;
    saveRawConfig(root, raw);
  } catch {
    // Non-critical — formats still work for this run even if save fails.
  }
}
