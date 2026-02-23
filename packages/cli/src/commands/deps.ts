/**
 * `aspectcode deps` — dependency analysis commands.
 *
 * Subcommands:
 *   deps list    — list raw dependency connections
 *   deps impact  — compute impact summary for a single file
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DependencyAnalyzer,
  classifyFile,
} from '@aspectcode/core';
import type { CliFlags, CommandContext, CommandResult } from '../cli';
import { ExitCode } from '../cli';
import type { Logger } from '../logger';
import { fmt } from '../logger';
import {
  collectConnections,
  filterConnectionsByFile,
} from '../connections';
import { loadWorkspaceFiles } from '../workspace';

// ── deps list ────────────────────────────────────────────────

export async function runDepsList(ctx: CommandContext): Promise<CommandResult> {
  const { root, flags, config, log } = ctx;
  const allConnections = await collectConnections(root, config, log);
  const filtered = filterConnectionsByFile(allConnections, root, flags.file);
  const connections = filtered.connections;

  if (filtered.error) {
    log.error(filtered.error);
    return { exitCode: ExitCode.USAGE };
  }

  if (filtered.fileFilter && connections.length === 0) {
    log.info(`No dependency connections found for ${fmt.cyan(filtered.fileFilter)}.`);
    return { exitCode: ExitCode.OK };
  }

  if (filtered.fileFilter) {
    log.info(`Filtering by file: ${fmt.cyan(filtered.fileFilter)}`);
  }

  if (connections.length === 0) {
    log.info('No dependency connections found.');
    return { exitCode: ExitCode.OK };
  }

  log.info(fmt.bold('Dependency connections:'));
  for (const row of connections) {
    const symbols = row.symbols.length > 0 ? ` [${row.symbols.join(', ')}]` : '';
    const lineInfo = row.lines.length > 0 ? ` @${row.lines.join(',')}` : '';
    const bidi = row.bidirectional ? ' <->' : '';
    log.info(
      `${fmt.cyan(row.source)} -> ${fmt.cyan(row.target)} ` +
        `(${row.type})${bidi}${symbols}${lineInfo}`,
    );
  }

  log.blank();
  log.info(`${connections.length} connections listed`);
  return { exitCode: ExitCode.OK };
}

// ── deps impact ──────────────────────────────────────────────

interface ImpactSummary {
  file: string;
  dependents_count: number;
  top_dependents: Array<{ file: string; dependent_count: number }>;
  generated_at: string;
}

export async function runDepsImpact(ctx: CommandContext): Promise<CommandResult> {
  const { root, flags, config, log } = ctx;
  const targetFile = flags.file;
  if (!targetFile) {
    log.error(`${fmt.bold('--file')} is required for the impact command.`);
    return { exitCode: ExitCode.USAGE };
  }

  const absoluteTarget = path.resolve(root, targetFile);

  // Verify the target file exists.
  if (!fs.existsSync(absoluteTarget)) {
    log.error(`File not found: ${fmt.cyan(absoluteTarget)}`);
    return { exitCode: ExitCode.ERROR };
  }

  // Discover and read files using shared helper.
  const workspace = await loadWorkspaceFiles(root, config, log, { quiet: flags.quiet });
  if (workspace.discoveredPaths.length === 0) {
    return { exitCode: ExitCode.ERROR };
  }

  // Analyze dependencies.
  const analyzer = new DependencyAnalyzer();
  analyzer.setFileContentsCache(workspace.absoluteFiles);
  const links = await analyzer.analyzeDependencies(workspace.discoveredPaths, workspace.host);

  // Compute degree stats.
  const stats = new Map<string, { inDegree: number; outDegree: number }>();
  for (const file of workspace.discoveredPaths) {
    stats.set(file, { inDegree: 0, outDegree: 0 });
  }
  for (const link of links) {
    const src = stats.get(link.source);
    const tgt = stats.get(link.target);
    if (src) src.outDegree++;
    if (tgt) tgt.inDegree++;
  }

  // Compute impact summary.
  const normalizedTarget = path.resolve(absoluteTarget);
  const targetClass = classifyFile(normalizedTarget, root);

  if (targetClass === 'third_party') {
    const summary: ImpactSummary = {
      file: rel(normalizedTarget, root),
      dependents_count: 0,
      top_dependents: [],
      generated_at: new Date().toISOString(),
    };
    return outputSummary(summary, flags, log);
  }

  const dependentAbs = dedupe(
    links
      .filter((l) => l.target && path.resolve(l.target) === normalizedTarget)
      .map((l) => l.source)
      .filter(Boolean)
      .filter((s) => s !== normalizedTarget)
      .filter((s) => classifyFile(s, root) !== 'third_party'),
  );

  const appOrTestDependents = dependentAbs.filter((s) => {
    const c = classifyFile(s, root);
    return c === 'app' || c === 'test';
  });
  const dependentsToUse = appOrTestDependents.length > 0 ? appOrTestDependents : dependentAbs;

  const dependentsWithCounts = dependentsToUse
    .map((dep) => ({
      abs: dep,
      dependent_count: stats.get(dep)?.inDegree ?? 0,
    }))
    .sort((a, b) => b.dependent_count - a.dependent_count || a.abs.localeCompare(b.abs));

  const dependentsCount = dependentsWithCounts.length;

  const topDependents = dependentsWithCounts.slice(0, 5).map((d) => ({
    file: rel(d.abs, root),
    dependent_count: d.dependent_count,
  }));

  const summary: ImpactSummary = {
    file: rel(normalizedTarget, root),
    dependents_count: dependentsCount,
    top_dependents: topDependents,
    generated_at: new Date().toISOString(),
  };

  return outputSummary(summary, flags, log);
}

// ── Shared helpers ───────────────────────────────────────────

function outputSummary(
  summary: ImpactSummary,
  flags: CliFlags,
  log: Logger,
): CommandResult {
  if (flags.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    log.info(`File: ${fmt.cyan(summary.file)}`);
    log.info(`Dependents: ${fmt.bold(String(summary.dependents_count))}`);
    if (summary.top_dependents.length > 0) {
      log.info('Top dependents:');
      for (const dep of summary.top_dependents) {
        log.info(`  - ${dep.file} (${dep.dependent_count} dependents)`);
      }
    }
  }
  return { exitCode: ExitCode.OK };
}

function rel(absPath: string, workspaceRoot: string): string {
  const normalized = absPath.replace(/\\/g, '/');
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');
  if (normalized.startsWith(normalizedRoot)) {
    return normalized.substring(normalizedRoot.length).replace(/^\//, '');
  }
  return path.basename(absPath);
}

function dedupe<T>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = String(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
