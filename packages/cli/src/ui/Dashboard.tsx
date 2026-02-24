/**
 * Dashboard — ink-based self-updating CLI dashboard.
 *
 * Phase-aware layout:
 *
 *   Active phases  → banner + status + spinner + completed steps
 *   Watching       → banner + "Watching" + last-run summary
 *   Done / --once  → banner + "Complete" + outputs
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { COLORS, getBannerText } from './theme';
import { store } from './store';
import type { DashboardState, PipelinePhase, StepEntry } from './store';

// ── Spinner hook ─────────────────────────────────────────────

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

// ── Phase metadata ───────────────────────────────────────────

const PHASE_LABEL: Record<PipelinePhase, string> = {
  idle:          'Starting…',
  discovering:   'Discovering files…',
  analyzing:     'Analyzing…',
  'building-kb': 'Building knowledge base…',
  optimizing:    'Optimizing…',
  writing:       'Writing…',
  watching:      'Watching for changes',
  done:          'Complete',
  error:         'Error',
};

const ACTIVE_PHASES = new Set<PipelinePhase>([
  'discovering', 'analyzing', 'building-kb', 'optimizing', 'writing',
]);

// ── Step icon ────────────────────────────────────────────────

function stepIcon(s: StepEntry['status']): { icon: string; color: string } {
  switch (s) {
    case 'ok':    return { icon: '✔', color: COLORS.green };
    case 'warn':  return { icon: '⚠', color: COLORS.yellow };
    case 'error': return { icon: '✖', color: COLORS.red };
  }
}

// ── Stats bar ────────────────────────────────────────────────

const Stats: React.FC<{ state: DashboardState }> = ({ state }) => {
  const parts: string[] = [];
  if (state.fileCount > 0) parts.push(`${state.fileCount} files`);
  if (state.edgeCount > 0) parts.push(`${state.edgeCount} edges`);
  if (state.provider)       parts.push(state.provider);
  if (state.elapsed)        parts.push(state.elapsed);
  if (parts.length === 0) return null;
  return <Text color={COLORS.gray}>{'  '}{parts.join(' · ')}</Text>;
};

// ── Main component ───────────────────────────────────────────

const Dashboard: React.FC = () => {
  const [state, setState] = useState<DashboardState>({ ...store.state });

  useEffect(() => {
    const onUpdate = () => setState({ ...store.state });
    store.on('change', onUpdate);
    return () => { store.removeListener('change', onUpdate); };
  }, []);

  const isActive = ACTIVE_PHASES.has(state.phase);
  const spinner = useSpinner(isActive);

  return (
    <Box flexDirection="column">
      {/* ── Banner ──────────────────────────────────────── */}
      <Box marginBottom={1}>
        <Text color={COLORS.primary} bold>{getBannerText()}</Text>
      </Box>

      {/* ── Status line ─────────────────────────────────── */}
      <Box>
        {isActive && (
          <Text color={COLORS.primary}>{`  ${spinner} ${PHASE_LABEL[state.phase]}`}</Text>
        )}
        {state.phase === 'watching' && (
          <Text color={COLORS.green}>{`  ● ${PHASE_LABEL.watching}`}</Text>
        )}
        {state.phase === 'done' && (
          <Text color={COLORS.green}>{`  ✔ ${PHASE_LABEL.done}`}</Text>
        )}
        {state.phase === 'error' && (
          <Text color={COLORS.red}>{`  ✖ ${PHASE_LABEL.error}`}</Text>
        )}
        {state.phase === 'idle' && (
          <Text color={COLORS.gray}>{`  ○ ${PHASE_LABEL.idle}`}</Text>
        )}
        <Stats state={state} />
      </Box>

      {/* ── Change trigger ──────────────────────────────── */}
      {state.lastChange !== '' && (
        <Box>
          <Text color={COLORS.gray}>{`  ↳ ${state.lastChange}`}</Text>
        </Box>
      )}

      {/* ── Completed steps ─────────────────────────────── */}
      {state.steps.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {state.steps.map((step, i) => {
            const { icon, color } = stepIcon(step.status);
            return (
              <Box key={i}>
                <Text color={color}>{`  ${icon} `}</Text>
                <Text color={COLORS.white}>{step.text}</Text>
              </Box>
            );
          })}
          {/* Show current phase as in-progress spinner line */}
          {isActive && (
            <Box>
              <Text color={COLORS.primary}>{`  ${spinner} `}</Text>
              <Text color={COLORS.gray}>{PHASE_LABEL[state.phase]}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* ── Warning ─────────────────────────────────────── */}
      {state.warning !== '' && (
        <Box marginTop={0}>
          <Text color={COLORS.yellow}>{`  ⚠ ${state.warning}`}</Text>
        </Box>
      )}

      {/* ── Outputs ─────────────────────────────────────── */}
      {state.outputs.length > 0 && (
        <Box flexDirection="column" marginTop={0}>
          {state.outputs.map((o, i) => (
            <Box key={i}>
              <Text color={COLORS.green}>{'  ✔ '}</Text>
              <Text color={COLORS.white}>{o}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* ── Watch hint ──────────────────────────────────── */}
      {state.phase === 'watching' && (
        <Box marginTop={1}>
          <Text color={COLORS.gray} dimColor>{'  Press Ctrl+C to stop'}</Text>
        </Box>
      )}
    </Box>
  );
};

export default Dashboard;
