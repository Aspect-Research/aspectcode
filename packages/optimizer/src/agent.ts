/**
 * Optimization agent — generates optimized AGENTS.md instructions.
 *
 * Single-pass: one LLM call produces the optimized instructions.
 * Quality assessment is handled externally by the evaluator package
 * (@aspectcode/evaluator) via probe-based testing:
 *   optimize (1 call) → probe-test → diagnose → apply edits
 */

import type { ChatMessage, OptimizeOptions, OptimizeResult, ComplaintOptions, ComplaintResult } from './types';
import {
  buildSystemPrompt,
  buildOptimizePrompt,
  buildComplaintPrompt,
  parseComplaintResponse,
} from './prompts';

/**
 * Run the optimization agent — single-pass LLM generation.
 *
 * Generates optimized AGENTS.md content in one call.
 * The evaluator package handles quality feedback externally.
 */
export async function runOptimizeAgent(options: OptimizeOptions): Promise<OptimizeResult> {
  const {
    currentInstructions,
    kb,
    kbDiff,
    toolInstructions,
    provider,
    log,
    signal,
    kbCharBudget,
    onProgress,
  } = options;

  if (signal?.aborted) {
    log?.info('Optimization cancelled.');
    return {
      optimizedInstructions: currentInstructions,
      reasoning: ['Cancelled by user'],
    };
  }

  const systemPrompt = buildSystemPrompt(kb, kbCharBudget, toolInstructions);

  // ── Generate optimized candidate ──────────────────────────
  onProgress?.({ kind: 'generating', detail: 'generating AGENTS.md…' });
  log?.info('Generating optimized AGENTS.md…');

  const optimizeMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildOptimizePrompt(currentInstructions, kbDiff) },
  ];

  let candidate: string;
  try {
    candidate = await provider.chat(optimizeMessages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.error(`LLM call failed: ${msg}`);
    return {
      optimizedInstructions: currentInstructions,
      reasoning: [`LLM error — ${msg}`],
    };
  }

  onProgress?.({ kind: 'done', detail: 'generation complete' });
  log?.info('Generation complete.');

  return {
    optimizedInstructions: candidate,
    reasoning: ['Single-pass generation complete'],
  };
}

// ── Complaint agent ──────────────────────────────────────────

/**
 * Process user complaints by asking the LLM to update AGENTS.md instructions.
 *
 * Unlike the iterative optimize agent, this is a single-call workflow:
 * 1. Send system context (KB) + complaint prompt.
 * 2. Parse structured response for changes list + updated instructions.
 */
export async function runComplaintAgent(options: ComplaintOptions): Promise<ComplaintResult> {
  const {
    currentInstructions,
    kb,
    complaints,
    provider,
    log,
    kbCharBudget,
    signal,
  } = options;

  if (signal?.aborted) {
    log?.info('Complaint processing cancelled.');
    return { optimizedInstructions: currentInstructions, changes: [] };
  }

  log?.info(`Processing ${complaints.length} complaint${complaints.length === 1 ? '' : 's'}…`);

  const systemPrompt = buildSystemPrompt(kb, kbCharBudget);
  const userPrompt = buildComplaintPrompt(currentInstructions, complaints);

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let response: string;
  try {
    response = await provider.chat(messages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.error(`Complaint LLM call failed: ${msg}`);
    return { optimizedInstructions: currentInstructions, changes: [`Error: ${msg}`] };
  }

  const parsed = parseComplaintResponse(response);
  log?.info(`Applied ${parsed.changes.length} change${parsed.changes.length === 1 ? '' : 's'}.`);

  return {
    optimizedInstructions: parsed.instructions,
    changes: parsed.changes,
  };
}
