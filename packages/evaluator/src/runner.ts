/**
 * Probe runner — simulates AI responses to probes using AGENTS.md as context.
 *
 * For each probe, constructs a chat where:
 * - System prompt = current AGENTS.md + relevant file contents
 * - User prompt = the probe's task
 * Then sends it to the LLM and collects the response.
 */

import type { LlmProvider, ChatMessage, OptLogger } from '@aspectcode/optimizer';
import type { Probe, ProbeResult, BehaviorResult } from './types';

/** Maximum file content characters to include per probe. */
const MAX_CONTEXT_CHARS = 20_000;

/**
 * Build the system prompt for a probe run.
 * Includes the AGENTS.md instructions and relevant file contents.
 */
function buildProbeSystemPrompt(
  agentsContent: string,
  probe: Probe,
  fileContents?: ReadonlyMap<string, string>,
): string {
  let prompt = `You are an AI coding assistant. Follow these project instructions:\n\n${agentsContent}`;

  if (fileContents && probe.contextFiles.length > 0) {
    let contextChars = 0;
    const fileSections: string[] = [];

    for (const filePath of probe.contextFiles) {
      const content = fileContents.get(filePath);
      if (!content) continue;
      if (contextChars + content.length > MAX_CONTEXT_CHARS) break;
      fileSections.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\``);
      contextChars += content.length;
    }

    if (fileSections.length > 0) {
      prompt += `\n\n## Relevant Files\n\n${fileSections.join('\n\n')}`;
    }
  }

  return prompt;
}

/**
 * Build the evaluation prompt that scores a probe response
 * against expected behaviours.
 */
function buildBehaviorEvalPrompt(
  probe: Probe,
  response: string,
): string {
  const behaviors = probe.expectedBehaviors
    .map((b, i) => `${i + 1}. ${b}`)
    .join('\n');

  return `You are evaluating an AI coding assistant's response to a specific task.

## Task Given
${probe.task}

## Expected Behaviours
The response should exhibit ALL of these behaviours:
${behaviors}

## AI Response
${response}

## Instructions
For EACH expected behaviour, determine if the response exhibits it.
Respond in EXACTLY this format (one line per behaviour):

BEHAVIOR_1: PASS|FAIL — <brief explanation>
BEHAVIOR_2: PASS|FAIL — <brief explanation>
...

Then a final line:
OVERALL: PASS|FAIL`;
}

/** Parse the structured behaviour evaluation response. */
function parseBehaviorEval(
  response: string,
  expectedBehaviors: string[],
): { results: BehaviorResult[]; allPassed: boolean } {
  const results: BehaviorResult[] = [];
  const lines = response.split('\n');

  for (let i = 0; i < expectedBehaviors.length; i++) {
    const pattern = new RegExp(`BEHAVIOR_${i + 1}:\\s*(PASS|FAIL)\\s*[—-]\\s*(.*)`, 'i');
    const match = lines.find((l) => pattern.test(l));
    const parsed = match ? pattern.exec(match) : null;

    results.push({
      behavior: expectedBehaviors[i],
      passed: parsed ? parsed[1].toUpperCase() === 'PASS' : false,
      explanation: parsed ? parsed[2].trim() : 'Could not parse evaluation result',
    });
  }

  const allPassed = results.every((r) => r.passed);
  return { results, allPassed };
}

/**
 * Run a single probe: simulate the AI response, then evaluate it.
 */
async function runSingleProbe(
  probe: Probe,
  agentsContent: string,
  provider: LlmProvider,
  fileContents?: ReadonlyMap<string, string>,
  log?: OptLogger,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  if (signal?.aborted) {
    return {
      probeId: probe.id,
      passed: false,
      response: '',
      shortcomings: ['Cancelled'],
      behaviorResults: [],
    };
  }

  // Step 1: Simulate the AI response using AGENTS.md as context
  log?.debug(`Running probe: ${probe.id}`);

  const systemPrompt = buildProbeSystemPrompt(agentsContent, probe, fileContents);
  const simMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: probe.task },
  ];

  let response: string;
  try {
    response = await provider.chat(simMessages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn(`Probe ${probe.id} simulation failed: ${msg}`);
    return {
      probeId: probe.id,
      passed: false,
      response: '',
      shortcomings: [`LLM error during simulation: ${msg}`],
      behaviorResults: [],
    };
  }

  if (signal?.aborted) {
    return {
      probeId: probe.id,
      passed: false,
      response,
      shortcomings: ['Cancelled during evaluation'],
      behaviorResults: [],
    };
  }

  // Step 2: Evaluate the response against expected behaviours
  log?.debug(`Evaluating probe: ${probe.id}`);

  const evalPrompt = buildBehaviorEvalPrompt(probe, response);
  const evalMessages: ChatMessage[] = [
    { role: 'user', content: evalPrompt },
  ];

  let evalResponse: string;
  try {
    evalResponse = await provider.chat(evalMessages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn(`Probe ${probe.id} evaluation failed: ${msg}`);
    return {
      probeId: probe.id,
      passed: false,
      response,
      shortcomings: [`LLM error during evaluation: ${msg}`],
      behaviorResults: [],
    };
  }

  const { results: behaviorResults, allPassed } = parseBehaviorEval(
    evalResponse,
    probe.expectedBehaviors,
  );

  const shortcomings = behaviorResults
    .filter((r) => !r.passed)
    .map((r) => `${r.behavior}: ${r.explanation}`);

  return {
    probeId: probe.id,
    passed: allPassed,
    response,
    shortcomings,
    behaviorResults,
  };
}

/**
 * Run all probes against the current AGENTS.md.
 *
 * Each probe is run sequentially (to respect rate limits).
 * Returns results for all probes.
 */
export async function runProbes(
  agentsContent: string,
  probes: Probe[],
  provider: LlmProvider,
  fileContents?: ReadonlyMap<string, string>,
  log?: OptLogger,
  signal?: AbortSignal,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  for (const probe of probes) {
    if (signal?.aborted) break;

    const result = await runSingleProbe(
      probe,
      agentsContent,
      provider,
      fileContents,
      log,
      signal,
    );
    results.push(result);

    log?.info(`  ${result.passed ? '✔' : '✖'} ${probe.id}`);
  }

  return results;
}

// Exported for testing
export { buildProbeSystemPrompt, buildBehaviorEvalPrompt, parseBehaviorEval };
