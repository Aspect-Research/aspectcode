/**
 * Dashboard — condensed ink-based CLI dashboard.
 *
 * Layout:
 *   Banner
 *   Status line  (spinner/icon + phase + stats)
 *   [Detail]     (change trigger, outputs, warning, reasoning)
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
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
  writing:       'Writing…',
  watching:      'Watching',
  done:          'Done',
  error:         'Error',
};

const WORKING = new Set<PipelinePhase>([
  'idle', 'discovering', 'analyzing', 'building-kb', 'optimizing', 'writing',
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

const Dashboard: React.FC = () => {
  const [s, setS] = useState<DashboardState>({ ...store.state });
  useEffect(() => {
    const fn = () => setS({ ...store.state });
    store.on('change', fn);
    return () => { store.removeListener('change', fn); };
  }, []);

  const working = WORKING.has(s.phase);
  const spinner = useSpinner(working);
  const stats = statsText(s);
  const detail = s.phaseDetail ? ` (${s.phaseDetail})` : '';

  return (
    <Box flexDirection="column">
      {/* ── Banner ───────────────────────────────────── */}
      <Box marginBottom={1}>
        <Text color={COLORS.primary} bold>{getBannerText()}</Text>
      </Box>

      {/* ── Status line ──────────────────────────────── */}
      <Box>
        {working && (
          <Text color={COLORS.primary}>{`  ${spinner} ${PHASE_TEXT[s.phase]}${detail}`}</Text>
        )}
        {s.phase === 'watching' && (
          <Text color={COLORS.green}>{'  ● Watching'}</Text>
        )}
        {s.phase === 'done' && s.outputs.length > 0 && (
          <Text color={COLORS.green}>{`  ✔ ${s.outputs.join(', ')}`}</Text>
        )}
        {s.phase === 'done' && s.outputs.length === 0 && (
          <Text color={COLORS.green}>{'  ✔ Done'}</Text>
        )}
        {s.phase === 'error' && (
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
        <Text color={COLORS.gray} dimColor>{'  Ctrl+C to stop'}</Text>
      )}
    </Box>
  );
};

export default Dashboard;
