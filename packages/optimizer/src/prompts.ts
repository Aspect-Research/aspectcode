/**
 * Prompt templates for the optimization agent.
 *
 * Two prompts:
 * 1. System prompt — sets context with KB content.
 * 2. Optimize prompt — asks the LLM to generate optimized instructions.
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

Below is the project's internal knowledge base. Use it as YOUR private
reference to understand the codebase — but NEVER reference it in the output.
The AI assistant reading AGENTS.md will NOT have access to the knowledge base,
Map section, symbol index, or any other external document. All codebase-specific
guidance (file paths, naming conventions, key modules, architectural patterns)
must be written directly as self-contained rules inside AGENTS.md.

Forbidden in output:
- References to "the Map", "the KB", "the knowledge base", "the Context section"
- Phrases like "see kb.md", "consult the symbol index", "as shown in the Architecture section"
- Any instruction that assumes access to a document besides AGENTS.md itself

## Knowledge Base (private reference — do not mention in output)
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
): string {
  let prompt = `Optimize the following AGENTS.md instructions. Make them more specific,
actionable, and self-contained.

## Rules
- Keep the same overall structure (sections, headers) unless restructuring improves clarity.
- Remove generic advice that any developer already knows.
- Inline project-specific guidance (file paths, naming conventions, key modules, architectural
  patterns) directly as rules. Derive these from the knowledge base in the system prompt,
  but NEVER reference the knowledge base, Map, or any external document in the output.
- AGENTS.md must be fully self-contained — the AI reading it will have no other reference.
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

  return prompt;
}

// ── Complaint-driven prompts ─────────────────────────────────

/**
 * Build a prompt that instructs the LLM to address specific user complaints
 * by modifying the AGENTS.md instructions.
 */
export function buildComplaintPrompt(
  currentInstructions: string,
  complaints: string[],
): string {
  const numbered = complaints.map((c, i) => `${i + 1}. ${c}`).join('\n');

  return `You are updating AGENTS.md instructions to address user complaints about
AI coding assistant behaviour. Each complaint describes something the AI did
wrong or forgot. Your job is to add, modify, or strengthen rules so the
described problem will not happen again.

## Complaints
${numbered}

## Current Instructions
${currentInstructions}

## Rules
- Address EVERY complaint. For each one, add or modify a specific, actionable rule.
- Do NOT remove existing rules unless they directly contradict a fix.
- Keep instructions concise — each new rule should be one or two lines.
- AGENTS.md must be fully self-contained. Never add rules that reference external
  documents like the knowledge base, Map section, KB, or symbol index. The AI
  reading AGENTS.md will not have access to any other file.
- Output the FULL updated instructions (not just the diff).

Respond in EXACTLY this format:

CHANGES:
- <short description of change 1>
- <short description of change 2>
...

INSTRUCTIONS:
<full updated instructions content>`;
}

/**
 * Parse a complaint response into changes + updated instructions.
 */
export function parseComplaintResponse(response: string): {
  changes: string[];
  instructions: string;
} {
  const changes: string[] = [];

  const changesMatch = response.match(/CHANGES:\s*([\s\S]*?)(?=\nINSTRUCTIONS:)/i);
  if (changesMatch) {
    for (const line of changesMatch[1].split('\n')) {
      const trimmed = line.replace(/^[-*]\s*/, '').trim();
      if (trimmed) changes.push(trimmed);
    }
  }

  const instructionsMatch = response.match(/INSTRUCTIONS:\s*([\s\S]*)/i);
  const instructions = instructionsMatch
    ? instructionsMatch[1].trim()
    : response.trim(); // fallback: treat entire response as instructions

  return { changes, instructions };
}
