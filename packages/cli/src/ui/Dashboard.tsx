/**
 * Dashboard — ink-based CLI dashboard with real-time change assessments.
 *
 * v2 layout:
 *   Banner → Setup → Status → Eval progress → Summary →
 *   Assessment display → Status line (persistent)
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Key } from 'ink';
import { COLORS, getBannerText } from './theme';
import { store } from './store';
import type { DashboardState, PipelinePhase, EvalPhase } from './store';

// ── Spinner ──────────────────────────────────────────────────

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(id);
  }, [active]);
  return FRAMES[frame];
}

// ── Live elapsed timer ───────────────────────────────────────

function useElapsedTimer(startMs: number, finalElapsed: string, isWorking: boolean): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isWorking || startMs === 0) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [isWorking, startMs]);

  if (finalElapsed) return finalElapsed;
  if (startMs === 0 || !isWorking) return '';
  return `${((now - startMs) / 1000).toFixed(1)}s`;
}

// ── Auto-clear learned message ───────────────────────────────

function useLearnedMessage(msg: string): string {
  const [visible, setVisible] = useState(msg);
  useEffect(() => {
    if (!msg) { setVisible(''); return; }
    setVisible(msg);
    const id = setTimeout(() => {
      setVisible('');
      store.setLearnedMessage('');
    }, 4000);
    return () => clearTimeout(id);
  }, [msg]);
  return visible;
}

// ── Auto-clear change flash ───────────────────────────────

function useChangeFlash(msg: string): string {
  const [visible, setVisible] = useState(msg);
  useEffect(() => {
    if (!msg) { setVisible(''); return; }
    setVisible(msg);
    const id = setTimeout(() => {
      setVisible('');
      store.setLastChangeFlash('');
    }, 4000);
    return () => clearTimeout(id);
  }, [msg]);
  return visible;
}

// ── Phase labels ─────────────────────────────────────────────

const PHASE_TEXT: Record<PipelinePhase, string> = {
  idle:          'Starting…',
  discovering:   'Discovering files…',
  analyzing:     'Analyzing…',
  'building-kb': 'Building knowledge base…',
  optimizing:    'Generating…',
  evaluating:    'Evaluating…',
  writing:       'Writing…',
  watching:      'Watching',
  done:          'Done',
  error:         'Error',
};

const WORKING = new Set<PipelinePhase>([
  'idle', 'discovering', 'analyzing', 'building-kb', 'optimizing', 'evaluating', 'writing',
]);

// ── Helpers ──────────────────────────────────────────────────

function statsText(s: DashboardState, liveElapsed: string): string {
  const parts: string[] = [];
  if (s.fileCount > 0) parts.push(`${s.fileCount} files`);
  if (s.edgeCount > 0) parts.push(`${s.edgeCount} edges`);
  if (s.provider)       parts.push(s.provider);
  const elapsed = liveElapsed || s.elapsed;
  if (elapsed)          parts.push(elapsed);
  return parts.length > 0 ? parts.join(' · ') : '';
}

/** Primary eval progress line — shown with spinner during active refinement. */
function evalText(phase: EvalPhase, s: DashboardState['evalStatus']): string | null {
  const round = s.iteration && s.maxIterations
    ? `Round ${s.iteration}/${s.maxIterations}: `
    : '';
  switch (phase) {
    case 'idle': return null;
    case 'generating-probes':
      return `${round}Creating test scenarios…`;
    case 'probing': {
      const progress = s.probesPassed !== undefined && s.probesTotal !== undefined
        ? ` (${s.probesPassed}/${s.probesTotal})`
        : '';
      const task = s.currentProbeTask ? ` — ${s.currentProbeTask}` : '';
      return `${round}Testing guidelines${progress}…${task}`;
    }
    case 'judging': {
      const progress = s.judgedCount !== undefined && s.probesTotal !== undefined
        ? ` (${s.judgedCount}/${s.probesTotal})`
        : '';
      const task = s.currentProbeTask ? ` — ${s.currentProbeTask}` : '';
      return `${round}Reviewing results${progress}…${task}`;
    }
    case 'diagnosing': {
      const detail = s.weakCount !== undefined && s.strongCount !== undefined
        ? ` — ${s.strongCount} passed, ${s.weakCount} gap${s.weakCount === 1 ? '' : 's'} found`
        : '';
      return `${round}Identifying improvements${detail}…`;
    }
    case 'applying': {
      const count = s.proposedEditCount ? ` ${s.proposedEditCount}` : '';
      return `${round}Applying${count} improvement${s.proposedEditCount === 1 ? '' : 's'} to AGENTS.md…`;
    }
    case 'done': {
      const edits = s.diagnosisEdits ?? 0;
      const rounds = s.iterationSummaries?.length ?? 0;
      const roundNote = rounds > 1 ? ` across ${rounds} rounds` : '';
      let label: string;
      if (s.cancelled) {
        label = edits > 0
          ? `Refinement cancelled — ${edits} improvement${edits === 1 ? '' : 's'} applied${roundNote}`
          : 'Refinement cancelled — no changes applied';
      } else {
        label = edits > 0
          ? `Refinement complete — ${edits} improvement${edits === 1 ? '' : 's'} applied${roundNote}`
          : 'Refinement complete — no changes needed';
      }
      return `${label}  [c] clear`;
    }
  }
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ── Component ────────────────────────────────────────────────

const FIRST_RUN_VISIBLE = new Set<PipelinePhase>(['idle', 'discovering', 'analyzing']);

const Dashboard: React.FC = () => {
  const [s, setS] = useState<DashboardState>({ ...store.state });
  useEffect(() => {
    const fn = () => setS({ ...store.state });
    store.on('change', fn);
    return () => { store.removeListener('change', fn); };
  }, []);

  // ── Keyboard handling ──────────────────────────────────────
  useInput((input: string, _key: Key) => {
    // Global keys (no handler needed)
    if (input === 'x') {
      const evalPhase = store.state.evalStatus.phase;
      if (evalPhase !== 'idle' && evalPhase !== 'done') {
        store.cancelEval();
      }
      return;
    }
    if (input === 'c') {
      store.dismissEvalStatus();
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (store as any)._onAssessmentAction as ((a: any) => void) | undefined;
    if (!handler) return;

    const current = store.state.currentAssessment;

    if (input === 'r') {
      handler({ type: 'probe-and-refine' });
      return;
    }

    // Assessment keys (only when an assessment is shown)
    if (!current) return;

    if (input === 'n') {
      handler({ type: 'dismiss', assessment: current });
    } else if (input === 'y') {
      // Print suggestion prominently
      if (current.suggestion) {
        process.stderr.write(`\n  Suggestion:\n  ${current.suggestion}\n\n`);
      }
      handler({ type: 'confirm', assessment: current });
    } else if (input === 's') {
      handler({ type: 'skip', assessment: current });
    }
  });

  const compact = s.compact;
  const working = WORKING.has(s.phase);
  const spinner = useSpinner(working);
  const liveElapsed = useElapsedTimer(s.runStartMs, s.elapsed, working);
  const stats = statsText(s, liveElapsed);
  const detail = s.phaseDetail ? ` (${s.phaseDetail})` : '';
  const setup = s.setupNotes.length > 0 ? s.setupNotes.join(' · ') : '';
  const evalLabel = evalText(s.evalStatus.phase, s.evalStatus);
  const evalDone = s.evalStatus.phase === 'done';
  const evalActive = s.evalStatus.phase !== 'idle';
  const isDone = s.phase === 'done' || s.phase === 'watching';
  const learnedMsg = useLearnedMessage(s.learnedMessage);

  const changeFlash = useChangeFlash(s.lastChangeFlash);
  const current = s.currentAssessment;
  const queueLen = s.pendingAssessments.length;

  return (
    <Box flexDirection="column">
      {/* ── Banner ──────────────────────────────── */}
      {!compact && (
        <Box marginBottom={0}>
          <Text color={COLORS.primary} bold>{getBannerText()}</Text>
        </Box>
      )}

      {/* ── First-run ────────────────────────────── */}
      {s.isFirstRun && FIRST_RUN_VISIBLE.has(s.phase) && (
        <Box marginBottom={0}>
          <Text color={COLORS.gray}>
            {'  Analyzing your codebase to generate AGENTS.md — the coding\n  guidelines AI assistants follow in this project.'}
          </Text>
        </Box>
      )}

      {/* ── Setup notes ──────────────────────────── */}
      {setup !== '' && !(compact && !s.warning) && (
        <Box marginTop={1}>
          <Text color={COLORS.gray}>{`  ${setup}`}</Text>
        </Box>
      )}

      {/* ── Status line ──────────────────────────── */}
      <Box>
        {working && s.phase !== 'evaluating' && (
          <Text color={COLORS.primary}>{`  ${spinner} ${PHASE_TEXT[s.phase]}${detail}`}</Text>
        )}
        {s.phase === 'watching' && !current && (
          <Text color={COLORS.primary} bold>{'  ● Watching for changes'}</Text>
        )}
        {s.phase === 'done' && s.outputs.length > 0 && (
          <Text color={COLORS.primary}>{`  ● ${s.outputs.join(', ')}`}</Text>
        )}
        {s.phase === 'done' && s.outputs.length === 0 && (
          <Text color={COLORS.primary}>{'  ● Done'}</Text>
        )}
        {s.phase === 'error' && (
          <Text color={COLORS.yellow}>{'  ● Error'}</Text>
        )}
        {stats !== '' && !working && isDone && (
          <Text color={COLORS.gray}>{`  ${stats}`}</Text>
        )}
      </Box>

      {/* ── Evaluator progress ────────────────────── */}
      {evalActive && evalLabel && !s.evalStatus.dismissed && (
        <Box flexDirection="column">
          {/* Primary eval line (with spinner when active, cancel hint) */}
          <Text color={evalDone ? COLORS.primary : COLORS.primaryDim}>
            {evalDone ? `  ${evalLabel}` : `  ${spinner} ${evalLabel}`}
            {!evalDone && !s.evalStatus.cancelled ? '  [x] cancel' : ''}
          </Text>

          {/* Iteration summaries (accumulated, shown during and after loop) */}
          {s.evalStatus.iterationSummaries && s.evalStatus.iterationSummaries.map((summary, i) => (
            <Text key={`iter-${i}`} color={COLORS.gray}>{`  ├ ${summary}`}</Text>
          ))}

          {/* Edit summaries (shown when done) */}
          {evalDone && s.evalStatus.editSummaries && s.evalStatus.editSummaries.length > 0 && (
            <>
              {s.evalStatus.editSummaries.slice(0, 5).map((line, i, arr) => {
                const isLast = i === arr.length - 1 && (s.evalStatus.editSummaries?.length ?? 0) <= 5;
                return (
                  <Text key={`edit-${i}`} color={COLORS.gray}>{`  ${isLast ? '└' : '├'} ${line}`}</Text>
                );
              })}
              {s.evalStatus.editSummaries.length > 5 && (
                <Text color={COLORS.gray}>{`  └ +${s.evalStatus.editSummaries.length - 5} more`}</Text>
              )}
            </>
          )}
        </Box>
      )}

      {/* ── Token usage ──────────────────────────── */}
      {s.tokenUsage && isDone && !current && (
        <Text color={COLORS.gray}>
          {`  ${fmtTokens(s.tokenUsage.inputTokens)} in · ${fmtTokens(s.tokenUsage.outputTokens)} out`}
        </Text>
      )}

      {/* ── Diff summary ─────────────────────────── */}
      {s.diffSummary && s.diffSummary.changed && isDone && !current && (
        <Text color={COLORS.gray}>
          {`  ↳ AGENTS.md: ` +
            (s.diffSummary.added > 0 ? `+${s.diffSummary.added} lines` : '') +
            (s.diffSummary.added > 0 && s.diffSummary.removed > 0 ? ', ' : '') +
            (s.diffSummary.removed > 0 ? `-${s.diffSummary.removed} lines` : '')}
        </Text>
      )}

      {/* ── Warning ──────────────────────────────── */}
      {s.warning !== '' && (
        <Box marginTop={0}>
          <Text color={COLORS.yellow}>{`  ● ${s.warning}`}</Text>
        </Box>
      )}

      {/* ══ v2: Current assessment ═══════════════════ */}
      {current && current.type === 'warning' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.yellow} bold>
            {`  ● ${current.file}`}
            {queueLen > 0 ? ` (1 of ${queueLen + 1})` : ''}
          </Text>
          <Text color={COLORS.yellow}>{`    ${current.message}`}</Text>
          {current.details && (
            <Text color={COLORS.gray}>{`    ${current.details}`}</Text>
          )}
          {current.suggestion && (
            <Text color={COLORS.gray}>{`    → ${current.suggestion}`}</Text>
          )}
          <Text color={COLORS.gray}>
            {'    [y] confirm  [n] dismiss (learn)  [s] skip'}
          </Text>
        </Box>
      )}

      {current && current.type === 'violation' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.yellow} bold>
            {`  ● ${current.file}`}
            {queueLen > 0 ? ` (1 of ${queueLen + 1})` : ''}
          </Text>
          <Text color={COLORS.yellow}>{`    ${current.message}`}</Text>
          {current.details && (
            <Text color={COLORS.gray}>{`    ${current.details}`}</Text>
          )}
          {current.suggestion && (
            <Text color={COLORS.gray}>{`    → ${current.suggestion}`}</Text>
          )}
          <Text color={COLORS.gray}>
            {'    [y] confirm  [n] dismiss (learn)  [s] skip'}
          </Text>
        </Box>
      )}

      {/* ── Learned message (auto-clears) ─────────── */}
      {learnedMsg !== '' && (
        <Text color={COLORS.primary}>{`  ● ${learnedMsg}`}</Text>
      )}

      {/* ══ v2: Persistent status line ════════════════ */}
      {isDone && s.phase === 'watching' && (
        <Box flexDirection="column" marginTop={1}>
          {/* Change flash or recommend nudge (fixed slot, doesn't shift status line) */}
          {changeFlash !== '' && !current ? (
            <Text color={COLORS.primary}>{`  ● ${changeFlash}`}</Text>
          ) : s.recommendProbe && !current ? (
            <Text color={COLORS.primary}>
              {`  ↻ ${s.addCount + s.changeCount} file changes since last run`}
            </Text>
          ) : (
            <Text>{' '}</Text>
          )}
          <Box>
            <Text color={COLORS.white}>
              {(() => {
                const pending = queueLen + (current ? 1 : 0);
                const fileParts: string[] = [];
                if (s.addCount > 0) fileParts.push(`${s.addCount} new`);
                if (s.changeCount > 0) fileParts.push(`${s.changeCount} modified`);
                const fileLabel = fileParts.length > 0 ? fileParts.join(' · ') : '0 changes';
                return `  ${fileLabel}` +
                  (pending > 0 ? ` · ${pending} pending` : '') +
                  (s.preferenceCount > 0 ? ` · ${s.preferenceCount} preferences saved` : '') +
                  `  `;
              })()}
            </Text>
            <Text color={COLORS.primaryDim}>{'[r] probe & refine'}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default Dashboard;
