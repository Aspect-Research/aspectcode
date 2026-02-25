/**
 * Dashboard — condensed ink-based CLI dashboard.
 *
 * Layout:
 *   Banner
 *   Setup notes   (config, API key, tool files — compact single line)
 *   Status line   (spinner/icon + phase + stats)
 *   Eval progress (harvest → probes → diagnosis — shown during/after evaluation)
 *   [Detail]      (change trigger, outputs, warning, reasoning)
 *   Complaint input (only during idle/done/watching)
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

  // Use the final value once set
  if (finalElapsed) return finalElapsed;
  if (startMs === 0) return '';
  if (!isWorking) return '';

  const ms = now - startMs;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Phase labels ─────────────────────────────────────────────

const PHASE_TEXT: Record<PipelinePhase, string> = {
  idle:          'Starting…',
  discovering:   'Discovering files…',
  analyzing:     'Analyzing…',
  'building-kb': 'Building knowledge base…',
  optimizing:    'Optimizing…',
  evaluating:    'Evaluating…',
  writing:       'Writing…',
  watching:      'Watching',
  done:          'Done',
  error:         'Error',
};

const WORKING = new Set<PipelinePhase>([
  'idle', 'discovering', 'analyzing', 'building-kb', 'optimizing', 'evaluating', 'writing',
]);

// ── Stats string ─────────────────────────────────────────────

function statsText(s: DashboardState, liveElapsed: string): string {
  const parts: string[] = [];
  if (s.fileCount > 0) parts.push(`${s.fileCount} files`);
  if (s.edgeCount > 0) parts.push(`${s.edgeCount} edges`);
  if (s.provider)       parts.push(s.provider);
  const elapsed = liveElapsed || s.elapsed;
  if (elapsed)          parts.push(elapsed);
  return parts.length > 0 ? parts.join(' · ') : '';
}

// ── Setup notes line ─────────────────────────────────────────

function setupLine(notes: string[]): string {
  if (notes.length === 0) return '';
  return notes.join(' · ');
}

// ── Eval status text ─────────────────────────────────────────

function evalText(phase: EvalPhase, s: DashboardState['evalStatus']): string | null {
  switch (phase) {
    case 'idle': return null;
    case 'harvesting':
      return s.harvestCount !== undefined
        ? `Harvested ${s.harvestCount} prompt${s.harvestCount === 1 ? '' : 's'}`
        : 'Harvesting prompts…';
    case 'probing':
      return s.probesPassed !== undefined && s.probesTotal !== undefined
        ? `Probes: ${s.probesPassed}/${s.probesTotal} passed`
        : 'Running probes…';
    case 'diagnosing':
      return 'Diagnosing failures…';
    case 'done':
      if (s.probesPassed !== undefined && s.probesTotal !== undefined) {
        const parts = [`${s.probesPassed}/${s.probesTotal} probes passed`];
        if (s.diagnosisEdits && s.diagnosisEdits > 0) {
          parts.push(`${s.diagnosisEdits} fix${s.diagnosisEdits === 1 ? '' : 'es'} applied`);
        }
        return parts.join(' · ');
      }
      return 'Evaluation complete';
  }
}

// ── Component ────────────────────────────────────────────────

/** Phases where the complaint input and hints are shown. */
const INPUT_VISIBLE = new Set<PipelinePhase>(['watching', 'done']);

