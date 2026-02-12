/**
 * KB Emitter — orchestrates generation of architecture.md, map.md, context.md.
 *
 * Implements the Emitter interface. Consumes an AnalysisModel and writes
 * the three KB files via the EmitterHost abstraction.
 */

import type { AnalysisModel, DependencyLink } from '@aspectcode/core';
import type { Emitter, EmitOptions, EmitResult } from '../emitter';
import type { EmitterHost } from '../host';
import type { LoadedGrammars } from './symbols';
import { buildDepStats } from './depData';
import { buildArchitectureContent } from './architectureEmitter';
import { buildMapContent } from './mapEmitter';
import { buildContextContent } from './contextEmitter';

// ── Public API ───────────────────────────────────────────────

export interface KBEmitterOptions {
  /** Pre-loaded tree-sitter grammars (optional). */
  grammars?: LoadedGrammars | null;
}

/**
 * Create a KB emitter that generates the .aspect/ knowledge base files.
 *
 * @param kbOptions  Optional KB-specific options (e.g. tree-sitter grammars).
 */
export function createKBEmitter(kbOptions?: KBEmitterOptions): Emitter {
  return {
    name: 'aspect-kb',

    async emit(
      model: AnalysisModel,
      host: EmitterHost,
      options: EmitOptions,
    ): Promise<EmitResult> {
      const generatedAt = options.generatedAt ?? new Date().toISOString();
      const workspaceRoot = options.workspaceRoot;
      const outDir = options.outDir ?? workspaceRoot;
      const aspectDir = host.join(outDir, '.aspect');

      // Ensure .aspect directory exists
      await host.mkdirp(aspectDir);

      // ── Derive shared data from the AnalysisModel ────────

      // Absolute file paths
      const files = model.files.map((f) => host.join(workspaceRoot, f.relativePath));

      // Build file content cache from options or empty
      const fileContentCache: Map<string, string> = options.fileContents ?? new Map();

      // Build dependency links (absolute paths)
      const allLinks: DependencyLink[] = model.graph.edges.map((e) => ({
        ...e,
        source: host.join(workspaceRoot, e.source),
        target: host.join(workspaceRoot, e.target),
      }));

      // Per-file in/out degree stats
      const depData = buildDepStats(files, allLinks);

      const grammars = kbOptions?.grammars ?? null;

      // ── Generate all three files in parallel ─────────────

      const [archContent, mapContent, ctxContent] = await Promise.all([
        Promise.resolve(
          buildArchitectureContent({
            files,
            depData,
            allLinks,
            fileContentCache,
            workspaceRoot,
            generatedAt,
          }),
        ),
        Promise.resolve(
          buildMapContent({
            files,
            depData,
            allLinks,
            grammars,
            fileContentCache,
            workspaceRoot,
            generatedAt,
          }),
        ),
        Promise.resolve(
          buildContextContent({
            files,
            allLinks,
            fileContentCache,
            workspaceRoot,
            generatedAt,
          }),
        ),
      ]);

      // ── Write files ──────────────────────────────────────

      const archPath = host.join(aspectDir, 'architecture.md');
      const mapPath = host.join(aspectDir, 'map.md');
      const ctxPath = host.join(aspectDir, 'context.md');

      await Promise.all([
        host.writeFile(archPath, archContent),
        host.writeFile(mapPath, mapContent),
        host.writeFile(ctxPath, ctxContent),
      ]);

      return {
        filesWritten: [archPath, mapPath, ctxPath],
      };
    },
  };
}
