/**
 * KB Emitter — orchestrates generation of a single `kb.md` file.
 *
 * Implements the Emitter interface. Consumes an AnalysisModel and writes
 * a combined KB file via the EmitterHost abstraction.
 */

import type { AnalysisModel, DependencyLink } from '@aspectcode/core';
import type { Emitter, EmitOptions, EmitResult } from '../emitter';
import type { EmitterHost } from '../host';
import type { LoadedGrammars } from './symbols';
import { buildDepStats } from './depData';
import { buildArchitectureContent } from './architectureEmitter';
import { buildMapContent } from './mapEmitter';
import { buildContextContent } from './contextEmitter';
import { buildManifest } from '../manifest';
import { stableStringify } from '../stableJson';

// ── Public API ───────────────────────────────────────────────

export interface KBEmitterOptions {
  /** Pre-loaded tree-sitter grammars (optional). */
  grammars?: LoadedGrammars | null;
}

/** The default KB output filename. */
export const KB_FILENAME = 'kb.md';

/**
 * Create a KB emitter that generates a single `kb.md` knowledge base file.
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

      // ── Derive shared data from the AnalysisModel ────────

      // Absolute file paths
      const files = model.files.map((f) => host.join(workspaceRoot, f.relativePath));

      // Build file content cache from options or empty.
      // Normalize keys so both CLI (relative paths) and extension (absolute paths)
      // resolve consistently in downstream KB builders.
      const fileContentCache = normalizeFileContentCache(
        options.fileContents,
        workspaceRoot,
        model.files.map((f) => f.relativePath),
        host,
      );

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

      // ── Build manifest metadata as HTML comment ─────────

      const manifest = buildManifest(model, generatedAt);
      const manifestComment = `<!-- aspectcode: ${stableStringify(manifest)} -->\n`;

      // ── Combine into single kb.md ────────────────────────

      const combined = [
        archContent,
        '\n---\n\n',
        mapContent,
        '\n---\n\n',
        ctxContent,
        '\n',
        manifestComment,
      ].join('');

      const kbPath = host.join(outDir, KB_FILENAME);
      await host.writeFile(kbPath, combined);

      return {
        filesWritten: [kbPath],
      };
    },
  };
}

function normalizeFileContentCache(
  source: Map<string, string> | undefined,
  workspaceRoot: string,
  relativePaths: string[],
  host: EmitterHost,
): Map<string, string> {
  const normalized = new Map<string, string>();
  if (!source || source.size === 0) return normalized;

  for (const [key, value] of source.entries()) {
    normalized.set(key, value);
  }

  for (const relPath of relativePaths) {
    const relPosix = relPath.replace(/\\/g, '/');
    const relWindows = relPath.replace(/\//g, '\\');
    const absPath = host.join(workspaceRoot, relPath);
    const absPosix = absPath.replace(/\\/g, '/');
    const absWindows = absPath.replace(/\//g, '\\');

    const content =
      normalized.get(absPath) ??
      normalized.get(absPosix) ??
      normalized.get(absWindows) ??
      normalized.get(relPath) ??
      normalized.get(relPosix) ??
      normalized.get(relWindows);

    if (content === undefined) continue;

    normalized.set(absPath, content);
    normalized.set(absPosix, content);
    normalized.set(absWindows, content);
    normalized.set(relPath, content);
    normalized.set(relPosix, content);
    normalized.set(relWindows, content);
  }

  return normalized;
}
