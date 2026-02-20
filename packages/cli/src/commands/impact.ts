/**
 * `aspectcode impact` — compute a lightweight impact summary for a single file.
 *
 * Discovers workspace files, resolves dependencies, and computes how many
 * other files depend on the target file.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  discoverFiles,
  DependencyAnalyzer,
  createNodeHostForWorkspace,
} from '@aspectcode/core';
import { classifyFile } from '@aspectcode/emitters';
import type { CliFlags, CommandResult } from '../cli';
import { ExitCode } from '../cli';
import type { AspectCodeConfig } from '../config';
import type { Logger } from '../logger';
import { fmt, createSpinner } from '../logger';

// ── Types ────────────────────────────────────────────────────

interface ImpactSummary {
  file: string;
  dependents_count: number;
  top_dependents: Array<{ file: string; dependent_count: number }>;
  generated_at: string;
}

// ── Command handler ──────────────────────────────────────────

export async function runImpact(
  root: string,
  flags: CliFlags,
  config: AspectCodeConfig | undefined,
  log: Logger,
): Promise<CommandResult> {
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

  const exclude = config?.exclude;

  // Discover files.
  const spin = createSpinner('Discovering files…', { quiet: flags.quiet });
  const discoveredPaths = await discoverFiles(root, exclude ? { exclude } : undefined);
  if (discoveredPaths.length === 0) {
    spin.fail('No source files found');
    return { exitCode: ExitCode.ERROR };
  }
  spin.stop(`Discovered ${discoveredPaths.length} files`);

  // Read file contents into cache for the analyzer.
  const spinRead = createSpinner(`Reading ${discoveredPaths.length} files…`, { quiet: flags.quiet });
  const fileContents = new Map<string, string>();
  for (const abs of discoveredPaths) {
    try {
      fileContents.set(abs, fs.readFileSync(abs, 'utf-8'));
    } catch {
      // skip unreadable
    }
  }
  spinRead.stop(`Read ${fileContents.size} files`);

  // Analyze dependencies.
  const spinAnalyze = createSpinner('Analyzing dependencies…', { quiet: flags.quiet });
  const analyzer = new DependencyAnalyzer();
  analyzer.setFileContentsCache(fileContents);
  const host = createNodeHostForWorkspace(root);
  const links = await analyzer.analyzeDependencies(discoveredPaths, host);
  spinAnalyze.stop(`Found ${links.length} dependency links`);

  // Compute degree stats.
  const stats = new Map<string, { inDegree: number; outDegree: number }>();
  for (const file of discoveredPaths) {
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

// ── Helpers ──────────────────────────────────────────────────

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
