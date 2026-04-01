/**
 * Autonomous assessment resolution — LLM judges warnings
 * and auto-resolves high-confidence ones without user input.
 *
 * Batched: multiple assessments are sent in a single LLM call,
 * deduplicated by rule+directory to minimize token usage.
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

const BATCH_SYSTEM = `You evaluate code change assessments for a developer. Given a list of assessments and the previous preferences, decide for each: should this be ALLOWED (suppress future warnings) or DENIED (enforce this rule)?

Output ONLY a JSON array. Each element: { "id": <number>, "decision": "allow" or "deny", "confidence": 0.0 to 1.0, "reasoning": "one sentence" }

Confidence guide:
- 0.9+: Obviously trivial or obviously important (hub with 20+ dependents)
- 0.7-0.9: Likely correct based on pattern matching with preferences
- 0.5-0.7: Ambiguous
- <0.5: Novel, unclear — let the user decide

If multiple assessments share the same rule and directory, they likely deserve the same decision. Lean toward "allow" for naming/convention. Lean toward "deny" for dependency/hub safety.`;

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

/** Build a compact batch prompt, deduplicating by rule+directory. */
function buildBatchPrompt(assessments: ChangeAssessment[], prefs: PreferencesStore): string {
  let prompt = `Previous preferences:\n${formatPreferenceSummary(prefs)}\n\nAssessments:\n`;

  // Group by rule + directory for deduplication hint
  const groups = new Map<string, { indices: number[]; sample: ChangeAssessment }>();
  for (let i = 0; i < assessments.length; i++) {
    const a = assessments[i];
    const dir = a.file ? a.file.substring(0, a.file.lastIndexOf('/') + 1) : '';
    const key = `${a.rule}|${dir}`;
    const g = groups.get(key);
    if (g) {
      g.indices.push(i);
    } else {
      groups.set(key, { indices: [i], sample: a });
    }
  }

  // If a group has multiple identical-rule assessments, compact them
  for (const [, g] of groups) {
    if (g.indices.length === 1) {
      const i = g.indices[0];
      const a = assessments[i];
      prompt += `[${i}] Rule: ${a.rule} | File: ${a.file} | ${a.message}`;
      if (a.details) prompt += ` | ${a.details}`;
      prompt += '\n';
    } else {
      const a = g.sample;
      const files = g.indices.map((i) => assessments[i].file).join(', ');
      prompt += `[${g.indices.join(',')}] Rule: ${a.rule} | ${g.indices.length} files: ${files} | ${a.message}\n`;
    }
  }

  return prompt;
}

function parseBatchResponse(raw: string, count: number): Array<{ id: number; decision: 'allow' | 'deny'; confidence: number; reasoning: string }> | null {
  try {
    const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return null;

    const results: Array<{ id: number; decision: 'allow' | 'deny'; confidence: number; reasoning: string }> = [];
    for (const item of arr) {
      if (item.decision !== 'allow' && item.decision !== 'deny') continue;
      const confidence = typeof item.confidence === 'number' ? Math.max(0, Math.min(1, item.confidence)) : 0.5;
      const reasoning = typeof item.reasoning === 'string' ? item.reasoning.slice(0, 200) : '';

      // id can be a single number or comma-separated group
      const ids: number[] = typeof item.id === 'number' ? [item.id]
        : typeof item.id === 'string' ? item.id.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n))
        : [];

      for (const id of ids) {
        if (id >= 0 && id < count) {
          results.push({ id, decision: item.decision, confidence, reasoning });
        }
      }
    }
    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

/**
 * Check if an existing preference already covers this assessment.
 * If so, skip the LLM entirely and return the cached decision.
 */
export function matchExistingPreference(
  assessment: ChangeAssessment,
  preferences: PreferencesStore,
): AutoResolveResult | null {
  const dir = assessment.file
    ? assessment.file.substring(0, assessment.file.lastIndexOf('/') + 1)
    : null;

  for (const p of preferences.preferences) {
    if (p.rule !== assessment.rule) continue;
    const scopeMatch =
      (p.directory && dir && dir.startsWith(p.directory)) ||
      (p.file && p.file === assessment.file) ||
      (!p.directory && !p.file);
    if (!scopeMatch) continue;

    return {
      assessment,
      decision: p.disposition === 'allow' ? 'allow' : 'deny',
      confidence: 1.0,
      reasoning: `Matched existing preference: ${p.disposition} ${p.rule}`,
      autoResolved: true,
    };
  }
  return null;
}

/**
 * Batch-resolve multiple assessments in a single LLM call.
 * Deduplicates by rule+directory for token efficiency.
 */
export async function autoResolveBatch(
  assessments: ChangeAssessment[],
  preferences: PreferencesStore,
  provider: LlmProvider,
  options: { threshold?: number } = {},
): Promise<AutoResolveResult[]> {
  if (assessments.length === 0) return [];

  const threshold = options.threshold ?? 0.8;

  const messages: ChatMessage[] = [
    { role: 'system', content: BATCH_SYSTEM },
    { role: 'user', content: buildBatchPrompt(assessments, preferences) },
  ];

  try {
    const response = provider.chatWithOptions
      ? await provider.chatWithOptions(messages, { temperature: 0 })
      : await provider.chat(messages);

    const parsed = parseBatchResponse(response, assessments.length);
    if (!parsed) {
      // Parsing failed — return all as unresolved
      return assessments.map((a) => ({
        assessment: a,
        decision: 'allow' as const,
        confidence: 0,
        reasoning: 'Could not parse batch response',
        autoResolved: false,
      }));
    }

    // Map results back to assessments
    const resultMap = new Map<number, { decision: 'allow' | 'deny'; confidence: number; reasoning: string }>();
    for (const r of parsed) {
      resultMap.set(r.id, r);
    }

    return assessments.map((a, i) => {
      const r = resultMap.get(i);
      if (!r) {
        return { assessment: a, decision: 'allow' as const, confidence: 0, reasoning: 'Not in batch response', autoResolved: false };
      }
      return {
        assessment: a,
        decision: r.decision,
        confidence: r.confidence,
        reasoning: r.reasoning,
        autoResolved: r.confidence >= threshold,
      };
    });
  } catch (err) {
    // Re-throw tier exhaustion
    if ((err as any)?.tierExhausted) throw err;
    return assessments.map((a) => ({
      assessment: a,
      decision: 'allow' as const,
      confidence: 0,
      reasoning: 'LLM unavailable',
      autoResolved: false,
    }));
  }
}

/**
 * Single-assessment resolve (kept for backward compat / tests).
 */
export async function autoResolveAssessment(
  assessment: ChangeAssessment,
  preferences: PreferencesStore,
  provider: LlmProvider,
  options: { threshold?: number } = {},
): Promise<AutoResolveResult> {
  const cached = matchExistingPreference(assessment, preferences);
  if (cached) return cached;

  const results = await autoResolveBatch([assessment], preferences, provider, options);
  return results[0];
}
