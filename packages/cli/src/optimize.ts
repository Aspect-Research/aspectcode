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
  applyEditsWithLlm,
  DEFAULT_PROBE_REFINE_CONFIG,
} from '@aspectcode/evaluator';
import type {
  ProbeProgressCallback,
  ProbeRefineConfig,
  JudgedProbeResult,
  AgentsEdit,
} from '@aspectcode/evaluator';
import type { RunContext } from './cli';
import type { AspectCodeConfig, UserSettings } from './config';
import { fmt } from './logger';
import { store } from './ui/store';
import { loadCredentials } from './auth';
import { withUsageTracking } from './usageTracker';
import type { PreferencesStore } from './preferences';
import { addPreference, formatPreferencesForPrompt, savePreferences } from './preferences';

import type { ScopedRule } from './scopedRules';

/** Result of the optimization attempt. */
export interface OptimizeOutput {
  content: string;
  reasoning: string[];
  tokenUsage?: ChatUsage;
  /** LLM-consolidated scoped rules (empty if no LLM available). */
  scopedRules: ScopedRule[];
  /** Slugs of scoped rules to delete. */
  deleteSlugs: string[];
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
  staticRules?: ScopedRule[],
): Promise<OptimizeOutput> {
  const { flags, log, root } = ctx;
  const evalConfig = config?.evaluate;
  const evaluatorEnabled = probeAndRefine && evalConfig?.enabled !== false;

  // ── Resolve settings (CLI flags > cloud user settings > defaults) ──

  const temperature = flags.temperature ?? userSettings?.temperature;
  const model = flags.model ?? userSettings?.model;
  const maxTokens = userSettings?.maxTokens;

  // ── Load .env and try to resolve a provider ───────────────
  let env: Record<string, string>;
  try {
    env = loadEnvFile(root);
  } catch {
    env = {};
  }

  // Inject BYOK key from aspectcode.json if set
  if (config?.apiKey && !env['ASPECTCODE_LLM_KEY']) {
    env['ASPECTCODE_LLM_KEY'] = config.apiKey;
  }

  // Pass CLI token so the aspectcode hosted provider can authenticate
  const creds = loadCredentials();
  if (creds && !env['ASPECTCODE_CLI_TOKEN']) {
    env['ASPECTCODE_CLI_TOKEN'] = creds.token;
  }

  // Only set LLM_PROVIDER from CLI flags, not user settings.
  // When logged in, the hosted proxy handles model selection server-side.
  if (flags.provider && !env['LLM_PROVIDER']) {
    env['LLM_PROVIDER'] = flags.provider;
  }

  const providerOptions: ProviderOptions = {};
  if (model) providerOptions.model = model;
  if (temperature !== undefined) providerOptions.temperature = temperature;
  if (maxTokens !== undefined) providerOptions.maxTokens = maxTokens;

  let provider;
  let diagnosisProvider; // Sonnet for higher-quality diagnosis
  try {
    provider = withUsageTracking(resolveProvider(env, providerOptions));
    // Use Sonnet for the diagnosis step (higher quality for the most impactful call)
    try {
      diagnosisProvider = withUsageTracking(resolveProvider(env, { ...providerOptions, model: 'claude-sonnet-4-20250514' }));
    } catch {
      diagnosisProvider = provider; // Fall back to same provider
    }
  } catch (providerErr) {
    store.addSetupNote('no LLM available — using static content');
    const errMsg = providerErr instanceof Error ? providerErr.message : String(providerErr);
    log.warn(`LLM failed: ${errMsg}`);
    return { content: _baseContent, reasoning: [], scopedRules: [], deleteSlugs: [] };
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

  // ── Use base content as seed AGENTS.md ──────────────────

  const projectName = root.split('/').pop() || root.split('\\').pop() || 'Project';
  store.setPhase('optimizing', 'generating seed AGENTS.md…');

  let finalContent: string;
  if (evaluatorEnabled) {
    // Use the base content (rendered directly from AnalysisModel) as the seed
    finalContent = _baseContent;
    log.info('Using base AGENTS.md for probe-and-refine tuning');
  } else {
    // Use base content directly (already rendered from AnalysisModel)
    finalContent = _baseContent;
  }

  store.setPhase('optimizing', 'generation complete');

  // ── Probe-and-refine loop ──────────────────────────────────

  const scopedRuleCreates: ScopedRule[] = [];
  const scopedRuleDeletes: string[] = [];
  const allAppliedEdits: AgentsEdit[] = [];

  if (evaluatorEnabled) {
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
        const probeResults: Array<{ task: string; status: 'strong' | 'weak' | 'pending' }> = [];

        // Pre-populate pending entries for all probes
        for (const sim of simResults) {
          const brief = sim.task.length > 60 ? sim.task.slice(0, 57) + '...' : sim.task;
          probeResults.push({ task: brief, status: 'pending' });
        }

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

          probeResults[i] = { task: probeResults[i].task, status: hasWeak ? 'weak' : 'strong' };
          setEval({
            phase: 'judging',
            iteration,
            maxIterations: loopConfig.maxIterations,
            probesTotal: simResults.length,
            judgedCount: i + 1,
            weakCount,
            strongCount,
            currentProbeTask: probeResults[i].task,
            probeResults: [...probeResults],
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

        // Build scoped rules context for diagnosis
        const rulesCtx = staticRules?.map((r) =>
          `### ${r.slug} (${r.source})\nGlobs: ${r.globs.join(', ')}\n${r.content}`
        ).join('\n---\n') || '';

        const staticData = staticRules?.length
          ? `${staticRules.length} candidate rules from static analysis (hubs, conventions, circular deps). The LLM decides which are worth keeping as scoped rules vs folding into AGENTS.md.`
          : '';

        const diagnosisEdits = await diagnose({
          judgedResults,
          agentsContent: finalContent,
          provider: diagnosisProvider ?? provider,
          log: optLog,
          signal,
          scopedRulesContext: rulesCtx,
          staticAnalysisData: staticData,
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

        // Separate AGENTS.md edits from scoped rule edits
        const agentsMdEdits = dedupedEdits.filter((e) => !e.section.startsWith('scoped:'));
        const scopedEdits = dedupedEdits.filter((e) => e.section.startsWith('scoped:'));

        // Collect scoped rule operations for later
        for (const edit of scopedEdits) {
          if (edit.section.startsWith('scoped:DELETE:')) {
            const slug = edit.section.replace('scoped:DELETE:', '');
            scopedRuleDeletes.push(slug);
          } else if (edit.section.startsWith('scoped:CREATE:')) {
            const slug = edit.section.replace('scoped:CREATE:', '');
            if (edit.content && edit.globs?.length) {
              scopedRuleCreates.push({
                slug,
                description: edit.description || `Rule for ${slug}`,
                globs: edit.globs,
                content: edit.content,
                source: 'probe' as const,
              });
            }
          } else {
            // scoped:slug — update existing rule
            const slug = edit.section.replace('scoped:', '');
            if (edit.content) {
              scopedRuleCreates.push({
                slug,
                description: edit.description || `Updated rule for ${slug}`,
                globs: edit.globs || [`**`],
                content: edit.content,
                source: 'probe' as const,
              });
            }
          }
        }

        const cappedEdits = agentsMdEdits.slice(0, loopConfig.maxEditsPerIteration);
        const totalEditCount = cappedEdits.length + scopedEdits.length;
        log.info(`Applying ${cappedEdits.length} AGENTS.md edits, ${scopedEdits.length} scoped rule edits (${allEdits.length} total)`);

        // ── Step 5: Apply AGENTS.md edits deterministically ────────
        const pendingEditSummaries = [
          ...cappedEdits.map((e) => `${e.action} ${e.section}: "${e.content.length > 60 ? e.content.slice(0, 57) + '...' : e.content}"`),
          ...scopedEdits.map((e) => `${e.section}`),
        ];
        setEval({
          phase: 'applying',
          iteration,
          maxIterations: loopConfig.maxIterations,
          proposedEditCount: totalEditCount,
          editSummaries: pendingEditSummaries,
        });
        store.setPhase('evaluating');

        const guidanceBefore = finalContent;
        const applyResult = await applyEditsWithLlm(
          finalContent, cappedEdits, loopConfig.charBudget, provider, signal,
        );
        finalContent = applyResult.content;
        totalEditsApplied += applyResult.applied + scopedEdits.length;
        allAppliedEdits.push(...cappedEdits.slice(0, applyResult.applied));
        allAppliedEdits.push(...scopedEdits);

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

      // Tier exhaustion — re-throw so pipeline can show upgrade prompt
      if ((err as any)?.tierExhausted) throw err;

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

  // ── Build final scoped rules from evaluator decisions ──────
  // The diagnosis step decided what scoped rules to create/delete.
  // Start with static rules, apply evaluator modifications.
  let finalRules: ScopedRule[] = staticRules ?? [];

  if (evaluatorEnabled) {
    // Remove rules the evaluator marked for deletion
    if (scopedRuleDeletes.length > 0) {
      const deleteSet = new Set(scopedRuleDeletes);
      finalRules = finalRules.filter((r) => !deleteSet.has(r.slug));
      log.info(`Evaluator pruned ${scopedRuleDeletes.length} scoped rule${scopedRuleDeletes.length === 1 ? '' : 's'}`);
    }

    // Add/update rules the evaluator created
    if (scopedRuleCreates.length > 0) {
      const createBySlug = new Map(scopedRuleCreates.map((r) => [r.slug, r]));
      // Update existing rules or add new ones
      finalRules = finalRules.map((r) => createBySlug.get(r.slug) ?? r);
      // Add truly new rules (not updates)
      const existingSlugs = new Set(finalRules.map((r) => r.slug));
      for (const r of scopedRuleCreates) {
        if (!existingSlugs.has(r.slug)) finalRules.push(r);
      }
      log.info(`Evaluator created/updated ${scopedRuleCreates.length} scoped rule${scopedRuleCreates.length === 1 ? '' : 's'}`);
    }
  }

  // ── Save probe-refine edits as preferences ───────────────
  if (evaluatorEnabled && allAppliedEdits.length > 0 && preferences) {
    try {
      let prefs = { ...preferences };
      for (const edit of allAppliedEdits) {
        const isSpecific = edit.section.startsWith('scoped:') ||
          /(?:^|\s)(?:\.\/|src\/|lib\/|app\/|packages\/|test\/|tests\/)\S+\.\w{1,4}/m.test(edit.content);
        prefs = addPreference(prefs, {
          rule: `probe-refine:${edit.section}`,
          pattern: edit.content.slice(0, 200),
          disposition: 'deny',
          directory: edit.globs?.[0],
          details: `action: ${edit.action}, section: ${edit.section}`,
          suggestion: edit.content,
          source: isSpecific ? 'probe-refine-specific' : 'probe-refine',
        });
      }
      savePreferences(root, prefs);
    } catch { /* best-effort — don't break the pipeline */ }
  }

  return { content: finalContent, reasoning: [], scopedRules: finalRules, deleteSlugs: scopedRuleDeletes };
}
