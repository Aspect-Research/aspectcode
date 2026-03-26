/**
 * Aggregate diagnosis — analyzes judged probe results and proposes AGENTS.md edits.
 *
 * Takes all judged probe results (including behaviour reviews and per-probe edits),
 * aggregates the failures, and proposes up to 6 targeted AGENTS.md edits.
 *
 * Ported from sweagent_bench oracle/diagnose.py.
 */

import type { ChatMessage } from '@aspectcode/optimizer';
import type {
  JudgedProbeResult,
  AgentsEdit,
  DiagnosisOptions,
} from './types';
import { chatWithTemp } from './llmUtil';

// ── Prompts ─────────────────────────────────────────────────

const DIAGNOSE_SYSTEM = `You are an expert AGENTS.md editor. You will be given the current AGENTS.md
and diagnostic probe outcomes. Your goal is to help the assistant produce
better fixes by proposing targeted edits.

Output a JSON array of edit objects, each with:
- "section": one of: "Operating Mode", "Procedural Standards", "High-Impact Hubs", "Entry Points", "Import Chains", "Validation", "Integration Risk", "Conventions", "Guardrails"
- "action": one of "add", "modify", "strengthen", "remove"
- "content": the specific text to add, modify, or strengthen

Rules:
- Keep edits specific and actionable.
- Focus on reusable repo-level exploration guidance.
- Prefer edits that help the assistant navigate *this* repo's structure
  over generic software-engineering process rules.
- Avoid one-off file paths/commands and speculative semantics changes.
- The "content" field must be the ACTUAL guideline text to appear in AGENTS.md as a bullet point.
  Write it as a direct imperative (e.g. "Verify target module exists before adding imports").
  NEVER write meta-instructions like "Add a step to...", "Include an example of...", or "Add specific instructions on...".
- Content must be general enough to apply across the repo, not tied to one specific probe scenario.
  Bad: "Ensure ThemeProvider wraps NavBar". Good: "Check context provider hierarchy when modifying wrapped components".
- Use "modify"/"strengthen" to refine existing guidance before adding new rules.
- Edits are optional: return [] when guidance is already strong.
- Return at most 6 edits.
- Keep the total AGENTS.md under 8,000 characters.
- Output ONLY the JSON array.`;

function buildDiagnoseUserPrompt(
  agentsMd: string,
  results: JudgedProbeResult[],
): string {
  const diagnostics = results.map((r, i) => {
    const reviews = r.behaviorReviews
      .map((br) =>
        `  * Behavior: ${br.behavior} | Assessment: ${br.assessment} | Evidence: ${br.evidence} | Improvement: ${br.improvement}`,
      )
      .join('\n');
    const edits = r.proposedEdits
      .map((e) => `  * ProposedEdit: ${e.action}@${e.section}: ${e.content}`)
      .join('\n');
    return `- Probe ${i + 1}: ${r.task}\n${reviews}\n  * Overall: ${r.overallNotes}\n${edits}`;
  }).join('\n\n');

  return `CURRENT AGENTS.MD:
---
${agentsMd}
---

PROBE DIAGNOSTICS:
${diagnostics}

Propose edits to improve AGENTS.md for future iterations.`;
}

// ── JSON parsing ────────────────────────────────────────────

interface RawEdit {
  section: string;
  action: string;
  content: string;
}

export function parseDiagnoseResponse(raw: string): RawEdit[] {
  // Strip thinking tags
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Strip code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed as RawEdit[];
  } catch {
    // Try to find JSON array
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]) as RawEdit[];
      } catch {
        // fall through
      }
    }
  }

  return [];
}

// ── Public API ──────────────────────────────────────────────

/**
 * Diagnose AGENTS.md shortcomings from judged probe results.
 *
 * Aggregates all probe behavior reviews and per-probe edits,
 * then proposes up to 6 aggregate edits via a single LLM call.
 */
export async function diagnose(options: DiagnosisOptions): Promise<AgentsEdit[]> {
  const { judgedResults, agentsContent, provider, log, signal } = options;

  if (judgedResults.length === 0) return [];
  if (signal?.aborted) return [];

  // Only send probes that have non-strong behaviours
  const weakResults = judgedResults.filter((r) =>
    r.behaviorReviews.some((br) => br.assessment !== 'strong'),
  );

  if (weakResults.length === 0) {
    log?.info('All probes assessed as strong — no diagnosis needed.');
    return [];
  }

  log?.info(`Diagnosing ${weakResults.length} probe result${weakResults.length === 1 ? '' : 's'} with weak behaviors…`);

  const userPrompt = buildDiagnoseUserPrompt(agentsContent, weakResults);
  const messages: ChatMessage[] = [
    { role: 'system', content: DIAGNOSE_SYSTEM },
    { role: 'user', content: userPrompt },
  ];

  let response: string;
  try {
    response = await chatWithTemp(provider, messages, 0.0, signal);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.error(`Diagnosis LLM call failed: ${msg}`);
    return [];
  }

  const rawEdits = parseDiagnoseResponse(response);

  const edits: AgentsEdit[] = rawEdits
    .slice(0, 6)
    .filter((e) => e.section && e.action && e.content)
    .map((e) => ({
      section: e.section,
      action: (['add', 'modify', 'strengthen', 'remove'].includes(e.action)
        ? e.action
        : 'add') as AgentsEdit['action'],
      content: e.content,
    }));

  log?.info(`Diagnosis: ${edits.length} edit${edits.length === 1 ? '' : 's'} proposed`);
  return edits;
}
