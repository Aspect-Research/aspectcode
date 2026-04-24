/**
 * Pure-logic dependency analyzer — no vscode coupling.
 *
 * Uses CoreHost for file I/O and pre-built indexes for fast module
 * resolution. The analyzer produces GraphEdge[] and handles cycle
 * detection and bidirectional link merging.
 */

import type { CoreHost } from '../host';
import type { GraphEdge } from '../model';
import {
  calculateImportStrength,
} from './importParsers';
import {
  analyzeDependenciesForFile,
  setDependencyAdapterGrammars,
  type DependencyWarningLogger,
} from './dependencyAdapters';
import { loadGrammars } from '../parsers';
import {
  buildFileIndex,
  resolveModulePathFast,
  resolveCallTargetFast,
} from './moduleResolver';
import type { FileIndex } from './moduleResolver';

// ── Types ────────────────────────────────────────────────────

/** Progress callback for dependency analysis */
export type DependencyProgressCallback = (
  current: number,
  total: number,
  phase: string,
) => void;

export type DependencyWarningCallback = (
  kind: 'grammar-missing' | 'tree-sitter-extract-failed',
  language: string,
  filePath: string,
  message: string,
) => void;

// ── Public API ───────────────────────────────────────────────

export class DependencyAnalyzer {
  private workspaceFiles: Map<string, string> = new Map();
  private fileIndex: FileIndex | null = null;

  /**
   * Set pre-loaded file contents to avoid redundant file reads.
   * Call this before analyzeDependencies if you already have the content.
   */
  setFileContentsCache(cache: Map<string, string>): void {
    this.workspaceFiles = cache;
  }

  /**
   * Analyze all real dependencies between workspace files.
   *
   * @param files      List of file paths to analyze
   * @param host       CoreHost for file I/O (only used when cache is empty)
   * @param onProgress Optional progress callback
   */
  async analyzeDependencies(
    files: string[],
    host?: CoreHost,
    onProgress?: DependencyProgressCallback,
    onWarning?: DependencyWarningCallback,
  ): Promise<GraphEdge[]> {
    const links: GraphEdge[] = [];
    const linkIndex = new Map<string, GraphEdge>();
    const seenWarnings = new Set<string>();

    const warn: DependencyWarningLogger = (kind, language, filePath, message) => {
      const key = `${kind}|${language}|${filePath}|${message}`;
      if (seenWarnings.has(key)) return;
      seenWarnings.add(key);
      onWarning?.(kind, language, filePath, message);
    };

    // Load file contents if not already cached
    if (this.workspaceFiles.size === 0 && host) {
      onProgress?.(0, files.length, 'Loading file contents...');
      await this.loadFileContents(files, host, onProgress);
    }

    // Build indexes for fast resolution (O(N) once)
    onProgress?.(0, files.length, 'Building file index...');
    this.fileIndex = buildFileIndex(files);

    // Initialize tree-sitter grammars when available through host.
    if (host?.wasmPaths?.treeSitter && Object.keys(host.wasmPaths.grammars ?? {}).length > 0) {
      try {
        const loaded = await loadGrammars(host);
        setDependencyAdapterGrammars(loaded.grammars);
      } catch {
        setDependencyAdapterGrammars({});
      }
    } else {
      setDependencyAdapterGrammars({});
    }

    // Analyze each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (i % 10 === 0 || i === files.length - 1) {
        onProgress?.(
          i + 1,
          files.length,
          `Analyzing imports (${i + 1}/${files.length})...`,
        );
      }

      const content = this.workspaceFiles.get(file);
      if (!content) continue;

      const { imports: fileDependencies, calls: fileCalls } = analyzeDependenciesForFile(
        file,
        content,
        warn,
      );

      // Convert imports to dependency links
      for (const imp of fileDependencies) {
        const resolvedTarget = resolveModulePathFast(
          imp.module,
          file,
          this.fileIndex,
        );

        if (resolvedTarget && resolvedTarget !== file) {
          const key = `import|${file}|${resolvedTarget}`;
          const existing = linkIndex.get(key);
          if (existing) {
            existing.symbols = [
              ...new Set([...existing.symbols, ...imp.symbols]),
            ];
            existing.lines = [...new Set([...existing.lines, imp.line])].sort(
              (a, b) => a - b,
            );
            existing.strength = Math.min(
              1.0,
              Math.max(existing.strength, calculateImportStrength(imp)),
            );
          } else {
            const link: GraphEdge = {
              source: file,
              target: resolvedTarget,
              type: 'import',
              strength: calculateImportStrength(imp),
              symbols: [...new Set(imp.symbols)],
              lines: [imp.line],
              bidirectional: false,
            };
            links.push(link);
            linkIndex.set(key, link);
          }
        }
      }

