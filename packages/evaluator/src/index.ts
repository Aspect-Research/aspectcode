/**
 * @aspectcode/evaluator — Evidence-based evaluation for AGENTS.md optimization.
 *
 * Probe-based micro-tests scoped to the knowledge base, prompt history
 * harvesting from AI coding tools, and evidence-driven diagnosis.
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
export type { ProbeProgressCallback } from './runner';

// ── Diagnosis ───────────────────────────────────────────────
export { diagnose, applyDiagnosisEdits } from './diagnosis';

// ── Prompt harvesting ───────────────────────────────────────
export { harvestPrompts } from './harvest/index';