const Dashboard: React.FC = () => {
  const [s, setS] = useState<DashboardState>({ ...store.state });
  useEffect(() => {
    const fn = () => setS({ ...store.state });
    store.on('change', fn);
    return () => { store.removeListener('change', fn); };
  }, []);

  // ── Complaint text input via useInput ────────────────────
  useInput((input: string, key: Key) => {
    if (key.return) {
      const text = store.state.complaintInput.trim();
      if (text.length > 0) {
        store.queueComplaint(text);
      }
      return;
    }
    if (key.backspace || key.delete) {
      const cur = store.state.complaintInput;
      if (cur.length > 0) {
        store.setComplaintInput(cur.slice(0, -1));
      }
      return;
    }
    if (key.escape) {
      store.setComplaintInput('');
      return;
    }
    // Ignore control / arrow / meta keys
    if (key.ctrl || key.meta || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.tab) {
      return;
    }
    if (input) {
      store.setComplaintInput(store.state.complaintInput + input);
    }
  });

  const working = WORKING.has(s.phase);
  const spinner = useSpinner(working || s.processingComplaint);
  const liveElapsed = useElapsedTimer(s.runStartMs, s.elapsed, working);
  const stats = statsText(s, liveElapsed);
  const detail = s.phaseDetail ? ` (${s.phaseDetail})` : '';
  const setup = setupLine(s.setupNotes);
  const evalLabel = evalText(s.evalStatus.phase, s.evalStatus);
  const evalDone = s.evalStatus.phase === 'done';
  const evalActive = s.evalStatus.phase !== 'idle';
  const allPassed = s.evalStatus.probesPassed === s.evalStatus.probesTotal;

  return (
    <Box flexDirection="column">
      {/* ── Banner ───────────────────────────────────── */}
      <Box marginBottom={0}>
        <Text color={COLORS.primary} bold>{getBannerText()}</Text>
      </Box>

      {/* ── Complaint input (right below banner) ─────── */}
      {INPUT_VISIBLE.has(s.phase) && !s.processingComplaint && (
        <Box marginTop={0}>
          <Text color={COLORS.primary}>{'  ❯ '}</Text>
          <Text color={COLORS.white}>{s.complaintInput}</Text>
          <Text color={COLORS.primaryDim}>{'▌'}</Text>
        </Box>
      )}

      {/* ── Queued complaints indicator ──────────────── */}
      {s.complaintQueue.length > 0 && (
        <Text color={COLORS.primaryDim}>
          {`  ${s.complaintQueue.length} complaint${s.complaintQueue.length === 1 ? '' : 's'} queued`}
        </Text>
      )}

      {/* ── Hints ────────────────────────────────────── */}
      {s.phase === 'watching' && (
        <Text color={COLORS.gray} dimColor>{'  Type a complaint above, or Ctrl+C to stop'}</Text>
      )}
      {s.phase === 'done' && (
        <Text color={COLORS.gray} dimColor>{'  Type a complaint above to refine AGENTS.md'}</Text>
      )}

      {/* ── Setup notes (compact single line) ────────── */}
      {setup !== '' && (
        <Box marginTop={1}>
          <Text color={COLORS.gray}>{`  ${setup}`}</Text>
        </Box>
      )}

      {/* ── Status line ──────────────────────────────── */}
      <Box>
        {s.processingComplaint && (
          <Text color={COLORS.primary}>{`  ${spinner} Processing complaint…`}</Text>
        )}
        {!s.processingComplaint && working && (
          <Text color={COLORS.primary}>{`  ${spinner} ${PHASE_TEXT[s.phase]}${detail}`}</Text>
        )}
        {!s.processingComplaint && s.phase === 'watching' && (
          <Text color={COLORS.green}>{'  ● Watching'}</Text>
        )}
        {!s.processingComplaint && s.phase === 'done' && s.outputs.length > 0 && (
          <Text color={COLORS.green}>{`  ✔ ${s.outputs.join(', ')}`}</Text>
        )}
        {!s.processingComplaint && s.phase === 'done' && s.outputs.length === 0 && (
          <Text color={COLORS.green}>{'  ✔ Done'}</Text>
        )}
        {!s.processingComplaint && s.phase === 'error' && (
          <Text color={COLORS.red}>{'  ✖ Error'}</Text>
        )}
        {stats !== '' && (
          <Text color={COLORS.gray}>{`  ${stats}`}</Text>
        )}
      </Box>

      {/* ── Evaluator progress ───────────────────────── */}
      {evalActive && evalLabel && (
        <Text color={evalDone && allPassed ? COLORS.green : evalDone ? COLORS.yellow : COLORS.primaryDim}>
          {`  ◆ ${evalLabel}`}
        </Text>
      )}

      {/* ── Change trigger ───────────────────────────── */}
      {s.lastChange !== '' && working && (
        <Text color={COLORS.gray}>{`  ↳ ${s.lastChange}`}</Text>
      )}

      {/* ── Warning ──────────────────────────────────── */}
      {s.warning !== '' && (
        <Box marginTop={0}>
          <Text color={COLORS.yellow}>{`  ⚠ ${s.warning}`}</Text>
        </Box>
      )}

      {/* ── Complaint changes ────────────────────────── */}
      {s.complaintChanges.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.primary}>{'  Complaint changes applied:'}</Text>
          {s.complaintChanges.map((c, i) => (
            <Text key={i} color={COLORS.primaryDim}>{`    → ${c}`}</Text>
          ))}
        </Box>
      )}

      {/* ── Optimization reasoning ───────────────────── */}
      {s.reasoning.length > 0 && (s.phase === 'done' || s.phase === 'watching') && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.primaryDim}>{'  Optimization details:'}</Text>
          {s.reasoning.map((r, i) => (
            <Text key={i} color={COLORS.gray}>{`    ${r}`}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default Dashboard;
