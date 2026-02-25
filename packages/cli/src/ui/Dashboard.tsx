/**
 * Dashboard — condensed ink-based CLI dashboard.
 *
 * Layout:
 *   Banner
 *   Status line  (spinner/icon + phase + stats)
 *   [Detail]     (change trigger, outputs, warning, reasoning)
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Key } from 'ink';
import { COLORS, getBannerText } from './theme';
import { store } from './store';
import type { DashboardState, PipelinePhase } from './store';

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

function statsText(s: DashboardState): string {
  const parts: string[] = [];
  if (s.fileCount > 0) parts.push(`${s.fileCount} files`);
  if (s.edgeCount > 0) parts.push(`${s.edgeCount} edges`);
  if (s.provider)       parts.push(s.provider);
  if (s.elapsed)        parts.push(s.elapsed);
  return parts.length > 0 ? parts.join(' · ') : '';
}

// ── Component ────────────────────────────────────────────────

/** Phases where the complaint input is shown. */
const INPUT_VISIBLE = new Set<PipelinePhase>([
  'watching', 'done', 'idle',
  'discovering', 'analyzing', 'building-kb', 'optimizing', 'writing',
]);

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
  const stats = statsText(s);
  const detail = s.phaseDetail ? ` (${s.phaseDetail})` : '';

  return (
    <Box flexDirection="column">
      {/* ── Banner ───────────────────────────────────── */}
      <Box marginBottom={1}>
        <Text color={COLORS.primary} bold>{getBannerText()}</Text>
      </Box>

      {/* ── Complaint input ──────────────────────────── */}
      {INPUT_VISIBLE.has(s.phase) && (
        <Box>
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

      {/* ── Watch hint ───────────────────────────────── */}
      {s.phase === 'watching' && (
        <Text color={COLORS.gray} dimColor>{'  Type a complaint above, or Ctrl+C to stop'}</Text>
      )}
      {s.phase === 'done' && (
        <Text color={COLORS.gray} dimColor>{'  Type a complaint above to refine AGENTS.md'}</Text>
      )}
    </Box>
  );
};

export default Dashboard;
