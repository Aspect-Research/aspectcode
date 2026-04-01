/**
 * Per-probe judge — evaluates AI responses with strong/partial/missing assessments.
 *
 * For each probe, the judge reviews the simulated response against expected
 * behaviours and proposes targeted AGENTS.md edits.
 *
 * Ported from sweagent_bench oracle/judge.py.
 */

import type { ChatMessage } from '@aspectcode/optimizer';
import type {
  JudgedProbeResult,
  BehaviorReview,
  AgentsEdit,
  JudgeOptions,
} from './types';
import { chatWithTemp } from './llmUtil';

// ── Prompts ─────────────────────────────────────────────────

const JUDGE_SYSTEM = `You are an evaluator/editor for AGENTS.md quality.
You will be given a TASK, the assistant RESPONSE, and EXPECTED BEHAVIORS.

Assess each behavior with one of: "strong", "partial", "missing".

Return a JSON object with this exact shape:
{
    "behavior_reviews": [
        {
            "behavior": "...",
            "assessment": "strong|partial|missing",
            "evidence": "short evidence from response",
            "improvement": "what AGENTS.md should add/change"
        }
    ],
    "proposed_edits": [
        {"section": "Operating Mode|Procedural Standards|High-Impact Hubs|Entry Points|Import Chains|Validation|Integration Risk|Conventions|Guardrails", "action": "add|modify|strengthen|remove", "content": "..."}
    ],
    "overall_notes": "short summary"
}

Rules:
- Judge whether the response produced a focused, plausible fix grounded in repo evidence.
- Prefer edits that improve repo-specific guidance, not generic checklists.
- The "content" field must be the ACTUAL guideline text to appear in AGENTS.md as a bullet point.
  Write it as a direct imperative (e.g. "Verify component exists before importing").
  NEVER write meta-instructions like "Add a step to..." or "Include an example of...".
- Content must be general enough to help across the repo, not tied to one probe scenario.
- Edits are optional; return [] if behavior is already strong.
- Return at most 3 proposed edits.
- Output ONLY valid JSON.`;

function buildJudgeUserPrompt(
  task: string,
  response: string,
  expectedBehaviors: string[],
): string {
  const behaviors = expectedBehaviors.map((b, i) => `${i + 1}. ${b}`).join('\n');
  return `TASK:\n${task}\n\nRESPONSE:\n${response}\n\nEXPECTED BEHAVIORS:\n${behaviors}\n\nProduce behavior_reviews and proposed_edits JSON.`;
}

// ── JSON parsing ────────────────────────────────────────────

export interface JudgeResponse {
  behavior_reviews: Array<{
    behavior: string;
    assessment: string;
    evidence: string;
    improvement: string;
  }>;
  proposed_edits: Array<{
    section: string;
    action: string;
    content: string;
  }>;
  overall_notes: string;
}

export function parseJudgeResponse(raw: string): JudgeResponse | null {
  // Strip thinking tags if present
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Strip code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

  try {
    return JSON.parse(cleaned) as JudgeResponse;
  } catch {
    // Try to find JSON object in the response
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as JudgeResponse;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────

/**
 * Judge a single probe's response against expected behaviours.
 *
 * Returns structured assessments (strong/partial/missing) and
 * up to 3 proposed AGENTS.md edits.
 */
export async function judgeProbe(options: JudgeOptions): Promise<JudgedProbeResult> {
  const { task, response, expectedBehaviors, probeId, provider, log, signal } = options;

  if (signal?.aborted) {
    return {
      probeId,
      task,
      response,
      behaviorReviews: [],
      proposedEdits: [],
      overallNotes: 'Cancelled',
    };
  }

  log?.debug(`Judging probe: ${probeId}`);

  const userPrompt = buildJudgeUserPrompt(task, response, expectedBehaviors);
  const messages: ChatMessage[] = [
    { role: 'system', content: JUDGE_SYSTEM },
    { role: 'user', content: userPrompt },
  ];

  let llmResponse: string;
  try {
    llmResponse = await chatWithTemp(provider, messages, 0.0, signal);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn(`Judge call failed for ${probeId}: ${msg}`);
    return {
      probeId,
      task,
      response,
      behaviorReviews: expectedBehaviors.map((b) => ({
        behavior: b,
        assessment: 'missing' as const,
        evidence: '',
        improvement: `Judge call failed: ${msg}`,
      })),
      proposedEdits: [],
      overallNotes: `Judge call failed: ${msg}`,
    };
  }

  const parsed = parseJudgeResponse(llmResponse);

  if (!parsed) {
    log?.warn(`Could not parse judge response for ${probeId}`);
    return {
      probeId,
      task,
      response,
      behaviorReviews: expectedBehaviors.map((b) => ({
        behavior: b,
        assessment: 'missing' as const,
        evidence: '',
        improvement: 'Could not parse judge response',
      })),
      proposedEdits: [],
      overallNotes: 'Failed to parse judge response',
    };
  }

  // Map behavior reviews
  const behaviorReviews: BehaviorReview[] = (parsed.behavior_reviews || []).map((br) => ({
    behavior: br.behavior,
    assessment: (['strong', 'partial', 'missing'].includes(br.assessment)
      ? br.assessment
      : 'missing') as BehaviorReview['assessment'],
    evidence: br.evidence || '',
    improvement: br.improvement || '',
  }));

  // Map proposed edits
  const proposedEdits: AgentsEdit[] = (parsed.proposed_edits || [])
    .slice(0, 3)
    .filter((e) => e.section && e.action && e.content)
    .map((e) => ({
      section: e.section,
      action: (['add', 'modify', 'strengthen', 'remove'].includes(e.action)
        ? e.action
        : 'add') as AgentsEdit['action'],
      content: e.content,
      motivatedBy: [probeId],
    }));

  return {
    probeId,
    task,
    response,
    behaviorReviews,
    proposedEdits,
    overallNotes: parsed.overall_notes || '',
  };
}
