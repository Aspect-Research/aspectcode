/**
 * Optimize wrapper — tries LLM optimization, falls back to static content.
 *
 * - If an API key is available → generate seed AGENTS.md from KB
 * - If probeAndRefine=true → run multi-iteration probe-and-refine loop
 * - If no API key → warn and write static AGENTS.md content
 */

import {
  resolveProvider,
  loadEnvFile,
} from '@aspectcode/optimizer';
import type { ProviderOptions, ChatUsage } from '@aspectcode/optimizer';
import {
  generateProbes,
  runProbes,
  judgeProbe,
  diagnose,
  applyEdits,
  DEFAULT_PROBE_REFINE_CONFIG,
} from '@aspectcode/evaluator';
import type {
  ProbeProgressCallback,
  ProbeRefineConfig,
  JudgedProbeResult,
  AgentsEdit,
} from '@aspectcode/evaluator';
import { generateCanonicalContentForMode, generateKbCustomContent, generateKbSeedContent } from '@aspectcode/emitters';
import type { RunContext } from './cli';
import type { AspectCodeConfig, UserSettings } from './config';
import { fmt } from './logger';
import { store } from './ui/store';
import type { PreferencesStore } from './preferences';
import { formatPreferencesForPrompt } from './preferences';
import * as path from 'path';

/** Result of the optimization attempt. */
export interface OptimizeOutput {
  content: string;
  reasoning: string[];
  tokenUsage?: ChatUsage;
}

/**
 * Try to generate AGENTS.md content via LLM using static analysis as context.
 * Falls back to static instruction content when no API key is available.
 *
 * @param probeAndRefine  When true, run the multi-iteration probe-and-refine loop
 *                        after generating the seed. Only on first run or manual rerun.
 */
