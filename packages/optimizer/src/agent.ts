/**
 * Optimization agent — generates optimized AGENTS.md instructions.
 *
 * Two modes:
 * 1. **Single-pass** (default): One LLM call produces the optimized instructions.
 *    The evaluator package (@aspectcode/evaluator) handles quality assessment
 *    externally via probe-based testing.
 * 2. **Legacy iterative**: Retained for backward compatibility. Uses self-eval
 *    scoring to iterate. Set `maxIterations > 1` to enable.
 *
 * The recommended workflow is single-pass + evaluator:
 *   optimize (1 call) → probe-test → diagnose → apply edits
 */

import type { ChatMessage, OptimizeOptions, OptimizeResult, EvalResult, ComplaintOptions, ComplaintResult } from './types';
import {
  buildSystemPrompt,
  buildOptimizePrompt,
  buildEvalPrompt,
  parseEvalResponse,
  buildComplaintPrompt,
  parseComplaintResponse,
} from './prompts';

/** Default minimum eval score to accept a candidate without further iteration. */
const DEFAULT_ACCEPT_THRESHOLD = 8;

/** Helper: sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the optimization agent loop.
 *
 * @returns The best optimized instructions found within maxIterations.
 */
export async function runOptimizeAgent(options: OptimizeOptions): Promise<OptimizeResult> {
  const {
    currentInstructions,
    kb,
    kbDiff,
    toolInstructions,
    maxIterations,
    provider,
    log,
    acceptThreshold = DEFAULT_ACCEPT_THRESHOLD,
    signal,
    iterationDelayMs = 0,
    kbCharBudget,
    evaluatorFeedback,
  } = options;

  const systemPrompt = buildSystemPrompt(kb, kbCharBudget, toolInstructions);
  const reasoning: string[] = [];

  let bestCandidate = currentInstructions;
  let bestScore = 0;
  // Seed with evaluator feedback when available (probe-based evidence)
  let priorFeedback: string | undefined = evaluatorFeedback;

  for (let i = 0; i < maxIterations; i++) {
    // ── Check cancellation ───────────────────────────────
    if (signal?.aborted) {
      log?.info('Optimization cancelled.');
      reasoning.push(`Iteration ${i + 1}: cancelled by user`);
      break;
    }

    // ── Inter-iteration delay (skip before first) ────────
    if (i > 0 && iterationDelayMs > 0) {
      log?.debug(`Waiting ${iterationDelayMs}ms before next iteration…`);
      await sleep(iterationDelayMs);
      if (signal?.aborted) {
        log?.info('Optimization cancelled during delay.');
        reasoning.push(`Iteration ${i + 1}: cancelled by user`);
        break;
      }
    }

    log?.info(`Optimize iteration ${i + 1}/${maxIterations}…`);

    // ── Step 1: Generate optimized candidate ─────────────
    const optimizeMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildOptimizePrompt(currentInstructions, kbDiff, priorFeedback) },
    ];

    let candidate: string;
    try {
      candidate = await provider.chat(optimizeMessages);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.error(`LLM call failed: ${msg}`);
      reasoning.push(`Iteration ${i + 1}: LLM error — ${msg}`);
      break;
    }

    // ── Step 2: Self-evaluate ────────────────────────────
    if (signal?.aborted) {
      // Accept the candidate we just got since we can't eval
      if (bestScore === 0) {
        bestCandidate = candidate;
      }
      reasoning.push(`Iteration ${i + 1}: cancelled before eval`);
      break;
    }

    log?.debug(`Evaluating candidate (iteration ${i + 1})…`);

    let evalResult: EvalResult;
    try {
      const evalMessages: ChatMessage[] = [
        { role: 'user', content: buildEvalPrompt(candidate, kb, kbCharBudget) },
      ];
      const evalResponse = await provider.chat(evalMessages);
      evalResult = parseEvalResponse(evalResponse);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.warn(`Eval call failed: ${msg}. Tracking candidate as best-effort.`);
      reasoning.push(`Iteration ${i + 1}: eval error — ${msg}`);
      // Track as best candidate if nothing better exists, but don't auto-accept
      if (bestScore === 0) {
        bestCandidate = candidate;
      }
      continue;
    }

    reasoning.push(
      `Iteration ${i + 1}: score=${evalResult.score}/10 — ${evalResult.feedback}`,
    );
    log?.info(`  Score: ${evalResult.score}/10`);

    // Track best candidate
    if (evalResult.score > bestScore) {
      bestScore = evalResult.score;
      bestCandidate = candidate;
    }

    // ── Step 3: Accept or refine ─────────────────────────
    if (evalResult.score >= acceptThreshold) {
      log?.info(`  Accepted (score ≥ ${acceptThreshold})`);
      return {
        optimizedInstructions: candidate,
        iterations: i + 1,
        reasoning,
      };
    }

    // Build feedback for next iteration
    priorFeedback =
      `Score: ${evalResult.score}/10\n${evalResult.feedback}\n\nSuggestions:\n` +
      evalResult.suggestions.map((s) => `- ${s}`).join('\n');
  }

  // Exhausted iterations or cancelled — return best seen
  log?.info(`Returning best candidate (score ${bestScore}/10).`);
  return {
    optimizedInstructions: bestCandidate,
    iterations: maxIterations,
    reasoning,
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
