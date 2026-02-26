/**
 * Optimize wrapper — tries LLM optimization, falls back to static content.
 *
 * - If an API key is available → run the optimization agent
 * - If evaluator is enabled → single-pass optimize then probe & diagnose
 * - If no API key → warn and write static AGENTS.md content
 */

import {
  resolveProvider,
  loadEnvFile,
  runGenerateAgent,
} from '@aspectcode/optimizer';
import type { ProviderOptions, OptimizeStep, ChatUsage } from '@aspectcode/optimizer';
import {
  generateProbes,
  runProbes,
  diagnose,
  applyDiagnosisEdits,
  harvestPrompts,
} from '@aspectcode/evaluator';
import type { HarvestedPrompt, PromptSource, ProbeProgressCallback } from '@aspectcode/evaluator';
import { generateCanonicalContentForMode } from '@aspectcode/emitters';
import type { RunContext } from './cli';
import type { AspectCodeConfig } from './config';
import { fmt } from './logger';
import { store } from './ui/store';

/** Result of the optimization attempt. */
export interface OptimizeOutput {
  content: string;
  /** Per-iteration reasoning (empty when no API key / static fallback). */
  reasoning: string[];
  /** Token usage from the generation LLM call (undefined when static fallback). */
  tokenUsage?: ChatUsage;
}

/**
 * Try to generate AGENTS.md content via LLM using static analysis as context.
 * Falls back to static instruction content when no API key is available.
 */
