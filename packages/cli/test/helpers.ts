/**
 * Shared test helpers for @aspectcode/cli tests.
 */

import * as path from 'path';
import type { AnalysisModel } from '@aspectcode/core';
import type { ChangeAssessment } from '../src/changeEvaluator';
import type { PreferencesStore } from '../src/preferences';

/** Create a minimal AnalysisModel for unit tests. */
export function makeModel(
  files: { rel: string; imports?: string[]; exports?: string[]; language?: string }[],
  opts?: {
    hubs?: { file: string; inDegree: number; outDegree: number }[];
    edges?: { source: string; target: string; type: string; strength: number; symbols: string[]; lines: number[]; bidirectional: boolean }[];
  },
): AnalysisModel {
  return {
    files: files.map((f) => ({
      relativePath: f.rel,
      absolutePath: path.resolve(f.rel),
      language: f.language ?? 'typescript',
      imports: f.imports ?? [],
      exports: f.exports ?? [],
      symbols: [],
      loc: 1,
      functions: [],
      classes: [],
    })),
    graph: {
      nodes: files.map((f) => ({ id: f.rel })),
      edges: opts?.edges ?? [],
    },
    metrics: {
      hubs: opts?.hubs ?? [],
      orphans: [],
    },
  } as unknown as AnalysisModel;
}

/** Create a ChangeContext with sensible defaults. */
export function makeCtx(overrides: Record<string, any> = {}) {
  return {
    model: makeModel([]),
    agentsContent: '# stub',
    preferences: emptyPrefs(),
    recentChanges: [],
    fileContents: new Map<string, string>(),
    ...overrides,
  };
}

/** Create an empty preferences store. */
export function emptyPrefs(): PreferencesStore {
  return { version: 1, preferences: [] };
}

/** Create a ChangeAssessment with sensible defaults. */
export function makeAssessment(overrides: Partial<ChangeAssessment> = {}): ChangeAssessment {
  return {
    file: 'src/types.ts',
    type: 'warning',
    rule: 'co-change',
    message: '3 dependents, 0 of 2 strong dependents updated',
    dismissable: true,
    ...overrides,
  };
}
