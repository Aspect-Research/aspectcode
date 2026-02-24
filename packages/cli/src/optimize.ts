/**
 * Optimize wrapper — tries LLM optimization, falls back to static content.
 *
 * - If an API key is available → run the optimization agent
 * - If no API key → warn and write static AGENTS.md content
 */

import {
  resolveProvider,
  loadEnvFile,
  runOptimizeAgent,
} from '@aspectcode/optimizer';
import type { ProviderOptions } from '@aspectcode/optimizer';
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
}

/**
 * Try to optimize AGENTS.md content via LLM.
 * Falls back to static instruction content when no API key is available.
 */
export async function tryOptimize(
  ctx: RunContext,
  kbContent: string,
  toolInstructions: Map<string, string>,
  config: AspectCodeConfig | undefined,
): Promise<OptimizeOutput> {
  const { flags, log, root } = ctx;
  const optConfig = config?.optimize;

  // ── Resolve settings ──────────────────────────────────────
  const maxIterations = flags.maxIterations ?? optConfig?.maxIterations ?? 3;
  const acceptThreshold = flags.acceptThreshold ?? optConfig?.acceptThreshold ?? 8;
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
    log.warn(
      'No LLM API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env for optimization.',
    );
    return {
      content: generateCanonicalContentForMode('safe', kbContent.length > 0),
      reasoning: [],
    };
  }

  log.info(`Optimizing with ${fmt.cyan(provider.name)}${model ? ` (${fmt.cyan(model)})` : ''}…`);
  store.setProvider(model ? `${provider.name} (${model})` : provider.name);

  // ── Build current instructions (read existing AGENTS.md or use static) ──
  let currentInstructions: string;
  try {
    const fs = await import('fs');
    const path = await import('path');
    const agentsPath = path.join(root, 'AGENTS.md');
    if (fs.existsSync(agentsPath)) {
      currentInstructions = fs.readFileSync(agentsPath, 'utf-8');
    } else {
      currentInstructions = generateCanonicalContentForMode('safe', true);
    }
  } catch {
    currentInstructions = generateCanonicalContentForMode('safe', true);
  }

  // ── Build tool instructions context string ────────────────
  let toolContext = '';
  if (toolInstructions.size > 0) {
    const parts: string[] = [];
    for (const [tool, content] of toolInstructions) {
      parts.push(`### ${tool}\n${content}`);
    }
    toolContext = parts.join('\n\n');
  }

  // ── Run optimization agent ────────────────────────────────
  // Wrap the logger to capture iteration progress for the dashboard
  const iterationPattern = /^Optimize iteration (\d+)\/(\d+)/;
  const optLog = flags.quiet ? undefined : {
    info(msg: string)  {
      const m = iterationPattern.exec(msg);
      if (m) store.setPhase('optimizing', `iteration ${m[1]}/${m[2]}`);
      log.info(msg);
    },
    warn(msg: string)  { log.warn(msg); },
    error(msg: string) { log.error(msg); },
    debug(msg: string) { log.debug(msg); },
  };

  const result = await runOptimizeAgent({
    currentInstructions,
    kb: kbContent,
    toolInstructions: toolContext || undefined,
    maxIterations,
    provider,
    log: optLog,
    acceptThreshold,
    iterationDelayMs: 1_000,
  });

  log.info(
    `Optimized in ${result.iterations} iteration${result.iterations === 1 ? '' : 's'}`,
  );
  for (const reason of result.reasoning) {
    log.debug(`  ${fmt.dim(reason)}`);
  }

  store.setReasoning(result.reasoning);
  return {
    content: result.optimizedInstructions,
    reasoning: result.reasoning,
  };
}
