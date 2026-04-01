/**
 * LLM-powered probe generator — creates synthetic bug-fix tasks.
 *
 * Each probe is a realistic coding-assistant request with expected
 * behaviours. Probes are generated via LLM at temperature 0.9 for
 * diversity, with deduplication across iterations and a fallback
 * pool of hardcoded templates.
 *
 * Ported from sweagent_bench oracle/probes.py.
 */

import type { ChatMessage } from '@aspectcode/optimizer';
import type {
  Probe,
  ProbeGeneratorOptions,
} from './types';
import { chatWithTemp } from './llmUtil';

// ── Constants ───────────────────────────────────────────────

const MAX_KB_CHARS = 12_000;
const MAX_TOPUP_ATTEMPTS = 3;

// ── Prompts ─────────────────────────────────────────────────

function buildProbeSystemPrompt(maxProbes: number): string {
  return `Generate probe tasks to evaluate whether AGENTS.md improves repo self-exploration.

Return ONLY a JSON array of probe objects with this shape:
[
    {
    "task": "short realistic coding-assistant user request",
    "expected_behaviors": ["behavior 1", "behavior 2"],
    "rationale": "why this probe is useful"
    }
]

Rules:
- Return exactly ${maxProbes} probes, diverse across bug-fix and test-failure tasks.
- Tasks must be concrete coding requests, not AGENTS/meta questions.
- Each probe must include 2-4 expected behaviors.
- Expected behaviors must emphasize: evidence-first localization, dependency tracing, minimal scoped edits, and targeted validation.
- Every task must be patchable and executable by a tool-using coding runner (inspect files, run commands, propose code diff).
- Avoid pure advisory/navigation-only tasks that do not naturally end in a code diff.
- Avoid duplicates with prior tasks.
- Exactly ${maxProbes} probes.`;
}

function buildProbeUserPrompt(
  projectName: string,
  agentsMd: string,
  kbText: string,
  priorTasks: string[],
): string {
  const priorSection = priorTasks.length > 0
    ? priorTasks.map((t, i) => `${i + 1}. ${t}`).join('\n')
    : '(none)';

  return `Project: ${projectName}

CURRENT AGENTS.MD:
---
${agentsMd}
---

REPO KB SNIPPET:
---
${kbText}
---

PRIOR PROBE TASKS (avoid duplicates):
${priorSection}

Generate probes now.

Additional requirements for this batch:
- Include realistic technical context (module/function/test hints) when possible.
- Prefer scoped fixes; avoid broad refactors.
- Phrase each task as a request to fix a concrete failing behavior or test regression.`;
}

// ── Fallback probe pool ─────────────────────────────────────

const FALLBACK_BEHAVIORS = [
  'Localizes likely files/functions before editing',
  'Applies a minimal scoped code change',
  'Runs targeted validation relevant to the change',
];

const FALLBACK_PROBES: Array<{ task: string; rationale: string }> = [
  { task: 'A recent commit introduced a regression in a high-traffic module. A core function now returns incorrect results for edge-case inputs. Fix it.', rationale: 'Tests regression diagnosis in a core path' },
  { task: 'A test suite for the main entry point is failing after a dependency update. The test expects old behavior. Update the test or the code to restore correctness.', rationale: 'Tests adaptation to dependency changes' },
  { task: 'An edge case in input validation causes a crash when empty strings are passed. Add proper validation and a test.', rationale: 'Tests defensive coding and validation' },
  { task: 'A serialization function drops fields when the input contains nested objects with optional keys. Fix the serialization logic.', rationale: 'Tests careful data handling' },
  { task: 'A caching layer returns stale data after a config change. The cache invalidation logic does not account for the new config key. Fix it.', rationale: 'Tests understanding of caching dependencies' },
  { task: 'A version compatibility check is too strict and rejects valid inputs from the latest release. Relax the check while maintaining safety.', rationale: 'Tests careful constraint relaxation' },
  { task: 'A lifecycle hook fires in the wrong order during initialization, causing a null reference. Fix the ordering.', rationale: 'Tests understanding of initialization order' },
  { task: 'A deduplication filter is too aggressive and removes valid entries that share a partial key. Fix the matching logic.', rationale: 'Tests precise filtering logic' },
  { task: 'An API endpoint returns a 500 error when called with a valid but uncommon parameter combination. Trace and fix the handler.', rationale: 'Tests end-to-end debugging' },
  { task: 'A migration script fails silently when the target schema already exists. Add proper detection and error handling.', rationale: 'Tests robustness in data operations' },
  { task: 'A search function returns duplicate results when the query matches items in multiple indexes. Fix the result merging.', rationale: 'Tests data aggregation correctness' },
  { task: 'An event handler leaks resources because it registers listeners but never removes them. Fix the cleanup.', rationale: 'Tests resource management' },
  { task: 'A formatting function produces incorrect output for locale-specific inputs. Fix the locale handling.', rationale: 'Tests internationalization awareness' },
  { task: 'A retry mechanism enters an infinite loop when the error type changes between attempts. Add proper loop termination.', rationale: 'Tests error handling robustness' },
  { task: 'A permissions check incorrectly grants access when multiple roles overlap. Fix the authorization logic.', rationale: 'Tests security-sensitive logic' },
];

