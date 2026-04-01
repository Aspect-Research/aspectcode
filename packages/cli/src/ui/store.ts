/**
 * Dashboard state — shared between the ink UI and the pipeline.
 *
 * The pipeline pushes events via the DashboardStore; the ink Dashboard
 * component re-renders whenever the state changes.
 */

import { EventEmitter } from 'events';
import type { ChangeAssessment } from '../changeEvaluator';

export type PipelinePhase =
  | 'idle'
  | 'discovering'
  | 'analyzing'
  | 'building-kb'
  | 'optimizing'
  | 'evaluating'
  | 'writing'
  | 'watching'
  | 'done'
  | 'error';

/** Evaluator sub-phase for transparent progress reporting. */
export type EvalPhase =
  | 'idle'
  | 'generating-probes'
  | 'probing'
  | 'judging'
  | 'diagnosing'
  | 'applying'
  | 'done';

/** Evaluator status shown in the dashboard. */
export interface EvalStatus {
  phase: EvalPhase;
  /** Current iteration in the probe-and-refine loop. */
  iteration?: number;
  /** Total iterations planned. */
  maxIterations?: number;

  // ── Probe progress ─────────────────────────────────────
  probesPassed?: number;
  probesTotal?: number;
  /** Short task descriptions of generated probes. */
  probeTasks?: string[];
  /** Task description of the probe currently being tested/judged. */
  currentProbeTask?: string;

  // ── Judging progress ───────────────────────────────────
  /** How many probes have been judged so far. */
  judgedCount?: number;
  /** Probes where all behaviors were strong. */
  strongCount?: number;
  /** Probes with at least one weak/missing behavior. */
  weakCount?: number;

  // ── Live probe results ─────────────────────────────────
  /** Per-probe result summaries, shown live during judging. */
  probeResults?: Array<{ task: string; status: 'strong' | 'weak' | 'pending' }>;

  // ── Edits ──────────────────────────────────────────────
  /** Total edits applied across all iterations. */
  diagnosisEdits?: number;
  /** Edits proposed in the current iteration. */
  proposedEditCount?: number;
  /** Human-readable summaries of applied edits. */
  editSummaries?: string[];

  // ── Accumulated state ──────────────────────────────────
  /** Why the loop converged early. */
  convergedReason?: string;
  /** Per-round summary lines (persist across iterations). */
  iterationSummaries?: string[];

  // ── UI state ───────────────────────────────────────────
  /** True when the user has dismissed the eval result line. */
  dismissed?: boolean;
  /** True when the user has requested cancellation. */
  cancelled?: boolean;
}

/** Summary of generated AGENTS.md content. */
export interface ContentSummary {
  sections: number;
  rules: number;
  filePaths: string[];
}

/** Summary of line-level changes between two versions. */
export interface DiffSummary {
  added: number;
  removed: number;
  changed: boolean;
}

/** A managed file tracked in the memory map. */
export interface ManagedFile {
  /** Display path (e.g. "AGENTS.md", "~/.claude/CLAUDE.md") */
  path: string;
  /** Short annotation (e.g. "hub safety (3 rules)", "12 learned") */
  annotation: string;
  /** Epoch ms when last updated, 0 if never */
  updatedAt: number;
  /** Category for grouping */
  category: 'agents' | 'claude-rule' | 'cursor-rule' | 'aspectcode' | 'cloud'
           | 'device' | 'user-rule' | 'workspace-config';
  /** Where this file lives — device (~/.claude/) vs workspace (./) */
  scope: 'device' | 'workspace';
  /** Who owns this file */
  owner: 'aspectcode' | 'user' | 'device';
}

