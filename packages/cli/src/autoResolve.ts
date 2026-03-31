/**
 * Autonomous assessment resolution — LLM judges warnings
 * and auto-resolves high-confidence ones without user input.
 */

import type { LlmProvider, ChatMessage } from '@aspectcode/optimizer';
import type { ChangeAssessment } from './changeEvaluator';
import type { PreferencesStore } from './preferences';

export interface AutoResolveResult {
  assessment: ChangeAssessment;
  decision: 'allow' | 'deny';
  confidence: number;
  reasoning: string;
  autoResolved: boolean;
}

export interface LlmRecommendation {
  decision: 'allow' | 'deny';
  confidence: number;
  reasoning: string;
}

const AUTO_RESOLVE_SYSTEM = `You evaluate code change assessments for a developer. Given an assessment and the developer's learned preferences, decide: should this be ALLOWED (suppress future warnings of this type in this scope) or DENIED (enforce this rule going forward)?

Output ONLY a JSON object:
{ "decision": "allow" or "deny", "confidence": 0.0 to 1.0, "reasoning": "one sentence" }

Confidence guide:
- 0.9+: Obviously trivial (naming nit, already covered by preferences) or obviously important (hub with 20+ dependents not updated)
- 0.7-0.9: Likely correct based on pattern matching with existing preferences
- 0.5-0.7: Ambiguous — could go either way
- <0.5: Novel pattern, unclear, or potentially important — let the user decide

Lean toward "allow" for naming/convention warnings. Lean toward "deny" for dependency and hub safety warnings.`;

function formatPreferenceSummary(prefs: PreferencesStore): string {
  const top = [...prefs.preferences]
    .sort((a, b) => (b.hitCount ?? 0) - (a.hitCount ?? 0))
    .slice(0, 10);

  if (top.length === 0) return 'No existing preferences.';

  return top.map((p) => {
    const scope = p.file ? p.file : p.directory ? `${p.directory}*` : 'project-wide';
    return `- ${p.disposition} ${p.rule} in ${scope} (used ${p.hitCount ?? 0}x)`;
  }).join('\n');
}

function buildAssessmentPrompt(a: ChangeAssessment, prefs: PreferencesStore): string {
  let prompt = `Developer's existing preferences:\n${formatPreferenceSummary(prefs)}\n\n`;
  prompt += `Assessment:\n`;
  prompt += `  Rule: ${a.rule}\n`;
  prompt += `  File: ${a.file}\n`;
  prompt += `  Type: ${a.type}\n`;
  prompt += `  Message: ${a.message}\n`;
  if (a.details) prompt += `  Details: ${a.details}\n`;
  if (a.suggestion) prompt += `  Suggestion: ${a.suggestion}\n`;
  if (a.dependencyContext) prompt += `  Dependency context: ${a.dependencyContext}\n`;
  return prompt;
}

function parseResponse(raw: string): { decision: 'allow' | 'deny'; confidence: number; reasoning: string } | null {
  try {
    const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (parsed.decision !== 'allow' && parsed.decision !== 'deny') return null;
    const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
    return {
      decision: parsed.decision,
      confidence,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 200) : '',
    };
  } catch {
    return null;
  }
}

/**
 * Ask the LLM to judge an assessment. Returns a decision with confidence score.
 */
export async function autoResolveAssessment(
  assessment: ChangeAssessment,
  preferences: PreferencesStore,
  provider: LlmProvider,
  options: { threshold?: number } = {},
): Promise<AutoResolveResult> {
  const threshold = options.threshold ?? 0.8;

  const messages: ChatMessage[] = [
    { role: 'system', content: AUTO_RESOLVE_SYSTEM },
    { role: 'user', content: buildAssessmentPrompt(assessment, preferences) },
  ];

  try {
    const response = provider.chatWithOptions
      ? await provider.chatWithOptions(messages, { temperature: 0 })
      : await provider.chat(messages);

    const parsed = parseResponse(response);
    if (!parsed) {
      // LLM failed to produce valid JSON — forward to user
      return {
        assessment,
        decision: 'allow',
        confidence: 0,
        reasoning: 'Could not parse LLM response',
        autoResolved: false,
      };
    }

    return {
      assessment,
      decision: parsed.decision,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      autoResolved: parsed.confidence >= threshold,
    };
  } catch {
    // LLM call failed — forward to user
    return {
      assessment,
      decision: 'allow',
      confidence: 0,
      reasoning: 'LLM unavailable',
      autoResolved: false,
    };
  }
}
