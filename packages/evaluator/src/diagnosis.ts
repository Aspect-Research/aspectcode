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

const DIAGNOSE_SYSTEM = `You are an expert context editor for AI coding assistants. You manage AGENTS.md (general guidance) and scoped rules (directory-specific guidance).

Output a JSON array of edit objects, each with:
- "section": an AGENTS.md section OR "scoped:slug" to edit a scoped rule OR "scoped:CREATE:slug" to create one OR "scoped:DELETE:slug" to remove one
- "action": one of "add", "modify", "strengthen", "remove"
- "content": the specific text (for AGENTS.md: a bullet point; for scoped rules: full markdown body)
- "globs": (only for scoped:CREATE) array of glob patterns, e.g. ["src/core/**"]
- "description": (only for scoped:CREATE) short description of the rule

AGENTS.md sections: "Operating Mode", "Procedural Standards", "High-Impact Hubs", "Entry Points", "Import Chains", "Validation", "Integration Risk", "Conventions", "Guardrails", "Setup"

Rules:
- STRONGLY prefer editing AGENTS.md over creating scoped rules. Scoped rules are only for content that is truly directory-specific and would be misleading if applied globally.
- Do NOT create scoped rules for naming conventions alone — that belongs in AGENTS.md.
- Keep edits specific and actionable. Write direct imperatives.
- Content must be general enough to apply broadly, not tied to one probe scenario.
- Use "modify"/"strengthen" to refine existing guidance before adding new rules.
- You may delete scoped rules that are redundant, trivial, or already covered by AGENTS.md.
- Edits are optional: return [] when guidance is already strong.
- Return at most 8 edits total.
- Keep AGENTS.md under 8,000 characters.
- Output ONLY the JSON array.`;

function buildDiagnoseUserPrompt(
  agentsMd: string,
  results: JudgedProbeResult[],
  scopedRulesContext?: string,
  staticAnalysisData?: string,
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

  let prompt = `CURRENT AGENTS.MD:
---
${agentsMd}
---`;

  if (scopedRulesContext) {
    prompt += `

CURRENT SCOPED RULES:
---
${scopedRulesContext}
---`;
  }

  if (staticAnalysisData) {
    prompt += `

STATIC ANALYSIS DATA:
${staticAnalysisData}`;
  }

  prompt += `

PROBE DIAGNOSTICS:
${diagnostics}

Propose edits to improve the guidance. You may edit AGENTS.md sections, create/update/delete scoped rules, or return [] if no changes needed.`;

  return prompt;
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
  const { judgedResults, agentsContent, provider, log, signal, scopedRulesContext, staticAnalysisData } = options;

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

  const userPrompt = buildDiagnoseUserPrompt(agentsContent, weakResults, scopedRulesContext, staticAnalysisData);
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
    .slice(0, 8)
    .filter((e) => e.section && e.action)
    .map((e) => ({
      section: e.section,
      action: (['add', 'modify', 'strengthen', 'remove'].includes(e.action)
        ? e.action
        : 'add') as AgentsEdit['action'],
      content: e.content || '',
      globs: (e as any).globs,
      description: (e as any).description,
    }));

  const agentsEdits = edits.filter((e) => !e.section.startsWith('scoped:'));
  const scopedEdits = edits.filter((e) => e.section.startsWith('scoped:'));
  log?.info(`Diagnosis: ${agentsEdits.length} AGENTS.md edit${agentsEdits.length === 1 ? '' : 's'}, ${scopedEdits.length} scoped rule edit${scopedEdits.length === 1 ? '' : 's'}`);
  return edits;
}
