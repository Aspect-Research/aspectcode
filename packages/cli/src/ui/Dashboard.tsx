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
import SettingsPanel from './SettingsPanel';
import type { UserSettings, AspectCodeConfig } from '../config';
import { loadConfig, saveConfig, saveUserSettings } from '../config';
import { formatTokens } from '../usageTracker';
import { getVersion } from '../version';

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

// ── Eval phase elapsed timer ─────────────────────────────────

function useEvalElapsed(phase: EvalPhase): string {
  const [startMs, setStartMs] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (phase === 'idle' || phase === 'done') {
      setStartMs(0);
      return;
    }
    setStartMs(Date.now());
  }, [phase]);

  useEffect(() => {
    if (!startMs) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startMs]);

  if (!startMs || phase === 'idle' || phase === 'done') return '';
  const secs = Math.floor((now - startMs) / 1000);
  if (secs < 1) return '';
  return `${secs}s`;
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
  const round = s.iteration && s.maxIterations && s.maxIterations > 1
    ? `Round ${s.iteration}/${s.maxIterations}: `
    : '';
  switch (phase) {
    case 'idle': return null;
    case 'generating-probes':
      return `${round}Generating synthetic test scenarios…`;
    case 'probing': {
      const progress = s.probesPassed !== undefined && s.probesTotal !== undefined
        ? ` (${s.probesPassed}/${s.probesTotal})`
        : '';
      return `${round}Simulating AI responses${progress}…`;
    }
    case 'judging': {
      const progress = s.judgedCount !== undefined && s.probesTotal !== undefined
        ? ` (${s.judgedCount}/${s.probesTotal})`
        : '';
      return `${round}Judging response quality${progress}…`;
    }
    case 'diagnosing': {
      const detail = s.weakCount !== undefined && s.strongCount !== undefined
        ? ` — ${s.weakCount} gap${s.weakCount === 1 ? '' : 's'} found`
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
  const [showSettings, setShowSettings] = useState(false);
  const [settingsUserData, setSettingsUserData] = useState<UserSettings>({});
  const [settingsProjectData, setSettingsProjectData] = useState<AspectCodeConfig>({});

  useEffect(() => {
    const fn = () => setS({ ...store.state });
    store.on('change', fn);
    return () => { store.removeListener('change', fn); };
  }, []);

  // Force re-render every 10s so relative timestamps update
  useTick(10_000);

  // ── Keyboard handling ──────────────────────────────────────
  useInput((input: string, _key: Key) => {
    // Settings panel handles its own input when open
    if (showSettings) return;
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

    // Tier exhaustion actions
    if (store.state.tierExhausted) {
      if (input === 'u') {
        handler({ type: 'open-pricing' });
        return;
      }
      if (input === 'k') {
        store.setLearnedMessage('Add "apiKey": "sk-..." to aspectcode.json or ASPECTCODE_LLM_KEY to .env, then restart aspectcode');
        return;
      }
    }

    if (input === 'r') { handler({ type: 'probe-and-refine' }); return; }
    if (input === 'l' && !store.state.userEmail) {
      handler({ type: 'login' });
      return;
    }
    if (!current) {

      // No active assessment — 's' opens settings
      if (input === 's' && store.state.phase === 'watching') {
        const root = store.state.rootPath;
        setSettingsProjectData(loadConfig(root) ?? {});
        // User settings are loaded from store (set by pipeline on startup)
        setSettingsUserData((store as any)._userSettings ?? {});
        setShowSettings(true);
      }
      return;
    }
    if (current.llmRecommendation) {
      // Space pauses/unpauses the timer
      if (input === ' ') {
        setTimerPaused((p) => !p);
        return;
      }
      // Enter accepts the LLM recommendation immediately
      if (_key.return) {
        handler({
          type: current.llmRecommendation.decision === 'allow' ? 'dismiss' : 'confirm',
          assessment: current,
        });
        return;
      }
      // y = confirm (enforce rule), n = dismiss (allow / suppress)
      if (input === 'n') {
        handler({ type: 'dismiss', assessment: current });
      } else if (input === 'y') {
        handler({ type: 'confirm', assessment: current });
      }
    } else {
      // No LLM recommendation — classic y/n/s
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
  const evalElapsed = useEvalElapsed(s.evalStatus.phase);
  const learnedMsg = useAutoMessage(s.learnedMessage, () => store.setLearnedMessage(''));

  // Timer for auto-resolving assessments with LLM recommendation
  const [autoTimer, setAutoTimer] = useState(30);
  const [timerPaused, setTimerPaused] = useState(false);
  useEffect(() => {
    const cur = s.currentAssessment;
    if (!cur?.llmRecommendation) { setAutoTimer(20); setTimerPaused(false); return; }
    setAutoTimer(20);
    setTimerPaused(false);
    const interval = setInterval(() => {
      setAutoTimer((t) => {
        if (timerPaused) return t;
        if (t <= 1) {
          // Auto-apply LLM decision
          const handler = (store as any)._onAssessmentAction as ((a: any) => void) | undefined;
          if (handler && cur.llmRecommendation) {
            handler({
              type: cur.llmRecommendation.decision === 'allow' ? 'dismiss' : 'confirm',
              assessment: cur,
            });
          }
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [s.currentAssessment, timerPaused]);
  const warningMsg = useAutoMessage(s.warning, () => store.setWarning(''), 5000);
  const changeFlash = useAutoMessage(s.lastChangeFlash, () => store.setLastChangeFlash(''));
  const current = s.currentAssessment;
  const queueLen = s.pendingAssessments.length;

  // ── Build header info ──────────────────────────────────────
  const rootLabel = s.rootPath ? s.rootPath.replace(/\\/g, '/').split('/').pop() || s.rootPath : '';

  // ── Settings panel ────────────────────────────────────────
  if (showSettings) {
    return (
      <SettingsPanel
        userSettings={settingsUserData}
        projectConfig={settingsProjectData}
        onSave={(user, project) => {
          const root = s.rootPath;
          // Save user settings to cloud
          saveUserSettings(user);
          // Save project settings to local file
          if (root) saveConfig(root, project);
          // Store user settings for future reference
          (store as any)._userSettings = user;
          setShowSettings(false);
          store.setLearnedMessage('Settings saved');
        }}
        onCancel={() => setShowSettings(false)}
      />
    );
  }

  return (
    <Box flexDirection="column">

      {/* ── Header ──────────────────────────────── */}
      <Text>
        <Text color={COLORS.primary} bold>{`◆ aspect code v${getVersion()}`}</Text>
        {rootLabel ? <Text color={COLORS.gray}>{` ${SEP_CHAR} ${rootLabel}`}</Text> : null}
        {s.activePlatform ? <Text color={COLORS.gray}>{` ${SEP_CHAR} ${s.activePlatform}`}</Text> : null}
        {s.updateMessage ? <Text color={COLORS.gray}>{` ${SEP_CHAR} ${s.updateMessage}`}</Text> : null}
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
      {s.isFirstRun && working && s.phase !== 'evaluating' && (
        <Text color={COLORS.gray}>{'Analyzing your codebase to generate AGENTS.md'}</Text>
      )}
      {s.isFirstRun && s.phase === 'evaluating' && (
        <Text color={COLORS.gray}>{'Optimizing AGENTS.md — testing with synthetic scenarios to find gaps'}</Text>
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
            {!evalDone && evalElapsed ? <Text color={COLORS.gray}>{` ${evalElapsed}`}</Text> : null}
            {!evalDone && !s.evalStatus.cancelled ? '  [x] cancel' : ''}
            {evalDone ? '  [c] clear' : ''}
          </Text>

          {/* Live probe results during judging */}
          {s.evalStatus.phase === 'judging' && s.evalStatus.probeResults && (
            <>
              {s.evalStatus.probeResults.map((pr, i) => {
                if (pr.status === 'pending') return null;
                if (pr.status === 'strong') return null; // Only show gaps, not passes
                return <Text key={`pr-${i}`} color={COLORS.gray}>{`  ○ gap: ${pr.task}`}</Text>;
              })}
            </>
          )}

          {/* Live edit summaries during applying */}
          {s.evalStatus.phase === 'applying' && s.evalStatus.editSummaries && s.evalStatus.editSummaries.length > 0 && (
            <>
              {s.evalStatus.editSummaries.map((line, i) => (
                <Text key={`ae-${i}`} color={COLORS.gray}>{`  + ${line}`}</Text>
              ))}
            </>
          )}

          {/* Completed iteration summaries */}
          {s.evalStatus.iterationSummaries && s.evalStatus.iterationSummaries.map((summary, i) => (
            <Text key={`iter-${i}`} color={COLORS.gray}>{`├ ${summary}`}</Text>
          ))}

          {/* Final edit summaries (done phase) */}
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
      {warningMsg !== '' && (
        <Text color={COLORS.yellow}>{`● ${warningMsg}`}</Text>
      )}

      {/* ── Watching indicator ─────────────────────── */}
      {isWatching && (
        <Text color={COLORS.gray}>
          {`${pulse} watching`}
          {s.userEmail && s.syncStatus === 'synced' && s.lastSyncAt > 0 ? (
            <Text color={COLORS.gray}>{` — ☁  synced`}</Text>
          ) : null}
          {s.userEmail && s.syncStatus === 'offline' ? (
            <Text color={COLORS.yellow}>{` — ☁  offline`}</Text>
          ) : null}
        </Text>
      )}

      {/* ── Dream cycle in progress ───────────────── */}
      {s.dreaming && (
        <Text color={COLORS.primary}>{`${dreamSpinner} refining context…`}</Text>
      )}

      {/* ── Community suggestions (auto-applied via dream cycle) ────── */}
      {isWatching && !s.suggestionsDismissed && s.suggestions.length > 0 && !current && !s.dreaming && (
        <Text color={COLORS.gray}>{`  ✦ ${s.suggestions.length} community insight${s.suggestions.length === 1 ? '' : 's'} — will refine on next dream cycle`}</Text>
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
          {current.llmRecommendation ? (
            <>
              <Text color={COLORS.gray} dimColor>
                {`  ${Math.round(current.llmRecommendation.confidence * 100)}% — ${current.llmRecommendation.reasoning}`}
              </Text>
              <Box>
                {current.llmRecommendation.decision === 'deny' ? (
                  <Text>
                    <Text color={COLORS.primary} bold>{'  [enter] enforce rule'}</Text>
                    <Text color={COLORS.gray}>{'  [n] allow  [space] pause timer'}</Text>
                  </Text>
                ) : (
                  <Text>
                    <Text color={COLORS.primary} bold>{'  [enter] allow'}</Text>
                    <Text color={COLORS.gray}>{'  [y] enforce rule  [space] pause timer'}</Text>
                  </Text>
                )}
                {autoTimer > 0 && (
                  <Text color={COLORS.gray}>{timerPaused ? '  (paused)' : `  (${autoTimer}s)`}</Text>
                )}
              </Box>
            </>
          ) : (
            <Box>
              <Text color={COLORS.gray}>{'  [y] confirm  [n] dismiss  [s] skip'}</Text>
            </Box>
          )}
          <Box>
            {queueLen > 0 && (
              <Text color={COLORS.gray}>{`  (1 of ${queueLen + 1})`}</Text>
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

      {/* Dream cycle runs autonomously — no prompt needed */}

      {/* ── Status bar ────────────────────────────── */}
      {isWatching && (
        <Text color={COLORS.gray} dimColor>
          {(() => {
            const stats = s.assessmentStats;
            const parts: string[] = [];
            parts.push(`${stats.changes} source file change${stats.changes === 1 ? '' : 's'}`);
            if (stats.warnings > 0) parts.push(`${stats.warnings} warnings`);
            if (stats.violations > 0) parts.push(`${stats.violations} violations`);
            if (stats.autoResolved > 0) parts.push(`${stats.autoResolved} auto-resolved`);
            return parts.join(' · ');
          })()}
        </Text>
      )}
      {isWatching && (
        <Text color={COLORS.gray} dimColor>
          {'[r] optimize  [s] settings'}
        </Text>
      )}

      {/* ── Tier exhaustion prompt ────────────── */}
      {s.tierExhausted && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.red} bold>
            {`${s.userTier === 'free' ? 'Free' : 'Weekly'} limit reached (${formatTokens(s.tierTokensUsed)} / ${formatTokens(s.tierTokensCap)} tokens).`}
          </Text>
          <Text>{''}</Text>
          <Text color={COLORS.primaryDim}>{'  [u] Upgrade to Pro — $8/mo, 1M tokens/week'}</Text>
          <Text color={COLORS.gray} dimColor>{'  [k] Add your own key (restart required after adding)'}</Text>
        </Box>
      )}

      {/* ── Usage tracker ── */}
      {s.userTier === 'byok' ? (
        <Text color={COLORS.gray} dimColor>
          {s.sessionUsage.calls > 0
            ? `${formatTokens(s.sessionUsage.inputTokens)} in · ${formatTokens(s.sessionUsage.outputTokens)} out · ${s.sessionUsage.calls} call${s.sessionUsage.calls === 1 ? '' : 's'}  (BYOK)`
            : 'BYOK — 0 calls'}
        </Text>
      ) : s.userTier === 'pro' ? (
        <Text color={s.tierTokensCap > 0 && s.tierTokensUsed / s.tierTokensCap >= 0.95 ? COLORS.red : s.tierTokensCap > 0 && s.tierTokensUsed / s.tierTokensCap >= 0.8 ? COLORS.yellow : COLORS.gray} dimColor={s.tierTokensCap === 0 || s.tierTokensUsed / s.tierTokensCap < 0.8}>
          {`${formatTokens(s.tierTokensUsed)} / ${formatTokens(s.tierTokensCap)} weekly tokens${s.sessionUsage.calls > 0 ? ` · ${s.sessionUsage.calls} call${s.sessionUsage.calls === 1 ? '' : 's'}` : ''}${s.tierResetAt ? `  (resets ${new Date(s.tierResetAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })})` : ''}`}
        </Text>
      ) : s.tierTokensUsed >= 75_000 ? (
        <Text color={s.tierTokensCap > 0 && s.tierTokensUsed / s.tierTokensCap >= 0.95 ? COLORS.red : s.tierTokensCap > 0 && s.tierTokensUsed / s.tierTokensCap >= 0.8 ? COLORS.yellow : COLORS.gray} dimColor={s.tierTokensCap === 0 || s.tierTokensUsed / s.tierTokensCap < 0.8}>
          {`${formatTokens(s.tierTokensUsed)} / ${formatTokens(s.tierTokensCap)} free tokens${s.sessionUsage.calls > 0 ? ` · ${s.sessionUsage.calls} call${s.sessionUsage.calls === 1 ? '' : 's'}` : ''}`}
        </Text>
      ) : (
        s.sessionUsage.calls > 0 ? (
          <Text color={COLORS.gray} dimColor>
            {`${s.sessionUsage.calls} call${s.sessionUsage.calls === 1 ? '' : 's'}`}
          </Text>
        ) : null
      )}
    </Box>
  );
};

export default Dashboard;
