/**
 * @aspectcode/evaluator — Probe-and-refine tuning for AGENTS.md.
 *
 * Multi-iteration loop: LLM-generated probes, per-probe judging,
 * aggregate diagnosis, and deterministic edit application.
 */

// ── Types ───────────────────────────────────────────────────
export type {
  Probe,
  SimulationResult,
  BehaviorReview,
  JudgedProbeResult,
  AgentsEdit,
  ProbeGeneratorOptions,
  ProbeRunnerOptions,
  JudgeOptions,
  DiagnosisOptions,
  ProbeRefineConfig,
  ProbeRefineResult,
  IterationSummary,
  ApplyResult,
  ProbeProgressCallback,
  LlmProvider,
  ChatOptions,
  OptLogger,
} from './types';

export { DEFAULT_PROBE_REFINE_CONFIG } from './types';

// ── Probe generation ────────────────────────────────────────
export { generateProbes } from './probes';

// ── Probe execution ─────────────────────────────────────────
export { runProbes } from './runner';

// ── Per-probe judging ───────────────────────────────────────
export { judgeProbe } from './judge';

// ── Aggregate diagnosis ─────────────────────────────────────
export { diagnose } from './diagnosis';

// ── Edit application ───────────────────────────────────────
export { applyEdits, applyEditsWithLlm, AGENTS_MD_CHAR_BUDGET } from './apply';
