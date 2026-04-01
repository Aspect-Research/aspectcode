/**
 * @aspectcode/evaluator — core types.
 *
 * Types for probe-based evaluation, probe-and-refine tuning,
 * and evidence-based diagnosis of AGENTS.md quality.
 */

import type { LlmProvider, OptLogger } from '@aspectcode/optimizer';

// Re-export optimizer types used by evaluator modules
export type { LlmProvider, ChatOptions, OptLogger } from '@aspectcode/optimizer';

// ── Probes ──────────────────────────────────────────────────

/**
 * A single synthetic task that evaluates whether AGENTS.md guides
 * the AI correctly for a specific scenario scoped to the codebase.
 */
export interface Probe {
  /** Unique identifier. */
  id: string;

  /** The task/question posed to the AI in this probe. */
  task: string;

  /**
   * Specific behaviours the AI's response should exhibit.
   * Used by the judge to score the response.
   */
  expectedBehaviors: string[];

  /** Why this probe is useful (optional rationale from the generator). */
  rationale?: string;
}

// ── Probe results ───────────────────────────────────────────

/** Raw result of simulating a single probe (before judging). */
export interface SimulationResult {
  probeId: string;
  task: string;
  response: string;
}

/** Per-behavior assessment from the judge (strong/partial/missing). */
export interface BehaviorReview {
  /** The expected behaviour description. */
  behavior: string;
  /** How well the response exhibited this behaviour. */
  assessment: 'strong' | 'partial' | 'missing';
  /** Short excerpt from response supporting the assessment. */
  evidence: string;
  /** What AGENTS.md should add/change to improve this behaviour. */
  improvement: string;
}

/** Result of judging a single probe's response. */
export interface JudgedProbeResult {
  /** The probe that was judged. */
  probeId: string;
  /** The original task. */
  task: string;
  /** The AI's simulated response. */
  response: string;
  /** Per-behaviour assessments. */
  behaviorReviews: BehaviorReview[];
  /** Per-probe edit suggestions from the judge (up to 3). */
  proposedEdits: AgentsEdit[];
  /** Summary notes from the judge. */
  overallNotes: string;
}

// ── Diagnosis ───────────────────────────────────────────────

/** A specific proposed edit to AGENTS.md. */
export interface AgentsEdit {
  /** What section/area to modify. AGENTS.md section name, or "scoped:slug" / "scoped:CREATE:slug" / "scoped:DELETE:slug". */
  section: string;

  /** The type of edit. */
  action: 'add' | 'modify' | 'strengthen' | 'remove';

  /** The proposed rule or content change. */
  content: string;

  /** Which probe failures motivated this edit (optional). */
  motivatedBy?: string[];

  /** Glob patterns (only for scoped:CREATE). */
  globs?: string[];

  /** Description (only for scoped:CREATE). */
  description?: string;
}

// ── Probe-and-refine loop ───────────────────────────────────

/** Configuration for the multi-iteration probe-and-refine loop. */
export interface ProbeRefineConfig {
  /** Maximum iterations before stopping. Default: 3. */
  maxIterations: number;
  /** Target probes per iteration. Default: 10. */
  targetProbesPerIteration: number;
  /** Max edits applied per iteration. Default: 5. */
  maxEditsPerIteration: number;
  /** Character budget for the AGENTS.md artifact. Default: 8000. */
  charBudget: number;
}

/** Default probe-and-refine configuration. */
export const DEFAULT_PROBE_REFINE_CONFIG: ProbeRefineConfig = {
  maxIterations: 1,
  targetProbesPerIteration: 5,
  maxEditsPerIteration: 5,
  charBudget: 8000,
};

/** Summary of a single iteration in the probe-and-refine loop. */
export interface IterationSummary {
  iteration: number;
  probesGenerated: number;
  probesEvaluated: number;
  editsApplied: number;
  guidanceChanged: boolean;
  charsBefore: number;
  charsAfter: number;
}

/** Result of the full probe-and-refine loop. */
export interface ProbeRefineResult {
  /** The final refined AGENTS.md content. */
  finalContent: string;
  /** Per-iteration summaries. */
  iterations: IterationSummary[];
  /** Why the loop stopped (if before maxIterations). */
  convergedReason?: string;
}

