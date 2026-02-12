/**
 * Dependency-statistics helpers.
 *
 * Builds per-file in/out-degree maps from an already-computed set
 * of DependencyLinks. The I/O-heavy dependency analysis itself
 * (DependencyAnalyzer) is orchestrated at a higher level.
 *
 * All functions are pure (no I/O, no vscode).
 */

import { DependencyLink } from '@aspectcode/core';

/**
 * Build per-file in/out-degree stats from a link set.
 */
export function buildDepStats(
  files: string[],
  links: DependencyLink[],
): Map<string, { inDegree: number; outDegree: number }> {
  const stats = new Map<string, { inDegree: number; outDegree: number }>();

  for (const file of files) {
    stats.set(file, { inDegree: 0, outDegree: 0 });
  }

  for (const link of links) {
    const sourceStats = stats.get(link.source);
    const targetStats = stats.get(link.target);
    if (sourceStats) sourceStats.outDegree++;
    if (targetStats) targetStats.inDegree++;
  }

  return stats;
}
