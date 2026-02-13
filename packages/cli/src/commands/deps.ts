import * as fs from 'fs';
import * as path from 'path';
import { DependencyAnalyzer, discoverFiles } from '@aspectcode/core';
import type { CliFlags, CommandResult } from '../cli';
import { ExitCode } from '../cli';
import type { AspectCodeConfig } from '../config';
import type { Logger } from '../logger';
import { fmt } from '../logger';

export interface DependencyConnection {
  source: string;
  target: string;
  type: string;
  strength: number;
  symbols: string[];
  lines: number[];
  bidirectional: boolean;
}

export interface FilteredConnectionsResult {
  connections: DependencyConnection[];
  fileFilter?: string;
  error?: string;
}

export async function runDepsList(
  root: string,
  flags: CliFlags,
  config: AspectCodeConfig | undefined,
  log: Logger,
): Promise<CommandResult> {
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
        `(${row.type}, ${row.strength.toFixed(2)})${bidi}${symbols}${lineInfo}`,
    );
  }

  log.blank();
  log.info(`${connections.length} connections listed`);
  return { exitCode: ExitCode.OK };
}

function normalizeWorkspacePath(candidate: string, root: string): string | undefined {
  const abs = path.resolve(root, candidate);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return undefined;
  }
  return rel.replace(/\\/g, '/');
}

export function filterConnectionsByFile(
  connections: DependencyConnection[],
  root: string,
  file?: string,
): FilteredConnectionsResult {
  if (!file) {
    return { connections };
  }

  const fileRel = normalizeWorkspacePath(file, root);
  if (!fileRel) {
    return {
      connections: [],
      error: `--file must point to a file inside the workspace: ${fmt.bold(file)}`,
    };
  }

  return {
    connections: connections.filter(
      (row) => row.source === fileRel || row.target === fileRel,
    ),
    fileFilter: fileRel,
  };
}

export async function collectConnections(
  root: string,
  config: AspectCodeConfig | undefined,
  log: Logger,
): Promise<DependencyConnection[]> {
  const discoveredPaths = await discoverFiles(root, config?.exclude ? { exclude: config.exclude } : undefined);
  if (discoveredPaths.length === 0) {
    return [];
  }

  const cache = new Map<string, string>();
  for (const abs of discoveredPaths) {
    try {
      cache.set(abs, fs.readFileSync(abs, 'utf-8'));
    } catch {
      log.debug(`  skip (unreadable): ${path.relative(root, abs).replace(/\\/g, '/')}`);
    }
  }

  const analyzer = new DependencyAnalyzer();
  analyzer.setFileContentsCache(cache);
  const edges = await analyzer.analyzeDependencies(discoveredPaths);

  return edges.map((edge) => ({
    source: path.relative(root, edge.source).replace(/\\/g, '/'),
    target: path.relative(root, edge.target).replace(/\\/g, '/'),
    type: edge.type,
    strength: edge.strength,
    symbols: edge.symbols,
    lines: edge.lines,
    bidirectional: edge.bidirectional,
  }));
}
