/**
 * @aspectcode/evaluator — Evidence-based evaluation for AGENTS.md optimization.
 *
 * Replaces arbitrary LLM self-scoring with:
 * 1. Probe-based micro-tests scoped to the knowledge base
 * 2. Prompt history harvesting from AI coding tools
 * 3. Evidence-driven diagnosis and AGENTS.md improvement
 *
 * @example
 * ```ts
 * import { generateProbes, runProbes, diagnose, harvestPrompts } from '@aspectcode/evaluator';
 *
 * const harvested = await harvestPrompts({ root });
 * const probes = generateProbes({ kb, harvestedPrompts: harvested });
 * const results = await runProbes({ agentsContent, probes, provider });
 * const failures = results.filter(r => !r.passed);
 * if (failures.length > 0) {
 *   const diagnosis = await diagnose({ failures, agentsContent, provider });
 * }
 * ```
 */

// ── Types ───────────────────────────────────────────────────
export type {
  Probe,
  ProbeCategory,
  ProbeResult,
  BehaviorResult,
  Diagnosis,
  AgentsEdit,
  HarvestedPrompt,
  PromptSource,
  ProbeGeneratorOptions,
  ProbeRunnerOptions,
  ProbeEvaluatorOptions,
  DiagnosisOptions,
  HarvestOptions,
  EvaluationResult,
  LlmProvider,
  OptLogger,
} from './types';

// ── Probe generation ────────────────────────────────────────
export { generateProbes } from './probes';

// ── Probe execution ─────────────────────────────────────────
export { runProbes } from './runner';

// ── Diagnosis ───────────────────────────────────────────────
export { diagnose, applyDiagnosisEdits } from './diagnosis';

// ── Prompt harvesting ───────────────────────────────────────
export {
  harvestPrompts,
  harvestAider,
  harvestClaudeCode,
  harvestCline,
  harvestCopilotChat,
  harvestCursor,
  harvestWindsurf,
  harvestExport,
} from './harvest/index';

// ── Evaluation pipeline (convenience) ───────────────────────

import type { EvaluationResult, ProbeRunnerOptions, DiagnosisOptions, ProbeGeneratorOptions } from './types';
import { generateProbes } from './probes';
import { runProbes } from './runner';
import { diagnose } from './diagnosis';

/**
 * Run the full evaluation pipeline: generate probes → run them → diagnose failures.
 *
 * This is a convenience function combining the individual steps.
 * For more control, use the individual functions directly.
 */
export async function evaluate(options: {
  /** Probe generation options. */
  probeOptions: ProbeGeneratorOptions;
  /** Current AGENTS.md content. */
  agentsContent: string;
  /** LLM provider for probe execution and diagnosis. */
  provider: ProbeRunnerOptions['provider'];
  /** File contents for context. */
  fileContents?: ReadonlyMap<string, string>;
  /** Logger. */
  log?: DiagnosisOptions['log'];
  /** Abort signal. */
  signal?: AbortSignal;
}): Promise<EvaluationResult> {
  const { probeOptions, agentsContent, provider, fileContents, log, signal } = options;

  // Step 1: Generate probes
  const probes = generateProbes(probeOptions);

  // Step 2: Run probes
  const probeResults = await runProbes(
    agentsContent,
    probes,
    provider,
    fileContents,
    log,
    signal,
  );

  const failures = probeResults.filter((r) => !r.passed);

  // Step 3: Diagnose if there are failures
  let diagnosis;
  if (failures.length > 0) {
    diagnosis = await diagnose(
      failures,
      agentsContent,
      provider,
      log,
      signal,
    );
  }

  return {
    probeResults,
    diagnosis,
    passCount: probeResults.length - failures.length,
    failCount: failures.length,
    totalProbes: probeResults.length,
  };
}
