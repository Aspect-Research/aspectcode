/**
 * In-memory KB builder — constructs the knowledge base content string.
 *
 * Combines architecture + map + context emitter outputs into a single
 * KB string that can be fed to the optimizer.
 */

import * as path from 'path';
import type { AnalysisModel, DependencyLink } from '@aspectcode/core';
import {
  buildArchitectureContent,
  buildMapContent,
  buildContextContent,
} from '@aspectcode/emitters';

/**
 * Build the full KB content in memory.
 * Returns a single string combining architecture, map, and context sections.
 */
export function buildKbContent(
  model: AnalysisModel,
  workspaceRoot: string,
  fileContents: Map<string, string>,
): string {
  const generatedAt = new Date().toISOString();

  // Build dep data map for architecture/map emitters
  const depData = new Map<string, { inDegree: number; outDegree: number }>();
  for (const edge of model.graph.edges) {
    // outDegree for source
    const src = depData.get(edge.source) ?? { inDegree: 0, outDegree: 0 };
    src.outDegree++;
    depData.set(edge.source, src);
    // inDegree for target
    const tgt = depData.get(edge.target) ?? { inDegree: 0, outDegree: 0 };
    tgt.inDegree++;
    depData.set(edge.target, tgt);
  }

  // Convert relative fileContents map keys to absolute paths for the emitters
  const absoluteFileContents = new Map<string, string>();
  for (const [rel, content] of fileContents) {
    absoluteFileContents.set(path.join(workspaceRoot, rel), content);
  }

  // Absolute file paths (AnalyzedFile → string)
  const files: string[] = model.files.map((f) =>
    path.isAbsolute(f.relativePath) ? f.relativePath : path.join(workspaceRoot, f.relativePath),
  );

  const allLinks: DependencyLink[] = model.graph.edges.map((e) => ({
    source: path.isAbsolute(e.source) ? e.source : path.join(workspaceRoot, e.source),
    target: path.isAbsolute(e.target) ? e.target : path.join(workspaceRoot, e.target),
    type: e.type,
    strength: e.strength,
    symbols: e.symbols,
    lines: e.lines ?? [],
    bidirectional: e.bidirectional ?? false,
  }));

  const architecture = buildArchitectureContent({
    files,
    depData,
    allLinks,
    fileContentCache: absoluteFileContents,
    workspaceRoot,
    generatedAt,
  });

  const mapContent = buildMapContent({
    files,
    depData,
    allLinks,
    grammars: null,
    fileContentCache: absoluteFileContents,
    workspaceRoot,
    generatedAt,
  });

  const context = buildContextContent({
    files,
    allLinks,
    fileContentCache: absoluteFileContents,
    workspaceRoot,
    generatedAt,
  });

  return `${architecture}\n\n---\n\n${mapContent}\n\n---\n\n${context}`;
}
