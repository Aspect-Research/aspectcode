/**
 * Dashboard — ink-based CLI dashboard with memory map and real-time assessments.
 *
 * Layout:
 *   Header → Memory Map → (Working status | Eval progress) →
 *   Assessment area → Status bar
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Key } from 'ink';
import { COLORS } from './theme';
import { store } from './store';
import type { DashboardState, PipelinePhase, EvalPhase } from './store';
import MemoryMap from './MemoryMap';

// ── Spinner ──────────────────────────────────────────────────

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DREAM_FRAMES = ['✦', '◆', '✦', '◇'];

function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(id);
  }, [active]);
  return FRAMES[frame];
}

function useDreamSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % DREAM_FRAMES.length), 400);
    return () => clearInterval(id);
  }, [active]);
  return DREAM_FRAMES[frame];
}

// ── Auto-dismiss eval status when cancelled ──────────────────

function useAutoDismissEval(evalDone: boolean, cancelled: boolean): void {
  useEffect(() => {
    if (!evalDone || !cancelled) return;
    const id = setTimeout(() => store.dismissEvalStatus(), 5000);
    return () => clearTimeout(id);
  }, [evalDone, cancelled]);
}

// ── Auto-clear hooks ─────────────────────────────────────────

function useAutoMessage(msg: string, clearFn: () => void, durationMs = 4000): string {
  const [visible, setVisible] = useState(msg);
  useEffect(() => {
    if (!msg) { setVisible(''); return; }
    setVisible(msg);
    const id = setTimeout(() => { setVisible(''); clearFn(); }, durationMs);
    return () => clearTimeout(id);
  }, [msg]);
  return visible;
}

// ── Slow pulse for watching indicator ─────────────────────────

const PULSE_FRAMES = ['●', '●', '○', '○'];

function usePulse(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % PULSE_FRAMES.length), 1500);
    return () => clearInterval(id);
  }, [active]);
  return PULSE_FRAMES[frame];
}

// ── Tick for relative timestamps ─────────────────────────────

function useTick(intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
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

// ── Eval progress text ───────────────────────────────────────

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
      return `${round}Testing guidelines${progress}…`;
    }
    case 'judging': {
      const progress = s.judgedCount !== undefined && s.probesTotal !== undefined
        ? ` (${s.judgedCount}/${s.probesTotal})`
        : '';
      return `${round}Reviewing results${progress}…`;
    }
    case 'diagnosing': {
      const detail = s.weakCount !== undefined && s.strongCount !== undefined
        ? ` — ${s.strongCount} passed, ${s.weakCount} gap${s.weakCount === 1 ? '' : 's'}`
        : '';
      return `${round}Identifying improvements${detail}…`;
    }
    case 'applying': {
      const count = s.proposedEditCount ? ` ${s.proposedEditCount}` : '';
      return `${round}Applying${count} improvement${s.proposedEditCount === 1 ? '' : 's'}…`;
    }
    case 'done': {
      const edits = s.diagnosisEdits ?? 0;
      const rounds = s.iterationSummaries?.length ?? 0;
      const roundNote = rounds > 1 ? ` across ${rounds} rounds` : '';
      if (s.cancelled) {
        return edits > 0
          ? `Cancelled — ${edits} improvement${edits === 1 ? '' : 's'} applied${roundNote}`
          : 'Cancelled — no changes applied';
      }
      return edits > 0
        ? `Complete — ${edits} improvement${edits === 1 ? '' : 's'} applied${roundNote}`
        : 'Complete — no changes needed';
    }
  }
}

// ── Separator line ───────────────────────────────────────────

const SEP_CHAR = '┄';

// ── Component ────────────────────────────────────────────────

const Dashboard: React.FC = () => {
  const [s, setS] = useState<DashboardState>({ ...store.state });
  useEffect(() => {
    const fn = () => setS({ ...store.state });
    store.on('change', fn);
    return () => { store.removeListener('change', fn); };
  }, []);

  // Force re-render every 10s so relative timestamps update
  useTick(10_000);

  // ── Keyboard handling ──────────────────────────────────────
  useInput((input: string, _key: Key) => {
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

    if (input === 'r') { handler({ type: 'probe-and-refine' }); return; }
    if (input === 'l' && !store.state.userEmail) {
      handler({ type: 'login' });
      return;
    }
    if (input === 'd') {
      if (store.state.correctionCount === 0) {
        store.setLearnedMessage('no corrections to dream on yet');
      } else {
        handler({ type: 'dream' });
      }
      return;
    }

    if (!current) return;
    if (input === 'n') {
      handler({ type: 'dismiss', assessment: current });
    } else if (input === 'y') {
      if (current.suggestion) {
        process.stderr.write(`\n  Suggestion:\n  ${current.suggestion}\n\n`);
      }
      handler({ type: 'confirm', assessment: current });
    } else if (input === 's') {
      handler({ type: 'skip', assessment: current });
    }
  });

  const working = WORKING.has(s.phase);
  const isWatching = s.phase === 'watching';
  const spinner = useSpinner(working || s.dreaming);
  const dreamSpinner = useDreamSpinner(s.dreaming);
  const pulse = usePulse(isWatching);
  const detail = s.phaseDetail ? ` (${s.phaseDetail})` : '';
  const evalLabel = evalText(s.evalStatus.phase, s.evalStatus);
  const evalDone = s.evalStatus.phase === 'done';
  const evalActive = s.evalStatus.phase !== 'idle';
  const learnedMsg = useAutoMessage(s.learnedMessage, () => store.setLearnedMessage(''));
  const changeFlash = useAutoMessage(s.lastChangeFlash, () => store.setLastChangeFlash(''));
  const current = s.currentAssessment;
  const queueLen = s.pendingAssessments.length;

  // Auto-dismiss cancelled eval status after 5s
  useAutoDismissEval(evalDone, s.evalStatus.cancelled ?? false);

  // ── Build header info ──────────────────────────────────────
  const rootLabel = s.rootPath ? s.rootPath.replace(/\\/g, '/').split('/').pop() || s.rootPath : '';

  return (
    <Box flexDirection="column">

      {/* ── Header ──────────────────────────────── */}
      <Text>
        <Text color={COLORS.primary} bold>{'◆ aspect code'}</Text>
        {rootLabel ? <Text color={COLORS.gray}>{` ${SEP_CHAR} ${rootLabel}`}</Text> : null}
        {s.activePlatform ? <Text color={COLORS.gray}>{` ${SEP_CHAR} ${s.activePlatform}`}</Text> : null}
      </Text>

      {/* ── Working status (during pipeline) ──────── */}
      {working && s.phase !== 'evaluating' && (
        <Text color={COLORS.primary}>
          {`${spinner} ${PHASE_TEXT[s.phase]}${detail}`}
          {s.phase === 'analyzing' && s.fileCount > 0 && (
            <Text color={COLORS.gray}>{` — ${s.fileCount.toLocaleString()} files, ${s.edgeCount.toLocaleString()} edges`}</Text>
          )}
          {s.phase === 'optimizing' && s.provider && (
            <Text color={COLORS.gray}>{` — ${s.provider}`}</Text>
          )}
        </Text>
      )}

      {/* ── First-run hint ────────────────────────── */}
      {s.isFirstRun && working && (
        <Text color={COLORS.gray}>{'Analyzing your codebase to generate AGENTS.md'}</Text>
      )}

      {/* ── Memory map (always visible once populated) ── */}
      {s.managedFiles.length > 0 && (
        <Box marginTop={0}>
          <MemoryMap files={s.managedFiles} dreaming={s.dreaming} userEmail={s.userEmail} />
        </Box>
      )}

      {/* ── Evaluator progress ────────────────────── */}
      {evalActive && evalLabel && !s.evalStatus.dismissed && (
        <Box flexDirection="column">
          <Text color={evalDone ? COLORS.primary : COLORS.primaryDim}>
            {evalDone ? evalLabel : `${spinner} ${evalLabel}`}
            {!evalDone && !s.evalStatus.cancelled ? '  [x] cancel' : ''}
            {evalDone ? '  [c] clear' : ''}
          </Text>
          {s.evalStatus.iterationSummaries && s.evalStatus.iterationSummaries.map((summary, i) => (
            <Text key={`iter-${i}`} color={COLORS.gray}>{`├ ${summary}`}</Text>
          ))}
          {evalDone && s.evalStatus.editSummaries && s.evalStatus.editSummaries.length > 0 && (
            <>
              {s.evalStatus.editSummaries.slice(0, 5).map((line, i, arr) => {
                const isLast = i === arr.length - 1 && (s.evalStatus.editSummaries?.length ?? 0) <= 5;
                return <Text key={`edit-${i}`} color={COLORS.gray}>{`${isLast ? '└' : '├'} ${line}`}</Text>;
              })}
              {s.evalStatus.editSummaries.length > 5 && (
                <Text color={COLORS.gray}>{`└ +${s.evalStatus.editSummaries.length - 5} more`}</Text>
              )}
            </>
          )}
        </Box>
      )}

      {/* ── Warning ──────────────────────────────── */}
      {s.warning !== '' && (
        <Text color={COLORS.yellow}>{`● ${s.warning}`}</Text>
      )}

      {/* ── Watching indicator ─────────────────────── */}
      {isWatching && (
        <Text color={COLORS.gray}>
          {`${pulse} watching`}
          {s.tokenUsage && (
            <Text color={COLORS.gray}>{` — ${s.tokenUsage.inputTokens.toLocaleString()} in / ${s.tokenUsage.outputTokens.toLocaleString()} out tokens`}</Text>
          )}
          {s.userEmail && s.syncStatus === 'synced' && s.lastSyncAt > 0 && (
            <Text color={COLORS.gray}>{` — ☁  synced`}</Text>
          )}
          {s.userEmail && s.syncStatus === 'offline' && (
            <Text color={COLORS.yellow}>{` — ☁  offline`}</Text>
          )}
        </Text>
      )}

      {/* ── Dream cycle in progress ───────────────── */}
      {s.dreaming && (
        <Text color={COLORS.primary}>{`${dreamSpinner} dreaming — refining from ${s.correctionCount} correction${s.correctionCount === 1 ? '' : 's'}…`}</Text>
      )}

      {/* ── Assessment area ───────────────────────── */}
      {!s.dreaming && current && (current.type === 'warning' || current.type === 'violation') && (
        <Box flexDirection="column">
          <Box>
            <Text color={current.type === 'violation' ? COLORS.red : COLORS.yellow}>
              {current.type === 'violation' ? '✗ ' : '⚠ '}
            </Text>
            <Text color={COLORS.white} bold>{current.file}</Text>
          </Box>
          <Text color={COLORS.gray}>{`  ${current.rule} · ${current.message}`}</Text>
          {current.details ? (
            <Text color={COLORS.gray}>{`  ${current.details}`}</Text>
          ) : null}
          <Box>
            <Text color={COLORS.gray}>{'  [y] confirm  [n] dismiss  [s] skip'}</Text>
            {queueLen > 0 && (
              <Text color={COLORS.gray}>{`       (1 of ${queueLen + 1})`}</Text>
            )}
          </Box>
        </Box>
      )}

      {/* ── OK flash (auto-clears) ────────────────── */}
      {!s.dreaming && !current && changeFlash !== '' && isWatching && (
        <Text color={COLORS.gray}>{`✓ ${changeFlash}`}</Text>
      )}

      {/* ── Learned message (auto-clears) ─────────── */}
      {learnedMsg !== '' && (
        <Text color={COLORS.primary}>{`● ${learnedMsg}`}</Text>
      )}

      {/* ── Dream prompt ──────────────────────────── */}
      {s.dreamPrompt && !s.dreaming && isWatching && (
        <Box flexDirection="column">
          <Text color={COLORS.yellow}>{`✦ ${s.correctionCount} corrections — press d to refine`}</Text>
          {s.assessmentStats.confirmed > 0 || s.assessmentStats.dismissed > 0 ? (
            <Text color={COLORS.gray}>{`  confirmed: ${s.assessmentStats.confirmed} · dismissed: ${s.assessmentStats.dismissed}`}</Text>
          ) : null}
        </Box>
      )}

      {/* ── Status bar ────────────────────────────── */}
      {isWatching && (
        <Text color={COLORS.gray} dimColor>
          {(() => {
            const stats = s.assessmentStats;
            const parts: string[] = [];
            parts.push(`${stats.changes} changes`);
            if (stats.ok > 0) parts.push(`${stats.ok} ok`);
            if (stats.warnings > 0) parts.push(`${stats.warnings} warnings`);
            if (stats.violations > 0) parts.push(`${stats.violations} violations`);
            if (s.correctionCount > 0) parts.push(`${s.correctionCount} corrections`);
            if (s.preferenceCount > 0) parts.push(`${s.preferenceCount} learned`);
            return parts.join(' · ');
          })()}
        </Text>
      )}
      {isWatching && (
        <Text>
          <Text color={s.correctionCount > 0 ? COLORS.primaryDim : COLORS.gray} dimColor={s.correctionCount === 0}>{'[d] dream'}</Text>
          <Text color={COLORS.primaryDim}>{'  [r] probe & refine'}</Text>
          {s.recommendProbe ? <Text color={COLORS.primary}>{' ●'}</Text> : null}
        </Text>
      )}
    </Box>
  );
};

export default Dashboard;
