/**
 * Generation agent — generates AGENTS.md from scratch using static analysis.
 *
 * Single-pass: one LLM call produces the instructions content.
 * The KB (static analysis) is provided as context in the system prompt.
 * Quality assessment is handled externally by the evaluator package
 * (@aspectcode/evaluator) via probe-based testing:
 *   generate (1 call) → probe-test → diagnose → apply edits
 */

import type { ChatMessage, ChatUsage, OptimizeOptions, OptimizeResult, ComplaintOptions, ComplaintResult } from './types';
import {
  buildSystemPrompt,
  buildGeneratePrompt,
  buildComplaintPrompt,
  parseComplaintResponse,
} from './prompts';

/**
 * Run the generation agent — single-pass LLM generation.
 *
 * Generates AGENTS.md content from scratch using the KB (static analysis)
 * as context. The LLM sees the full knowledge base in the system prompt
 * and produces codebase-specific instructions in one call.
 * The evaluator package handles quality feedback externally.
 */
export async function runGenerateAgent(options: OptimizeOptions): Promise<OptimizeResult> {
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

  // Fallback content when we can't generate (cancellation / LLM error).
  const fallback = currentInstructions ?? '';

  if (signal?.aborted) {
    log?.info('Generation cancelled.');
    return {
      optimizedInstructions: fallback,
      reasoning: ['Cancelled by user'],
    };
  }

  const systemPrompt = buildSystemPrompt(kb, kbCharBudget, toolInstructions);

  // ── Generate instructions from scratch ────────────────────────
  onProgress?.({ kind: 'generating', detail: 'generating AGENTS.md…' });
  log?.info('Generating AGENTS.md from static analysis…');

  const generateMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildGeneratePrompt(kbDiff) },
  ];

  let candidate: string;
  let usage: ChatUsage | undefined;
  try {
    if (provider.chatWithUsage) {
      const result = await provider.chatWithUsage(generateMessages);
      candidate = result.content;
      usage = result.usage;
    } else {
      candidate = await provider.chat(generateMessages);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.error(`LLM call failed: ${msg}`);
    return {
      optimizedInstructions: fallback,
      reasoning: [`LLM error — ${msg}`],
    };
  }

  onProgress?.({ kind: 'done', detail: 'generation complete' });
  log?.info('Generation complete.');

  return {
    optimizedInstructions: candidate,
    reasoning: ['Single-pass generation from static analysis complete'],
    usage,
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
