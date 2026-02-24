/**
 * Prompt templates for the optimization agent.
 *
 * Three prompts:
 * 1. System prompt — sets context with KB content.
 * 2. Optimize prompt — asks the LLM to refine instructions.
 * 3. Eval prompt — asks the LLM to score and critique a candidate.
 */

/** Default maximum KB characters to include before truncation. */
const DEFAULT_KB_CHAR_BUDGET = 60_000;

/**
 * Truncate KB content to fit within the character budget.
 * Preserves the Architecture section (most valuable) and trims Map/Context.
 */
export function truncateKb(kb: string, charBudget: number = DEFAULT_KB_CHAR_BUDGET): string {
  if (kb.length <= charBudget) return kb;

  // Try to keep the Architecture section intact
  const archEnd = kb.indexOf('## Map');
  if (archEnd > 0 && archEnd < charBudget) {
    const remaining = charBudget - archEnd;
    return (
      kb.slice(0, archEnd) +
      kb.slice(archEnd, archEnd + remaining) +
      '\n\n[... KB truncated for token budget ...]\n'
    );
  }

  return kb.slice(0, charBudget) + '\n\n[... KB truncated for token budget ...]\n';
}

/**
 * Build the system prompt that establishes the agent's role and
 * provides the full knowledge base as context.
 */
export function buildSystemPrompt(kb: string, kbCharBudget?: number, toolInstructions?: string): string {
  const trimmedKb = truncateKb(kb, kbCharBudget);

  let prompt = `You are an expert AI coding assistant instruction optimizer.

Your job is to improve AGENTS.md instructions — the guidelines that AI coding
assistants follow when working in a codebase. You optimize these instructions
so they are maximally useful, precise, and aligned with the actual codebase.

You have access to the project's knowledge base which contains:
- Architecture: high-risk files, directory layout, entry points
- Map: data models, symbol index, naming conventions
- Context: module clusters, external integrations, data flows

Use this knowledge to make the instructions specific, actionable, and grounded
in the real structure of the codebase. Remove vague advice, strengthen specific
guidance, and add project-specific rules that an AI assistant would benefit from.

## Knowledge Base
${trimmedKb}`;

  if (toolInstructions) {
    prompt += `

## Existing AI Tool Instructions (Context)

The following are instructions from other AI coding tools already present in
this workspace. Use them as additional context to understand the project's
coding standards, conventions, and any domain-specific guidelines. Your
optimized AGENTS.md should complement (not duplicate) this content.

${toolInstructions}`;
  }

  return prompt;
}

/**
 * Build the user prompt for instruction optimization.
 *
 * Includes the current instructions and optionally a KB diff showing
 * what changed in the codebase since the last generation.
 */
export function buildOptimizePrompt(
  currentInstructions: string,
  kbDiff?: string,
  priorFeedback?: string,
): string {
  let prompt = `Optimize the following AGENTS.md instructions. Make them more specific,
actionable, and aligned with the knowledge base provided in the system prompt.

## Rules
- Keep the same overall structure (sections, headers) unless restructuring improves clarity.
- Remove generic advice that any developer already knows.
- Add project-specific guidance derived from the knowledge base.
- Be concise — every line should earn its place.
- Output ONLY the optimized instruction content (no explanations or markdown fences).

## Current Instructions
${currentInstructions}`;

  if (kbDiff) {
    prompt += `

## Recent KB Changes (diff)
The following diff shows what changed in the knowledge base since the last generation.
Focus your optimization on areas affected by these changes:
${kbDiff}`;
  }

  if (priorFeedback) {
    prompt += `

## Prior Evaluation Feedback
A previous iteration received this feedback. Address these points:
${priorFeedback}`;
  }

  return prompt;
}

/**
 * Build the evaluation prompt that asks the LLM to score and critique
 * a candidate set of instructions.
 */
export function buildEvalPrompt(
  candidateInstructions: string,
  kb: string,
  kbCharBudget?: number,
): string {
  const trimmedKb = truncateKb(kb, kbCharBudget);

  return `You are evaluating AI coding assistant instructions (AGENTS.md) for quality.

Score the following candidate instructions on a scale of 1–10 based on:
1. **Specificity** — Are rules grounded in the actual codebase, not generic?
2. **Actionability** — Can an AI assistant follow each rule unambiguously?
3. **Completeness** — Are key architectural patterns and conventions covered?
4. **Conciseness** — Is every line valuable, with no filler?
5. **Alignment** — Do the instructions match the knowledge base accurately?

Respond in EXACTLY this format (no other text):
SCORE: <number 1-10>
FEEDBACK: <one paragraph of overall assessment>
SUGGESTIONS:
- <specific improvement 1>
- <specific improvement 2>
- <specific improvement 3>

## Knowledge Base (for reference)
${trimmedKb}

## Candidate Instructions
${candidateInstructions}`;
}

/**
 * Parse the structured evaluation response into an EvalResult.
 */
export function parseEvalResponse(response: string): {
  score: number;
  feedback: string;
  suggestions: string[];
} {
  const scoreMatch = response.match(/SCORE:\s*(\d+)/i);
  const score = scoreMatch ? Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10))) : 5;

  const feedbackMatch = response.match(/FEEDBACK:\s*(.+?)(?=SUGGESTIONS:|$)/is);
  const feedback = feedbackMatch ? feedbackMatch[1].trim() : 'No feedback provided.';

  const suggestionsMatch = response.match(/SUGGESTIONS:\s*([\s\S]*)/i);
  const suggestions: string[] = [];
  if (suggestionsMatch) {
    for (const line of suggestionsMatch[1].split('\n')) {
      const trimmed = line.replace(/^[-*]\s*/, '').trim();
      if (trimmed) suggestions.push(trimmed);
    }
  }

  return { score, feedback, suggestions };
}