export interface DashboardState {
  /** Workspace root path. */
  rootPath: string;
  /** Active AI platform ('claude' | 'cursor' | ''). */
  activePlatform: string;
  /** Logged-in user email, empty if not logged in. */
  userEmail: string;
  phase: PipelinePhase;
  /** Human-readable label for the current sub-step (e.g. "iteration 2/3"). */
  phaseDetail: string;
  fileCount: number;
  edgeCount: number;
  provider: string;
  lastChange: string;
  elapsed: string;
  /** Warning text (e.g. no API key). */
  warning: string;
  /** Files written this run (e.g. ["AGENTS.md updated"]). */
  outputs: string[];
  /** Optimization reasoning lines from the agent (score + feedback per iteration). */
  reasoning: string[];
  /** Brief setup notifications (config, API key, tool files). */
  setupNotes: string[];
  /** Evaluator pipeline progress. */
  evalStatus: EvalStatus;
  /** Epoch ms when the current run started (0 when idle). */
  runStartMs: number;
  /** Token usage from the LLM generation call. */
  tokenUsage?: { inputTokens: number; outputTokens: number };
  /** Summary of generated AGENTS.md content. */
  summary?: ContentSummary;
  /** True on the first run (no AGENTS.md or config existed). */
  isFirstRun: boolean;
  /** Diff summary when AGENTS.md is regenerated (watch mode). */
  diffSummary?: DiffSummary;
  /** Compact dashboard mode (no banner, tighter layout). */
  compact: boolean;

  // ── v2: Real-time assessment state ─────────────────────────
  /** Queue of assessments waiting for user input. */
  pendingAssessments: ChangeAssessment[];
  /** The assessment currently shown to the user (null if none). */
  currentAssessment: ChangeAssessment | null;
  /** Running counts. */
  assessmentStats: {
    ok: number;
    warnings: number;
    violations: number;
    dismissed: number;
    confirmed: number;
    changes: number;
    autoResolved: number;
  };
  /** Number of consecutive OK-only changes (used to suppress output). */
  consecutiveOk: number;
  /** Learned preference count (from preferences.json). */
  preferenceCount: number;
  /** Transient "Learned: ..." message, auto-clears. */
  learnedMessage: string;
  /** True when the UI should recommend pressing [r] to regenerate. */
  recommendProbe: boolean;
  /** Transient "✔ file — ok" flash message, auto-clears. */
  lastChangeFlash: string;
  /** Count of 'add' events since last probe. */
  addCount: number;
  /** Count of 'change' events since last probe. */
  changeCount: number;
  /** Number of unprocessed corrections for dream cycle. */
  correctionCount: number;
  /** True when dream cycle prompt should show. */
  dreamPrompt: boolean;
  /** True when dream cycle is running. */
  dreaming: boolean;
  /** Managed files for the memory map. */
  managedFiles: ManagedFile[];

  /** Update status message (e.g. "Updated to v0.5.0" or "v0.5.0 available"). */
  updateMessage: string;
  /** Cloud sync status for display. */
  syncStatus: 'idle' | 'syncing' | 'synced' | 'offline';
  /** Epoch ms of last successful sync. */
  lastSyncAt: number;
  /** Community suggestions for this project type. */
  suggestions: Array<{ rule: string; disposition: string; directory: string | null; suggestion: string }>;
  /** Cumulative LLM usage for this session. */
  sessionUsage: { inputTokens: number; outputTokens: number; calls: number };
  /** Whether suggestions have been shown/dismissed. */
  suggestionsDismissed: boolean;

  // ── Tier state ────────────────────────────────────────────
  /** User's tier: 'free', 'pro', or 'byok'. */
  userTier: 'free' | 'pro' | 'byok';
  /** Tokens used toward the tier cap. */
  tierTokensUsed: number;
  /** Token cap for the tier (0 = unlimited/BYOK). */
  tierTokensCap: number;
  /** ISO date of next monthly reset (Pro only, '' otherwise). */
  tierResetAt: string;
  /** True when the tier token cap has been reached. */
  tierExhausted: boolean;
}

/**
 * Mutable singleton store. The ink component subscribes via onChange.
 */