// ── Options ─────────────────────────────────────────────────

/** Options for LLM-powered probe generation. */
export interface ProbeGeneratorOptions {
  /** Full KB content for context. */
  kb: string;

  /** Current AGENTS.md content being tuned. */
  currentAgentsMd: string;

  /** Prior probe tasks (across iterations) for deduplication. */
  priorProbeTasks: string[];

  /** Maximum number of probes to generate. Default: 10. */
  maxProbes?: number;

  /** LLM provider for generating probes. */
  provider: LlmProvider;

  /** Project name (derived from workspace root). */
  projectName?: string;

  /** AbortSignal for cooperative cancellation. */
  signal?: AbortSignal;

  /** Optional logger. */
  log?: OptLogger;
}

/** Options for running probe simulations. */
export interface ProbeRunnerOptions {
  /** Current AGENTS.md content (used as system prompt). */
  agentsContent: string;

  /** Probes to simulate. */
  probes: Probe[];

  /** LLM provider for simulating AI responses. */
  provider: LlmProvider;

  /** Optional logger. */
  log?: OptLogger;

  /** AbortSignal for cooperative cancellation. */
  signal?: AbortSignal;
}

/** Options for judging a probe's response. */
export interface JudgeOptions {
  /** The probe task. */
  task: string;

  /** The AI's simulated response. */
  response: string;

  /** Expected behaviours to judge against. */
  expectedBehaviors: string[];

  /** Probe ID for tracking. */
  probeId: string;

  /** LLM provider for judging. */
  provider: LlmProvider;

  /** Optional logger. */
  log?: OptLogger;

  /** AbortSignal for cooperative cancellation. */
  signal?: AbortSignal;
}

/** Options for diagnosing AGENTS.md issues from judged probes. */
export interface DiagnosisOptions {
  /** All judged probe results (including strong ones). */
  judgedResults: JudgedProbeResult[];

  /** Current AGENTS.md content. */
  agentsContent: string;

  /** Current scoped rules context (slug → content map). Optional. */
  scopedRulesContext?: string;

  /** Raw static analysis data for scoped rule decisions. Optional. */
  staticAnalysisData?: string;

  /** LLM provider for diagnosis. */
  provider: LlmProvider;

  /** Optional logger. */
  log?: OptLogger;

  /** AbortSignal for cooperative cancellation. */
  signal?: AbortSignal;
}

/** Callback invoked before/after each probe for live progress updates. */
export interface ProbeProgressCallback {
  (info: {
    probeIndex: number;
    total: number;
    probeId: string;
    phase: 'starting' | 'done';
    passed?: boolean;
  }): void;
}

// ── Apply results ───────────────────────────────────────────

/** Result of deterministic edit application. */
export interface ApplyResult {
  /** The updated AGENTS.md content. */
  content: string;
  /** Number of edits successfully applied. */
  applied: number;
  /** Number of bullets trimmed to fit budget. */
  trimmed: number;
}

// ── Prompt harvesting (legacy, used by harvest modules) ─────

/** A conversation turn harvested from an AI tool's history. */
export interface HarvestedPrompt {
  /** Which tool this came from. */
  source: PromptSource;
  /** When this conversation happened (ISO-8601, if available). */
  timestamp?: string;
  /** The user's prompt/question. */
  userPrompt: string;
  /** The AI's response. */
  assistantResponse: string;
  /** Workspace-relative file paths referenced in the conversation. */
  filesReferenced: string[];
}

/** Supported prompt history sources. */
export type PromptSource =
  | 'aider'
  | 'claude-code'
  | 'cline'
  | 'copilot-chat'
  | 'cursor'
  | 'windsurf'
  | 'export';

/** Options for prompt harvesting. */
export interface HarvestOptions {
  /** Workspace root directory. */
  root: string;
  /** Which sources to harvest from. Defaults to all available. */
  sources?: PromptSource[];
  /** Maximum prompts to harvest per source. Default: 50. */
  maxPerSource?: number;
  /** Only harvest prompts newer than this date. */
  since?: Date;
  /** Optional logger. */
  log?: OptLogger;
}