// ── Deduplication ───────────────────────────────────────────

export function normalizeProbeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isDuplicate(task: string, existing: string[]): boolean {
  const normalized = normalizeProbeText(task);
  return existing.some((t) => {
    const n = normalizeProbeText(t);
    return n === normalized || n.includes(normalized) || normalized.includes(n);
  });
}

// ── JSON parsing ────────────────────────────────────────────

interface RawProbe {
  task: string;
  expected_behaviors: string[];
  rationale?: string;
}

export function parseProbeResponse(raw: string): RawProbe[] {
  // Strip thinking tags
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Strip code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed as RawProbe[];
  } catch {
    // Try to find JSON array
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]) as RawProbe[];
      } catch {
        // fall through
      }
    }
  }

  return [];
}

// ── Public API ──────────────────────────────────────────────

/**
 * Generate probes via LLM with fallback to hardcoded templates.
 *
 * Uses temperature 0.9 for diverse probe generation. Deduplicates
 * against prior tasks across iterations. Falls back to a pool of
 * hardcoded templates when LLM generation fails.
 */
export async function generateProbes(options: ProbeGeneratorOptions): Promise<Probe[]> {
  const {
    kb,
    currentAgentsMd,
    priorProbeTasks,
    maxProbes = 10,
    provider,
    projectName = 'project',
    log,
    signal,
  } = options;

  if (signal?.aborted) return [];

  // Truncate KB to fit in prompt
  const kbText = kb.length > MAX_KB_CHARS
    ? kb.slice(0, MAX_KB_CHARS - 20) + '\n[... truncated]'
    : kb;

  const allPriorTasks = [...priorProbeTasks];
  const probes: Probe[] = [];
  let attempts = 0;

  while (probes.length < maxProbes && attempts <= MAX_TOPUP_ATTEMPTS) {
    if (signal?.aborted) break;
    attempts++;

    const remaining = maxProbes - probes.length;
    const systemPrompt = buildProbeSystemPrompt(remaining);
    const userPrompt = buildProbeUserPrompt(
      projectName,
      currentAgentsMd,
      kbText,
      allPriorTasks,
    );

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    let rawProbes: RawProbe[] = [];
    try {
      const response = await chatWithTemp(provider, messages, 0.9, signal);
      rawProbes = parseProbeResponse(response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.warn(`Probe generation attempt ${attempts} failed: ${msg}`);
    }

    // Process and deduplicate
    for (const raw of rawProbes) {
      if (probes.length >= maxProbes) break;
      if (!raw.task || !raw.expected_behaviors?.length) continue;
      if (isDuplicate(raw.task, allPriorTasks)) continue;

      const id = `probe-${probes.length + 1}-${normalizeProbeText(raw.task).slice(0, 30).replace(/\s/g, '-')}`;
      probes.push({
        id,
        task: raw.task,
        expectedBehaviors: raw.expected_behaviors.slice(0, 4),
        rationale: raw.rationale,
      });
      allPriorTasks.push(raw.task);
    }

    // If first attempt got nothing, try again before falling back
    if (rawProbes.length === 0 && attempts >= 2) break;
  }

  // Fallback to hardcoded templates if still under target
  if (probes.length < maxProbes) {
    log?.debug(`Using fallback probes (generated ${probes.length}/${maxProbes})`);
    for (const fallback of FALLBACK_PROBES) {
      if (probes.length >= maxProbes) break;
      if (isDuplicate(fallback.task, allPriorTasks)) continue;

      const id = `fallback-${probes.length + 1}`;
      probes.push({
        id,
        task: fallback.task,
        expectedBehaviors: FALLBACK_BEHAVIORS,
        rationale: fallback.rationale,
      });
      allPriorTasks.push(fallback.task);
    }
  }

  log?.info(`Generated ${probes.length} probes (${attempts} LLM attempts)`);
  return probes;
}
