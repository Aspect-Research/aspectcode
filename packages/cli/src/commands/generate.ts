/**
 * `aspectcode generate` — discover, analyze, and emit artifacts.
 *
 * Pipeline: discoverFiles → readAll → analyzeRepo → runEmitters → report
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  discoverFiles,
  analyzeRepo,
} from '@aspectcode/core';
import {
  createNodeEmitterHost,
  runEmitters,
} from '@aspectcode/emitters';
import type { EmitOptions, AssistantFlags } from '@aspectcode/emitters';
import type { CliFlags, CommandResult } from '../cli';
import { ExitCode } from '../cli';
import type { AspectCodeConfig } from '../config';
import type { Logger } from '../logger';
import { fmt } from '../logger';
import { collectConnections, filterConnectionsByFile } from './deps';

export async function runGenerate(
  root: string,
  flags: CliFlags,
  config: AspectCodeConfig | undefined,
  log: Logger,
): Promise<CommandResult> {
  const startMs = Date.now();

  // ── 1. Resolve options ────────────────────────────────────
  const outDir = flags.out ?? config?.outDir ?? undefined;
  const resolvedOut = outDir ? path.resolve(root, outDir) : root;
  const exclude = config?.exclude;

  log.info(`Workspace: ${fmt.cyan(root)}`);
  if (outDir) log.info(`Output:    ${fmt.cyan(resolvedOut)}`);
  log.blank();

  // ── 2. Discover files ─────────────────────────────────────
  log.debug('Discovering files…');
  const discoveredPaths = await discoverFiles(root, exclude ? { exclude } : undefined);

  if (discoveredPaths.length === 0) {
    log.warn('No source files found. Check your exclude patterns.');
    return { exitCode: ExitCode.ERROR };
  }
  log.info(`Found ${fmt.bold(String(discoveredPaths.length))} source files`);

  // ── 3. Read file contents ─────────────────────────────────
  log.debug('Reading file contents…');
  const fileContents = new Map<string, string>();
    // const absFileContents = new Map<string, string>();
  for (const abs of discoveredPaths) {
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    try {
      const content = fs.readFileSync(abs, 'utf-8');
      fileContents.set(rel, content);
        // absFileContents.set(abs, content);
    } catch {
      log.debug(`  skip (unreadable): ${rel}`);
    }
  }

  // ── 4. Analyze ────────────────────────────────────────────
  log.debug('Analyzing repository…');
    const model = analyzeRepo(root, fileContents);
  log.info(
    `Analyzed: ${fmt.bold(String(model.files.length))} files, ` +
    `${fmt.bold(String(model.graph.edges.length))} edges`,
  );

  // ── 5. Resolve instruction target (AGENTS.md only) ───────
  const host = createNodeEmitterHost();
  const assistants: AssistantFlags = { other: true };
  const instructionsMode = 'safe';
  log.info(`Instructions target: ${fmt.cyan('AGENTS.md')}`);

  // ── 6. Emit artifacts ─────────────────────────────────────
  log.blank();
  log.debug('Emitting artifacts…');

  const emitOpts: EmitOptions = {
    workspaceRoot: root,
    outDir: resolvedOut,
    assistants,
    instructionsMode,
    fileContents,
  };

  const report = await runEmitters(model, host, emitOpts);

  let connections: Awaited<ReturnType<typeof collectConnections>> | undefined;
  if (flags.listConnections || flags.json) {
    const allConnections = await collectConnections(root, config, log);
    const filtered = filterConnectionsByFile(allConnections, root, flags.file);

    if (filtered.error) {
      log.error(filtered.error);
      return { exitCode: ExitCode.USAGE };
    }

    if (filtered.fileFilter && !flags.json) {
      log.info(`Filtering dependency connections by file: ${fmt.cyan(filtered.fileFilter)}`);
    }

    connections = filtered.connections;
  }

  // ── 7. Report ─────────────────────────────────────────────
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
          `(${row.type}, ${row.strength.toFixed(2)})${bidi}${symbols}${lineInfo}`,
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
