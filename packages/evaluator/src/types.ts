/**
 * @aspectcode/evaluator — core types.
 *
 * Types for probe-based evaluation, prompt harvesting, and
 * evidence-based diagnosis of AGENTS.md quality.
 */

import type { LlmProvider, OptLogger } from '@aspectcode/optimizer';

// Re-export optimizer types used by evaluator modules
export type { LlmProvider, OptLogger } from '@aspectcode/optimizer';

// ── Probes ──────────────────────────────────────────────────

/**
 * A single micro-test that evaluates whether AGENTS.md guides
 * the AI correctly for a specific scenario scoped to the codebase.
 */
export interface Probe {
  /** Unique identifier (e.g. "hub-auth-middleware-naming"). */
  id: string;

  /** Human-readable description of what this probe tests. */
  description: string;

  /** Category for grouping (e.g. "hub-safety", "naming", "architecture"). */
  category: ProbeCategory;

  /**
   * Workspace-relative paths of files relevant to this probe.
   * These are included as context when running the probe.
   */
  contextFiles: string[];

  /** The task/question posed to the AI in this probe. */
  task: string;

  /**
   * Specific behaviours the AI's response should exhibit.
   * Used by the evaluator to score the response.
   */
  expectedBehaviors: string[];
}

/** Probe categories for grouping and prioritization. */
export type ProbeCategory =
  | 'hub-safety'       // High-risk hub modifications
  | 'naming'           // Naming conventions
  | 'architecture'     // Directory structure / module boundaries
  | 'entry-point'      // HTTP handlers, CLI commands, event listeners
  | 'integration'      // External API / DB / queue interactions
  | 'convention'       // Code style, import patterns
  | 'dependency'       // Circular deps, dependency direction
  | 'harvested';       // Derived from real user prompt history

// ── Probe results ───────────────────────────────────────────

/** Result of running a single probe against the current AGENTS.md. */
export interface ProbeResult {
  /** The probe that was run. */
  probeId: string;

  /** Whether all expected behaviours were exhibited. */
  passed: boolean;

  /** The AI's simulated response to the probe task. */
  response: string;

  /**
   * Specific shortcomings identified by the evaluator.
   * Empty if `passed` is true.
   */
  shortcomings: string[];

  /** Per-behaviour pass/fail breakdown. */
  behaviorResults: BehaviorResult[];
}

/** Pass/fail for a single expected behaviour within a probe. */
export interface BehaviorResult {
  /** The expected behaviour description. */
  behavior: string;
  /** Whether the response exhibited this behaviour. */
  passed: boolean;
  /** Brief explanation of why it passed or failed. */
  explanation: string;
}

// ── Diagnosis ───────────────────────────────────────────────

/** Diagnosis of AGENTS.md shortcomings based on failed probes. */
export interface Diagnosis {
  /** Specific edits proposed for AGENTS.md. */
  edits: AgentsEdit[];

  /** High-level summary of what's wrong. */
  summary: string;

  /** Number of probe failures this diagnosis addresses. */
  failureCount: number;
}

/** A specific proposed edit to AGENTS.md. */
export interface AgentsEdit {
  /** What section/area of AGENTS.md to modify. */
  section: string;

  /** The type of edit. */
  action: 'add' | 'modify' | 'strengthen' | 'remove';

  /** The proposed rule or content change. */
  content: string;

  /** Which probe failures motivated this edit. */
  motivatedBy: string[];
}

// ── Prompt harvesting ───────────────────────────────────────

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
  | 'export';        // User-provided aspectcode-prompts.jsonl

// ── Options ─────────────────────────────────────────────────

/** Options for probe generation. */
export interface ProbeGeneratorOptions {
  /** Full KB content for deriving probes. */
  kb: string;

  /**
   * Line-level KB diff (undefined on first run).
   * When provided, probes focus on changed areas.
   */
  kbDiff?: string;

  /** Harvested prompts to generate additional probes from. */
  harvestedPrompts?: HarvestedPrompt[];

  /** Maximum number of probes to generate. Default: 10. */
  maxProbes?: number;

  /** File contents map (workspace-relative path → content). */
  fileContents?: ReadonlyMap<string, string>;
}

/** Options for running probes. */
export interface ProbeRunnerOptions {
  /** Current AGENTS.md content (used as system prompt for probes). */
  agentsContent: string;

  /** Probes to run. */
  probes: Probe[];

  /** LLM provider for simulating AI responses. */
  provider: LlmProvider;

  /** File contents map for including context files. */
  fileContents?: ReadonlyMap<string, string>;

  /** Optional logger. */
  log?: OptLogger;

  /** AbortSignal for cooperative cancellation. */
  signal?: AbortSignal;
}

/** Options for evaluating probe responses. */
export interface ProbeEvaluatorOptions {
  /** Probe results to evaluate. */
  results: ProbeResult[];

  /** LLM provider for evaluation. */
  provider: LlmProvider;

  /** Optional logger. */
  log?: OptLogger;

  /** AbortSignal for cooperative cancellation. */
  signal?: AbortSignal;
}

/** Options for diagnosing AGENTS.md issues from probe failures. */
export interface DiagnosisOptions {
  /** Failed probe results. */
  failures: ProbeResult[];

  /** Current AGENTS.md content. */
  agentsContent: string;

  /** LLM provider for diagnosis. */
  provider: LlmProvider;

  /** Optional logger. */
  log?: OptLogger;

  /** AbortSignal for cooperative cancellation. */
  signal?: AbortSignal;
}

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

// ── Evaluation pipeline ─────────────────────────────────────

/** Full result of the evaluation pipeline. */
export interface EvaluationResult {
  /** All probe results (passed + failed). */
  probeResults: ProbeResult[];

  /** Diagnosis based on failures (undefined if all probes passed). */
  diagnosis?: Diagnosis;

  /** Number of probes that passed. */
  passCount: number;

  /** Number of probes that failed. */
  failCount: number;

  /** Total probes run. */
  totalProbes: number;
}
