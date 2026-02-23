/**
 * Optimization agent — iterative optimize → evaluate → refine loop.
 *
 * The agent:
 * 1. Sends KB + current instructions to the LLM for optimization.
 * 2. Evaluates the candidate with a self-eval prompt.
 * 3. If the score exceeds the threshold, returns the candidate.
 * 4. Otherwise feeds the eval feedback back and tries again.
 * 5. After maxIterations, returns the best candidate seen.
 */

import type { ChatMessage, OptimizeOptions, OptimizeResult, EvalResult } from './types';
import {
  buildSystemPrompt,
  buildOptimizePrompt,
  buildEvalPrompt,
  parseEvalResponse,
} from './prompts';

/** Minimum eval score to accept a candidate without further iteration. */
const ACCEPT_THRESHOLD = 8;

/**
 * Run the optimization agent loop.
 *
 * @returns The best optimized instructions found within maxIterations.
 */
export async function runOptimizeAgent(options: OptimizeOptions): Promise<OptimizeResult> {
  const { currentInstructions, kb, kbDiff, maxIterations, provider, log } = options;

  const systemPrompt = buildSystemPrompt(kb);
  const reasoning: string[] = [];

  let bestCandidate = currentInstructions;
  let bestScore = 0;
  let priorFeedback: string | undefined;

  for (let i = 0; i < maxIterations; i++) {
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
    log?.debug(`Evaluating candidate (iteration ${i + 1})…`);

    let evalResult: EvalResult;
    try {
      const evalMessages: ChatMessage[] = [
        { role: 'user', content: buildEvalPrompt(candidate, kb) },
      ];
      const evalResponse = await provider.chat(evalMessages);
      evalResult = parseEvalResponse(evalResponse);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.warn(`Eval call failed: ${msg}. Accepting candidate as-is.`);
      reasoning.push(`Iteration ${i + 1}: eval error — ${msg}`);
      // Accept the candidate if eval fails
      return {
        optimizedInstructions: candidate,
        iterations: i + 1,
        reasoning,
      };
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
    if (evalResult.score >= ACCEPT_THRESHOLD) {
      log?.info(`  Accepted (score ≥ ${ACCEPT_THRESHOLD})`);
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

  // Exhausted iterations — return best seen
  log?.info(`Max iterations reached. Returning best candidate (score ${bestScore}/10).`);
  return {
    optimizedInstructions: bestCandidate,
    iterations: maxIterations,
    reasoning,
  };
}
