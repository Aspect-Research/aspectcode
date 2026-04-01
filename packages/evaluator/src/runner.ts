/**
 * Probe runner — simulates AI responses to probes using AGENTS.md as context.
 *
 * For each probe, constructs a chat where:
 * - System prompt = current AGENTS.md
 * - User prompt = the probe's task
 * Then sends it to the LLM (temperature 0.0) and returns the raw response.
 *
 * Judging/evaluation is handled separately by the judge module.
 */

import type { ChatMessage } from '@aspectcode/optimizer';
import type {
  Probe,
  SimulationResult,
  LlmProvider,
  OptLogger,
  ProbeProgressCallback,
} from './types';
import { chatWithTemp } from './llmUtil';

/**
 * Run a single probe simulation.
 * Returns the raw AI response without evaluation.
 */
async function simulateProbe(
  probe: Probe,
  agentsContent: string,
  provider: LlmProvider,
  log?: OptLogger,
  signal?: AbortSignal,
): Promise<SimulationResult> {
  if (signal?.aborted) {
    return { probeId: probe.id, task: probe.task, response: '' };
  }

  log?.debug(`Simulating probe: ${probe.id}`);

  const systemPrompt = `You are an AI coding assistant. Follow these project instructions:\n\n${agentsContent}`;
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: probe.task },
  ];

  let response: string;
  try {
    response = await chatWithTemp(provider, messages, 0.0, signal);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn(`Probe ${probe.id} simulation failed: ${msg}`);
    return { probeId: probe.id, task: probe.task, response: '' };
  }

  return { probeId: probe.id, task: probe.task, response };
}

/**
 * Run all probes against the current AGENTS.md.
 *
 * Each probe is run sequentially (to respect rate limits).
 * Returns simulation results (raw responses, no evaluation).
 */
export async function runProbes(
  agentsContent: string,
  probes: Probe[],
  provider: LlmProvider,
  log?: OptLogger,
  signal?: AbortSignal,
  onProbeProgress?: ProbeProgressCallback,
): Promise<SimulationResult[]> {
  const results: SimulationResult[] = [];

  for (let idx = 0; idx < probes.length; idx++) {
    const probe = probes[idx];
    if (signal?.aborted) break;

    onProbeProgress?.({ probeIndex: idx, total: probes.length, probeId: probe.id, phase: 'starting' });

    const result = await simulateProbe(probe, agentsContent, provider, log, signal);
    results.push(result);

    const hasResponse = result.response.length > 0;
    onProbeProgress?.({ probeIndex: idx, total: probes.length, probeId: probe.id, phase: 'done', passed: hasResponse });
    log?.info(`  ${hasResponse ? '✔' : '✖'} ${probe.id}`);
  }

  return results;
}