class DashboardStore extends EventEmitter {
  state: DashboardState = {
    rootPath: '',
    activePlatform: '',
    userEmail: '',
    phase: 'idle',
    phaseDetail: '',
    fileCount: 0,
    edgeCount: 0,
    provider: '',
    lastChange: '',
    elapsed: '',
    warning: '',
    outputs: [],
    reasoning: [],
    setupNotes: [],
    evalStatus: { phase: 'idle' },
    runStartMs: 0,
    tokenUsage: undefined,
    summary: undefined,
    isFirstRun: false,
    diffSummary: undefined,
    compact: false,
    pendingAssessments: [],
    currentAssessment: null,
    assessmentStats: { ok: 0, warnings: 0, violations: 0, dismissed: 0, confirmed: 0, changes: 0, autoResolved: 0 },
    consecutiveOk: 0,
    preferenceCount: 0,
    learnedMessage: '',
    recommendProbe: false,
    lastChangeFlash: '',
    addCount: 0,
    changeCount: 0,
    correctionCount: 0,
    dreamPrompt: false,
    dreaming: false,
    managedFiles: [],
    updateMessage: '',
    syncStatus: 'idle',
    lastSyncAt: 0,
    sessionUsage: { inputTokens: 0, outputTokens: 0, calls: 0 },
    suggestions: [],
    suggestionsDismissed: false,
    userTier: 'free',
    tierTokensUsed: 0,
    tierTokensCap: 100_000,
    tierResetAt: '',
    tierExhausted: false,
  };

  private update(patch: Partial<DashboardState>): void {
    Object.assign(this.state, patch);
    this.emit('change');
  }

  setRootPath(rootPath: string): void {
    this.update({ rootPath });
  }

  setPlatform(platform: string): void {
    this.update({ activePlatform: platform });
  }

  setUserEmail(email: string): void {
    this.update({ userEmail: email });
  }

  setPhase(phase: PipelinePhase, detail = ''): void {
    this.update({ phase, phaseDetail: detail });
  }

  setStats(fileCount: number, edgeCount: number): void {
    this.update({ fileCount, edgeCount });
  }

  setProvider(provider: string): void {
    this.update({ provider });
  }

  setLastChange(change: string): void {
    this.update({ lastChange: change });
  }

  setElapsed(elapsed: string): void {
    this.update({ elapsed });
  }

  setWarning(warning: string): void {
    this.update({ warning });
  }

  addOutput(output: string): void {
    this.update({ outputs: [...this.state.outputs, output] });
  }

  setReasoning(reasoning: string[]): void {
    this.update({ reasoning });
  }

  // ── Setup & evaluator methods ───────────────────────────

  addSetupNote(note: string): void {
    this.update({ setupNotes: [...this.state.setupNotes, note] });
  }

  setEvalStatus(status: EvalStatus): void {
    this.update({ evalStatus: status });
  }

  dismissEvalStatus(): void {
    this.update({ evalStatus: { ...this.state.evalStatus, dismissed: true } });
  }

  cancelEval(): void {
    this.update({ evalStatus: { ...this.state.evalStatus, cancelled: true } });
  }

  setRunStartMs(ms: number): void {
    this.update({ runStartMs: ms });
  }

  setTokenUsage(usage: { inputTokens: number; outputTokens: number }): void {
    this.update({ tokenUsage: usage });
  }

  setSummary(summary: ContentSummary): void {
    this.update({ summary });
  }

  setFirstRun(isFirstRun: boolean): void {
    this.update({ isFirstRun });
  }

  setDiffSummary(diffSummary: DiffSummary | undefined): void {
    this.update({ diffSummary });
  }

  setCompact(compact: boolean): void {
    this.update({ compact });
  }

  // ── v2: Assessment methods ──────────────────────────────

  /** Push assessments from a file change evaluation. */
  pushAssessments(assessments: ChangeAssessment[]): void {
    const stats = { ...this.state.assessmentStats };
    stats.changes++;
    let hasNonOk = false;
    for (const a of assessments) {
      if (a.type === 'ok') stats.ok++;
      else if (a.type === 'warning') { stats.warnings++; hasNonOk = true; }
      else if (a.type === 'violation') { stats.violations++; hasNonOk = true; }
    }

    const actionable = assessments.filter((a) => a.type !== 'ok');
    const newQueue = [...this.state.pendingAssessments, ...actionable];
    const consecutive = hasNonOk ? 0 : this.state.consecutiveOk + 1;

    this.update({
      assessmentStats: stats,
      pendingAssessments: newQueue,
      consecutiveOk: consecutive,
    });

    // Auto-advance if no current assessment
    if (!this.state.currentAssessment && newQueue.length > 0) {
      this.advanceAssessment();
    }
  }