export async function tryOptimize(
  ctx: RunContext,
  kbContent: string,
  _toolInstructions: Map<string, string>,
  config: AspectCodeConfig | undefined,
  _baseContent: string,
  probeAndRefine = false,
  preferences?: PreferencesStore,
  userSettings?: UserSettings,
): Promise<OptimizeOutput> {
  const { flags, log, root } = ctx;
  const evalConfig = config?.evaluate;
  const evaluatorEnabled = probeAndRefine && evalConfig?.enabled !== false;

  // ── Resolve settings (CLI flags > cloud user settings > defaults) ──

  const temperature = flags.temperature ?? userSettings?.temperature;
  const model = flags.model ?? userSettings?.model;
  const providerName = flags.provider ?? userSettings?.provider;
  const maxTokens = userSettings?.maxTokens;

  // ── Load .env and try to resolve a provider ───────────────
  let env: Record<string, string>;
  try {
    env = loadEnvFile(root);
  } catch {
    env = {};
  }

  if (providerName && !env['LLM_PROVIDER']) {
    env['LLM_PROVIDER'] = providerName;
  }

  const providerOptions: ProviderOptions = {};
  if (model) providerOptions.model = model;
  if (temperature !== undefined) providerOptions.temperature = temperature;
  if (maxTokens !== undefined) providerOptions.maxTokens = maxTokens;

  let provider;
  try {
    provider = resolveProvider(env, providerOptions);
  } catch {
    store.addSetupNote('no API key found — using built-in rules');
    log.warn(
      'No LLM API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env for optimization.',
    );
    const content = kbContent.length > 0
      ? generateKbCustomContent(kbContent, 'safe')
      : generateCanonicalContentForMode('safe', false);
    return { content, reasoning: [] };
  }

  const providerLabel = model ? `${provider.name} (${model})` : provider.name;
  log.info(`Generating with ${fmt.cyan(provider.name)}${model ? ` (${fmt.cyan(model)})` : ''}…`);
  store.setProvider(providerLabel);

  const optLog = flags.quiet ? undefined : {
    info(msg: string)  { log.info(msg); },
    warn(msg: string)  { log.warn(msg); },
    error(msg: string) { log.error(msg); },
    debug(msg: string) { log.debug(msg); },
  };

  // ── Enrich KB with user preferences ─────────────────────
  let enrichedKb = kbContent;
  if (preferences) {
    const prefBlock = formatPreferencesForPrompt(preferences);
    if (prefBlock) enrichedKb = kbContent + '\n\n' + prefBlock;
  }

  // ── Generate seed AGENTS.md ─────────────────────────────

  const projectName = path.basename(root);
  store.setPhase('optimizing', 'generating seed AGENTS.md…');

  let finalContent: string;
  if (evaluatorEnabled) {
    // Use the structured KB seed format for probe-and-refine
    finalContent = generateKbSeedContent(enrichedKb, projectName);
    log.info('Generated KB seed for probe-and-refine tuning');
  } else {
    // Use KB-custom content when not doing probe-and-refine
    finalContent = enrichedKb.length > 0
      ? generateKbCustomContent(enrichedKb, 'safe')
      : generateCanonicalContentForMode('safe', false);
  }

  store.setPhase('optimizing', 'generation complete');

  // ── Probe-and-refine loop ──────────────────────────────────

  if (evaluatorEnabled) {
    const allAppliedEdits: AgentsEdit[] = [];
    const iterationSummaries: string[] = [];
    let totalEditsApplied = 0;

    // ── Abort controller for immediate cancellation ──────
    const abortController = new AbortController();
    const { signal } = abortController;

    const onStoreChange = () => {
      if (store.state.evalStatus.cancelled && !signal.aborted) {
        abortController.abort();
      }
    };
    store.on('change', onStoreChange);

    try {
      const loopConfig: ProbeRefineConfig = {
        maxIterations: evalConfig?.maxIterations ?? DEFAULT_PROBE_REFINE_CONFIG.maxIterations,
        targetProbesPerIteration: evalConfig?.maxProbes ?? DEFAULT_PROBE_REFINE_CONFIG.targetProbesPerIteration,
        maxEditsPerIteration: evalConfig?.maxEditsPerIteration ?? DEFAULT_PROBE_REFINE_CONFIG.maxEditsPerIteration,
        charBudget: evalConfig?.charBudget ?? DEFAULT_PROBE_REFINE_CONFIG.charBudget,
      };

      store.setPhase('evaluating');

      const priorTasks: string[] = [];
      let noChangeStreak = 0;
      let probeExhaustionStreak = 0;
      let convergedReason: string | undefined;

      /** Cooperative cancel check — returns true if the user pressed [x]. */
      const isCancelled = () => signal.aborted;

      /** Preserves iterationSummaries across setEvalStatus calls. */
      const setEval = (status: Omit<import('./ui/store').EvalStatus, 'iterationSummaries' | 'cancelled'>) => {
        store.setEvalStatus({
          ...status,
          iterationSummaries: iterationSummaries.length > 0 ? [...iterationSummaries] : undefined,
          cancelled: signal.aborted,
        });
      };

      for (let iteration = 1; iteration <= loopConfig.maxIterations; iteration++) {
        if (isCancelled()) break;
        log.info(`\n── Iteration ${iteration}/${loopConfig.maxIterations} ──`);

        // ── Step 1: Generate probes ──────────────────────
        setEval({
          phase: 'generating-probes',
          iteration,
          maxIterations: loopConfig.maxIterations,
        });
        store.setPhase('evaluating');

        const probes = await generateProbes({
          kb: enrichedKb,
          currentAgentsMd: finalContent,
          priorProbeTasks: priorTasks,
          maxProbes: loopConfig.targetProbesPerIteration,
          provider,
          projectName,
          log: optLog,
          signal,
        });

        if (isCancelled()) break;

        // Track prior tasks for cross-iteration dedup
        for (const p of probes) priorTasks.push(p.task);

        if (probes.length === 0) {
          probeExhaustionStreak++;
          log.info(`No new probes generated (streak: ${probeExhaustionStreak})`);
          if (probeExhaustionStreak >= 2) {
            convergedReason = 'probe diversity exhausted';
            log.info(`Converged: ${convergedReason}`);
            break;
          }
          continue;
        } else {
          probeExhaustionStreak = 0;
        }

        // ── Step 2: Simulate probes ──────────────────────
        const probeTasks = probes.map((p) => p.task);
        setEval({
          phase: 'probing',
          iteration,
          maxIterations: loopConfig.maxIterations,
          probesTotal: probes.length,
          probeTasks,
        });
        store.setPhase('evaluating');

        const onProbeProgress: ProbeProgressCallback = (info) => {
          const currentTask = probes[info.probeIndex]?.task;
          const brief = currentTask && currentTask.length > 60
            ? currentTask.slice(0, 57) + '...'
            : currentTask;
          setEval({
            phase: 'probing',
            iteration,
            maxIterations: loopConfig.maxIterations,
            probesPassed: info.probeIndex + (info.phase === 'done' ? 1 : 0),
            probesTotal: info.total,
            probeTasks,
            currentProbeTask: brief,
          });
        };

        const simResults = await runProbes(
          finalContent, probes, provider, optLog, signal, onProbeProgress,
        );

        if (isCancelled()) break;

        // ── Step 3: Judge each probe ─────────────────────
        setEval({
          phase: 'judging',
          iteration,
          maxIterations: loopConfig.maxIterations,
          probesTotal: simResults.length,
          judgedCount: 0,
          weakCount: 0,
          strongCount: 0,
        });
        store.setPhase('evaluating');

        const judgedResults: JudgedProbeResult[] = [];
        let weakCount = 0;
        let strongCount = 0;

        for (let i = 0; i < simResults.length; i++) {
          if (isCancelled()) break;
          const sim = simResults[i];
          const probe = probes[i];
          if (!sim.response) continue;

          const judged = await judgeProbe({
            task: sim.task,
            response: sim.response,
            expectedBehaviors: probe.expectedBehaviors,
            probeId: sim.probeId,
            provider,
            log: optLog,
            signal,
          });
          judgedResults.push(judged);

          const hasWeak = judged.behaviorReviews.some((b) => b.assessment !== 'strong');
          if (hasWeak) weakCount++;
          else strongCount++;

          const briefTask = sim.task.length > 50 ? sim.task.slice(0, 47) + '...' : sim.task;
          setEval({
            phase: 'judging',
            iteration,
            maxIterations: loopConfig.maxIterations,
            probesTotal: simResults.length,
            judgedCount: i + 1,
            weakCount,
            strongCount,
            currentProbeTask: briefTask,
          });

          log.info(`  ${hasWeak ? '✖' : '✔'} ${sim.probeId} (${hasWeak ? 'weak' : 'strong'})`);
        }

        if (isCancelled()) break;

        // ── Step 4: Aggregate diagnosis ──────────────────
        setEval({
          phase: 'diagnosing',
          iteration,
          maxIterations: loopConfig.maxIterations,
          weakCount,
          strongCount,
          probesTotal: judgedResults.length,
        });
        store.setPhase('evaluating');

        const diagnosisEdits = await diagnose({
          judgedResults,
          agentsContent: finalContent,
          provider,
          log: optLog,
          signal,
        });

        if (isCancelled()) break;

        // Merge per-probe edits + diagnosis edits, deduplicate
        const allEdits: AgentsEdit[] = [];
        for (const jr of judgedResults) {
          allEdits.push(...jr.proposedEdits);
        }
        allEdits.push(...diagnosisEdits);

        // Deduplicate by content similarity
        const seen = new Set<string>();
        const dedupedEdits: AgentsEdit[] = [];
        for (const edit of allEdits) {
          const key = `${edit.section}:${edit.action}:${edit.content.toLowerCase().trim()}`;
          if (!seen.has(key)) {
            seen.add(key);
            dedupedEdits.push(edit);
          }
        }

        const cappedEdits = dedupedEdits.slice(0, loopConfig.maxEditsPerIteration);
        log.info(`Applying ${cappedEdits.length} edits (${allEdits.length} total, ${dedupedEdits.length} unique)`);

        // ── Step 5: Apply edits deterministically ────────
        setEval({
          phase: 'applying',
          iteration,
          maxIterations: loopConfig.maxIterations,
          proposedEditCount: cappedEdits.length,
        });
        store.setPhase('evaluating');

        const guidanceBefore = finalContent;
        const applyResult = applyEdits(finalContent, cappedEdits, loopConfig.charBudget);
        finalContent = applyResult.content;
        totalEditsApplied += applyResult.applied;
        allAppliedEdits.push(...cappedEdits.slice(0, applyResult.applied));

        if (applyResult.trimmed > 0) {
          log.info(`Trimmed ${applyResult.trimmed} bullets to fit ${loopConfig.charBudget}-char budget`);
        }

        // ── Step 6: Convergence check ────────────────────
        const guidanceChanged = finalContent !== guidanceBefore;
        if (guidanceChanged) {
          noChangeStreak = 0;
          log.info(`Guidance updated (${guidanceBefore.length} → ${finalContent.length} chars)`);
        } else {
          noChangeStreak++;
          log.info(`No guidance change (streak: ${noChangeStreak})`);
        }

        // Build iteration summary
        const roundParts: string[] = [];
        roundParts.push(`${probes.length} scenarios`);
        if (weakCount > 0) roundParts.push(`${weakCount} gap${weakCount === 1 ? '' : 's'}`);
        else roundParts.push('all passed');
        if (applyResult.applied > 0) roundParts.push(`${applyResult.applied} improvement${applyResult.applied === 1 ? '' : 's'}`);
        iterationSummaries.push(`Round ${iteration}: ${roundParts.join(', ')}`);

        if (noChangeStreak >= 2) {
          convergedReason = 'guidance converged (no changes)';
          log.info(`Converged: ${convergedReason}`);
          break;
        }
      }

      const editSummaries = allAppliedEdits.map((e) => {
        const verb = { add: 'Added', remove: 'Removed', strengthen: 'Strengthened', modify: 'Updated' }[e.action];
        const brief = e.content.length > 60 ? e.content.slice(0, 57) + '...' : e.content;
        return `${verb}: ${brief} (${e.section})`;
      });

      const wasCancelled = isCancelled();

      store.setEvalStatus({
        phase: 'done',
        iteration: loopConfig.maxIterations,
        maxIterations: loopConfig.maxIterations,
        diagnosisEdits: totalEditsApplied,
        convergedReason: wasCancelled ? undefined : convergedReason,
        editSummaries,
        iterationSummaries: iterationSummaries.length > 0 ? iterationSummaries : undefined,
        cancelled: wasCancelled,
      });

      store.removeListener('change', onStoreChange);

      if (wasCancelled) {
        log.info(`Probe-and-refine cancelled by user (${totalEditsApplied} edits applied)`);
      } else if (convergedReason) {
        log.info(`Probe-and-refine complete: ${convergedReason}`);
      } else {
        log.info(`Probe-and-refine complete: max iterations reached`);
      }
    } catch (err) {
      // Clean up abort listener if we exit via exception
      store.removeListener('change', onStoreChange);

      // AbortError from cancel — not a real error
      if (err instanceof DOMException && err.name === 'AbortError') {
        const editSummaries = allAppliedEdits.map((e) => {
          const verb = { add: 'Added', remove: 'Removed', strengthen: 'Strengthened', modify: 'Updated' }[e.action];
          const brief = e.content.length > 60 ? e.content.slice(0, 57) + '...' : e.content;
          return `${verb}: ${brief} (${e.section})`;
        });
        store.setEvalStatus({
          phase: 'done',
          diagnosisEdits: totalEditsApplied,
          editSummaries,
          iterationSummaries: iterationSummaries.length > 0 ? iterationSummaries : undefined,
          cancelled: true,
        });
        log.info(`Probe-and-refine cancelled by user (${totalEditsApplied} edits applied)`);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`Probe and refine failed (non-fatal): ${msg}`);
      }
    }
  }

  store.setReasoning([]);
  return { content: finalContent, reasoning: [] };
}
