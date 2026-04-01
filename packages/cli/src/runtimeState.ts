/**
 * Runtime state — holds analysis artifacts from the last pipeline run.
 *
 * Separate from DashboardStore (which tracks UI state). This module
 * stores the data that other modules (e.g. the v2 change evaluator)
 * need to consult: the latest AnalysisModel, KB content, generated
 * AGENTS.md content, and file contents.
 *
 * All values are undefined until the first pipeline run completes.
 */

import type { AnalysisModel } from '@aspectcode/core';

export interface RuntimeState {
  /** AnalysisModel from the most recent completed pipeline run. */
  model: AnalysisModel | undefined;
  /** KB content string from the most recent run. */
  kbContent: string | undefined;
  /** Generated AGENTS.md content from the most recent run. */
  agentsContent: string | undefined;
  /** File contents map (relative path → content) from the most recent run. */
  fileContents: Map<string, string> | undefined;
  /** Hub inDegree counts from last analysis — used to detect new hubs. */
  previousHubCounts: Map<string, number>;
}

const state: RuntimeState = {
  model: undefined,
  kbContent: undefined,
  agentsContent: undefined,
  fileContents: undefined,
  previousHubCounts: new Map(),
};

/** Get the current runtime state (read-only reference). */
export function getRuntimeState(): Readonly<RuntimeState> {
  return state;
}

/** Update runtime state after a pipeline run. */
export function updateRuntimeState(update: Partial<RuntimeState>): void {
  Object.assign(state, update);
}

/** Reset runtime state (e.g. on shutdown). */
export function resetRuntimeState(): void {
  state.model = undefined;
  state.kbContent = undefined;
  state.agentsContent = undefined;
  state.fileContents = undefined;
  state.previousHubCounts = new Map();
}