  /** Move to the next pending assessment. */
  advanceAssessment(): void {
    const queue = [...this.state.pendingAssessments];
    const next = queue.shift() ?? null;
    this.update({ currentAssessment: next, pendingAssessments: queue });
  }

  /** Record a user action on the current assessment and advance. */
  resolveAssessment(action: 'dismiss' | 'confirm'): void {
    const stats = { ...this.state.assessmentStats };
    if (action === 'dismiss') stats.dismissed++;
    else stats.confirmed++;
    this.update({ assessmentStats: stats });
    this.advanceAssessment();
  }

  setPreferenceCount(count: number): void {
    this.update({ preferenceCount: count });
  }

  setLearnedMessage(msg: string): void {
    this.update({ learnedMessage: msg });
  }

  setRecommendProbe(recommend: boolean): void {
    this.update({ recommendProbe: recommend });
  }

  setLastChangeFlash(msg: string): void {
    this.update({ lastChangeFlash: msg });
  }

  incrementAddCount(): void {
    this.update({ addCount: this.state.addCount + 1 });
  }

  incrementChangeCount(): void {
    this.update({ changeCount: this.state.changeCount + 1 });
  }

  setCorrectionCount(n: number): void {
    this.update({ correctionCount: n });
  }

  setDreamPrompt(show: boolean): void {
    this.update({ dreamPrompt: show });
  }

  setDreaming(dreaming: boolean): void {
    this.update({ dreaming });
  }

  setManagedFiles(files: ManagedFile[]): void {
    this.update({ managedFiles: files });
  }

  setSessionUsage(usage: DashboardState['sessionUsage']): void {
    this.update({ sessionUsage: usage });
  }

  setUpdateMessage(msg: string): void {
    this.update({ updateMessage: msg });
  }

  setSyncStatus(syncStatus: DashboardState['syncStatus']): void {
    this.update({
      syncStatus,
      ...(syncStatus === 'synced' ? { lastSyncAt: Date.now() } : {}),
    });
  }

  setSuggestions(suggestions: DashboardState['suggestions']): void {
    this.update({ suggestions });
  }

  dismissSuggestions(): void {
    this.update({ suggestionsDismissed: true });
  }

  setTierInfo(tier: DashboardState['userTier'], used: number, cap: number, resetAt?: string): void {
    this.update({ userTier: tier, tierTokensUsed: used, tierTokensCap: cap, tierResetAt: resetAt ?? '' });
  }

  addTierTokens(tokens: number): void {
    this.update({ tierTokensUsed: this.state.tierTokensUsed + tokens });
  }

  setTierExhausted(): void {
    this.update({ tierExhausted: true });
  }

  /** Update a single managed file's annotation or timestamp. */
  touchManagedFile(filePath: string, annotation?: string): void {
    const files = this.state.managedFiles.map((f) =>
      f.path === filePath
        ? { ...f, updatedAt: Date.now(), ...(annotation !== undefined ? { annotation } : {}) }
        : f,
    );
    this.update({ managedFiles: files });
  }

  /** Reset per-run state for a fresh pipeline run. */
  resetRun(): void {
    this.update({
      warning: '',
      outputs: [],
      reasoning: [],
      setupNotes: [],
      evalStatus: { phase: 'idle' },
      runStartMs: 0,
      elapsed: '',
      provider: '',
      phaseDetail: '',
      tokenUsage: undefined,
      summary: undefined,
      diffSummary: undefined,
      recommendProbe: false,
      lastChangeFlash: '',
      addCount: 0,
      changeCount: 0,
      dreamPrompt: false,
      dreaming: false,
      // NOTE: tierExhausted is NOT reset here — it persists until CLI restart
      // so the upgrade prompt stays visible across probe-and-refine runs.
    });
  }
}

/** Singleton — created once, shared across pipeline + UI. */
export const store = new DashboardStore();