      // Convert function calls to dependency links
      for (const call of fileCalls) {
        if (call.isExternal) {
          const resolvedTarget = resolveCallTargetFast(
            call.callee,
            file,
            this.fileIndex,
            this.workspaceFiles,
          );

          if (resolvedTarget && resolvedTarget !== file) {
            const callKey = `call|${file}|${resolvedTarget}`;
            const existing = linkIndex.get(callKey);

            if (existing) {
              if (!existing.symbols.includes(call.callee)) {
                existing.symbols.push(call.callee);
              }
              if (!existing.lines.includes(call.line)) {
                existing.lines.push(call.line);
              }
              existing.strength = Math.min(1.0, existing.strength + 0.1);
            } else {
              const link: GraphEdge = {
                source: file,
                target: resolvedTarget,
                type: 'call',
                strength: 0.6,
                symbols: [call.callee],
                lines: [call.line],
                bidirectional: false,
              };
              links.push(link);
              linkIndex.set(callKey, link);
            }
          }
        }
      }
    }

    // Detect circular dependencies
    onProgress?.(files.length, files.length, 'Detecting circular dependencies...');
    detectCircularDependencies(links);

    // Merge bidirectional relationships
    mergeBidirectionalLinks(links);

    // Clear index after use
    this.fileIndex = null;

    // Sort for deterministic output
    return links.sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.target.localeCompare(b.target) ||
        a.type.localeCompare(b.type),
    );
  }

  /**
   * Load file contents using CoreHost.
   */
  private async loadFileContents(
    files: string[],
    host: CoreHost,
    onProgress?: DependencyProgressCallback,
  ): Promise<void> {
    this.workspaceFiles.clear();

    const BATCH_SIZE = 50;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (filePath) => {
          const content = await host.readFile(filePath);
          return { filePath, content };
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          this.workspaceFiles.set(
            result.value.filePath,
            result.value.content,
          );
        }
      }

      onProgress?.(
        Math.min(i + BATCH_SIZE, files.length),
        files.length,
        `Reading files (${Math.min(i + BATCH_SIZE, files.length)}/${files.length})...`,
      );
    }
  }
}

// ── Graph algorithms ─────────────────────────────────────────

/**
 * Detect circular dependencies in the link graph using DFS.
 */
function detectCircularDependencies(links: GraphEdge[]): void {
  const graph = new Map<string, Set<string>>();

  for (const link of links) {
    if (!graph.has(link.source)) {
      graph.set(link.source, new Set());
    }
    graph.get(link.source)!.add(link.target);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  const hasCycle = (
    node: string,
    nodePath: string[],
  ): string[] | null => {
    if (recursionStack.has(node)) {
      const cycleStart = nodePath.indexOf(node);
      return nodePath.slice(cycleStart);
    }

    if (visited.has(node)) return null;

    visited.add(node);
    recursionStack.add(node);

    const neighbors = graph.get(node) || new Set();
    for (const neighbor of neighbors) {
      const cycle = hasCycle(neighbor, [...nodePath, node]);
      if (cycle) return cycle;
    }

    recursionStack.delete(node);
    return null;
  };

  for (const [node] of graph) {
    if (!visited.has(node)) {
      const cycle = hasCycle(node, []);
      if (cycle) {
        for (let i = 0; i < cycle.length; i++) {
          const source = cycle[i];
          const target = cycle[(i + 1) % cycle.length];
          const link = links.find(
            (l) => l.source === source && l.target === target,
          );
          if (link) {
            link.type = 'circular';
            link.strength = Math.min(1.0, link.strength + 0.3);
          }
        }
      }
    }
  }
}

/**
 * Merge bidirectional relationships (A→B + B→A → single bidirectional link).
 */
function mergeBidirectionalLinks(links: GraphEdge[]): void {
  for (let i = 0; i < links.length; i++) {
    const link1 = links[i];

    const reverseIndex = links.findIndex(
      (link2, j) =>
        j > i &&
        link2.source === link1.target &&
        link2.target === link1.source,
    );

    if (reverseIndex !== -1) {
      const link2 = links[reverseIndex];
      link1.bidirectional = true;
      link1.symbols = [...new Set([...link1.symbols, ...link2.symbols])];
      link1.lines = [...link1.lines, ...link2.lines];
      link1.strength = Math.min(
        1.0,
        link1.strength + link2.strength * 0.5,
      );
      links.splice(reverseIndex, 1);
    }
  }
}