export async function tryOptimize(
  ctx: RunContext,
  kbContent: string,
  toolInstructions: Map<string, string>,
  config: AspectCodeConfig | undefined,
  baseContent: string,
): Promise<OptimizeOutput> {
  const { flags, log, root } = ctx;
  const optConfig = config?.optimize;
  const evalConfig = config?.evaluate;
  const evaluatorEnabled = evalConfig?.enabled !== false; // Default: true

  // ── Resolve settings ──────────────────────────────────────

  const temperature = flags.temperature ?? optConfig?.temperature;
  const model = flags.model ?? optConfig?.model;
  const providerName = flags.provider ?? optConfig?.provider;
  const maxTokens = optConfig?.maxTokens;

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
    // No API key available — fall back to static content
    store.addSetupNote('no API key — static mode');
    log.warn(
      'No LLM API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env for optimization.',
    );
    return {
      content: generateCanonicalContentForMode('safe', kbContent.length > 0),
      reasoning: [],
    };
  }

  const providerLabel = model ? `${provider.name} (${model})` : provider.name;
  store.addSetupNote(`API key: ${provider.name}`);
  if (evaluatorEnabled) {
    store.addSetupNote('evaluator on');
  }
  log.info(`Generating with ${fmt.cyan(provider.name)}${model ? ` (${fmt.cyan(model)})` : ''}…`);
  store.setProvider(providerLabel);

  // ── Use static content only as fallback (LLM error / cancellation) ─
  const fallbackContent = baseContent;

  // ── Build tool instructions context string ────────────────
  let toolContext = '';
  if (toolInstructions.size > 0) {
    const parts: string[] = [];
    for (const [tool, content] of toolInstructions) {
      parts.push(`### ${tool}\n${content}`);
    }
    toolContext = parts.join('\n\n');
  }

  // ── Progress callbacks for live dashboard updates ─────────
  const onProgress = (step: OptimizeStep): void => {
    switch (step.kind) {
      case 'generating':
        store.setPhase('optimizing', 'generating AGENTS.md…');
        break;
      case 'done':
        store.setPhase('optimizing', 'generation complete');
        break;
    }
  };

  // ── Wrap logger for dashboard ─────────────────────────────
  const optLog = flags.quiet ? undefined : {
    info(msg: string)  { log.info(msg); },
    warn(msg: string)  { log.warn(msg); },
    error(msg: string) { log.error(msg); },
    debug(msg: string) { log.debug(msg); },
  };

  // ── Harvest prompts for evaluator (if enabled) ────────────
  let harvestedPrompts: HarvestedPrompt[] = [];

  if (evaluatorEnabled && (evalConfig?.harvestPrompts !== false)) {
    try {
      store.setEvalStatus({ phase: 'harvesting' });
      store.setPhase('optimizing', 'harvesting prompts');
      harvestedPrompts = await harvestPrompts({
        root,
        sources: evalConfig?.harvestSources as PromptSource[] | undefined,
        maxPerSource: 50,
        log: optLog,
      });
      store.setEvalStatus({ phase: 'harvesting', harvestCount: harvestedPrompts.length });
      if (harvestedPrompts.length > 0) {
        log.info(`Harvested ${harvestedPrompts.length} prompts from AI tool history`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.debug(`Prompt harvesting failed (non-fatal): ${msg}`);
    }
  }

  const result = await runGenerateAgent({
    currentInstructions: fallbackContent,
    kb: kbContent,
    toolInstructions: toolContext || undefined,
    provider,
    log: optLog,
    onProgress,
  });

  for (const reason of result.reasoning) {
    log.debug(`  ${fmt.dim(reason)}`);
  }

  // Surface token usage from generation call
  if (result.usage) {
    store.setTokenUsage(result.usage);
  }

  // ── Evaluate with probes (if enabled) ─────────────────────
  let finalContent = result.optimizedInstructions;

  if (evaluatorEnabled) {
    try {
      store.setPhase('evaluating');
      store.setEvalStatus({ phase: 'probing' });
      log.info('Running probe-based evaluation…');

      const maxProbes = evalConfig?.maxProbes ?? 10;
      const probes = generateProbes({
        kb: kbContent,
        harvestedPrompts: harvestedPrompts.length > 0 ? harvestedPrompts : undefined,
        maxProbes,
      });

      // Per-probe progress callback for live dashboard
      const onProbeProgress: ProbeProgressCallback = (info) => {
        if (info.phase === 'starting') {
          store.setEvalStatus({
            phase: 'probing',
            probesPassed: undefined,
            probesTotal: info.total,
          });
          store.setPhase('evaluating', `probe ${info.probeIndex + 1}/${info.total}: ${info.probeId}`);
        } else {
          // 'done' — accumulate pass count from results so far
          store.setPhase('evaluating', `probe ${info.probeIndex + 1}/${info.total} ${info.passed ? '✔' : '✖'}`);
        }
      };

      const probeResults = await runProbes(
        finalContent,
        probes,
        provider,
        undefined, // fileContents
        optLog,
        undefined, // signal
        onProbeProgress,
      );

      const failures = probeResults.filter((r) => !r.passed);
      const passCount = probeResults.length - failures.length;

      store.setEvalStatus({
        phase: 'probing',
        probesPassed: passCount,
        probesTotal: probeResults.length,
      });
      log.info(
        `Probes: ${passCount}/${probeResults.length} passed` +
        (failures.length > 0 ? `, ${failures.length} failed` : ''),
      );

      // Diagnose and apply edits if there are failures
      if (failures.length > 0) {
        store.setEvalStatus({ phase: 'diagnosing' });
        store.setPhase('evaluating', 'diagnosing failures');

        const diagnosis = await diagnose(
          failures,
          finalContent,
          provider,
          optLog,
        );

        if (diagnosis && diagnosis.edits.length > 0) {
          store.setPhase('evaluating', 'applying fixes');
          log.info(`Applying ${diagnosis.edits.length} diagnosis-driven edits…`);

          const fixed = await applyDiagnosisEdits(
            finalContent,
            diagnosis,
            provider,
            optLog,
          );
          finalContent = fixed.content;
          log.info(`Diagnosis edits applied (${fixed.appliedEdits.length} changes)`);
        }

        store.setEvalStatus({
          phase: 'done',
          probesPassed: passCount,
          probesTotal: probeResults.length,
          diagnosisEdits: diagnosis?.edits.length ?? 0,
        });
      } else {
        store.setEvalStatus({
          phase: 'done',
          probesPassed: passCount,
          probesTotal: probeResults.length,
          diagnosisEdits: 0,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Evaluation failed (non-fatal): ${msg}`);
    }
  }

  store.setReasoning(result.reasoning);
  return {
    content: finalContent,
    reasoning: result.reasoning,
    tokenUsage: result.usage,
  };
}
