/**
 * Manifest builder — builds manifest metadata for embedding in kb.md.
 *
 * The manifest provides a machine-readable summary alongside the
 * human-readable KB content. The KB emitter embeds the manifest as
 * an HTML comment at the bottom of kb.md.
 *
 * Determinism: keys are sorted explicitly; `generatedAt` is the only
 * volatile field and is injected via options.
 */

import type { AnalysisModel } from '@aspectcode/core';
import { computeModelStats } from '@aspectcode/core';

// ── Types ────────────────────────────────────────────────────

export interface Manifest {
  schemaVersion: string;
  generatorVersion: string;
  generatedAt: string;
  stats: ManifestStats;
}

export interface ManifestStats {
  fileCount: number;
  totalLines: number;
  languageCounts: Record<string, number>;
  edgeCount: number;
  circularCount: number;
  topHubs: Array<{ file: string; inDegree: number; outDegree: number }>;
}

// ── Constants ────────────────────────────────────────────────

/** Package version — updated at release time. */
const GENERATOR_VERSION = '0.0.1';

// ── Public API ───────────────────────────────────────────────

/**
 * Build a Manifest object from an AnalysisModel.
 *
 * Pure function — no I/O. Used by the KB emitter to embed
 * manifest data as an HTML comment in kb.md.
 */
export function buildManifest(
  model: AnalysisModel,
  generatedAt: string,
  topN = 10,
): Manifest {
  const stats = computeModelStats(model, topN);

  // Sort language keys for determinism
  const sortedLanguageCounts: Record<string, number> = {};
  for (const key of Object.keys(stats.languageCounts).sort()) {
    sortedLanguageCounts[key] = stats.languageCounts[key];
  }

  return {
    schemaVersion: model.schemaVersion,
    generatorVersion: GENERATOR_VERSION,
    generatedAt,
    stats: {
      fileCount: stats.fileCount,
      totalLines: stats.totalLines,
      languageCounts: sortedLanguageCounts,
      edgeCount: stats.edgeCount,
      circularCount: stats.circularCount,
      topHubs: stats.topHubs.map((h) => ({
        file: h.file,
        inDegree: h.inDegree,
        outDegree: h.outDegree,
      })),
    },
  };
}
