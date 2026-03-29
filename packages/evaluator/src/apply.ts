/**
 * Deterministic edit application for AGENTS.md.
 *
 * Applies structured edits (add/modify/strengthen/remove) to AGENTS.md
 * using pure markdown manipulation — no LLM calls.
 * Enforces a character budget with priority-based trimming.
 *
 * Ported from sweagent_bench oracle/apply.py.
 */

import type { AgentsEdit, ApplyResult } from './types';

/** Default character budget for AGENTS.md. */
export const AGENTS_MD_CHAR_BUDGET = 8000;

// ── Canonical sections ──────────────────────────────────────

/** Canonical section names allowed in AGENTS.md. */
const CANONICAL_SECTIONS = [
  'Operating Mode',
  'Procedural Standards',
  'High-Impact Hubs',
  'Entry Points',
  'Import Chains',
  'Validation',
  'Integration Risk',
  'Conventions',
  'Guardrails',
] as const;

type CanonicalSection = typeof CANONICAL_SECTIONS[number];

/** Map common LLM-invented aliases to canonical section names. */
const SECTION_ALIASES: Record<string, CanonicalSection> = {
  // Operating Mode
  'operating mode': 'Operating Mode',
  'workflow': 'Operating Mode',
  'operating': 'Operating Mode',
  'mode': 'Operating Mode',

  // Procedural Standards
  'procedural standards': 'Procedural Standards',
  'procedural': 'Procedural Standards',
  'standards': 'Procedural Standards',
  'procedures': 'Procedural Standards',
  'process': 'Procedural Standards',

  // High-Impact Hubs
  'high-impact hubs': 'High-Impact Hubs',
  'hubs': 'High-Impact Hubs',
  'high impact hubs': 'High-Impact Hubs',
  'hub': 'High-Impact Hubs',
  'high-risk hubs': 'High-Impact Hubs',
  'architectural hubs': 'High-Impact Hubs',

  // Entry Points
  'entry points': 'Entry Points',
  'entry point': 'Entry Points',
  'endpoints': 'Entry Points',

  // Import Chains
  'import chains': 'Import Chains',
  'import chain': 'Import Chains',
  'imports': 'Import Chains',
  'dependencies': 'Import Chains',

  // Validation
  'validation': 'Validation',
  'testing': 'Validation',
  'tests': 'Validation',
  'test': 'Validation',

  // Integration Risk
  'integration risk': 'Integration Risk',
  'integration': 'Integration Risk',
  'risk': 'Integration Risk',

  // Conventions
  'conventions': 'Conventions',
  'convention': 'Conventions',
  'style': 'Conventions',
  'naming': 'Conventions',
  'patterns': 'Conventions',

  // Guardrails
  'guardrails': 'Guardrails',
  'guardrail': 'Guardrails',
  'safety': 'Guardrails',
  'constraints': 'Guardrails',

  // Parent-level aliases
  'repo priors': 'High-Impact Hubs',
  'repo-specific': 'High-Impact Hubs',
};

/**
 * Trimming priority — higher numbers are shed first.
 * Generic sections shed before repo-specific ones.
 */
const SECTION_PRIORITY: Record<CanonicalSection, number> = {
  'Operating Mode': 2,
  'Procedural Standards': 2,
  'Guardrails': 2,
  'Validation': 1,
  'High-Impact Hubs': 0,
  'Entry Points': 0,
  'Import Chains': 0,
  'Integration Risk': 0,
  'Conventions': 0,
};

// ── Boilerplate filter ──────────────────────────────────────

/** Patterns that indicate runner metadata, not real guidance. */
const BOILERPLATE_PATTERNS = [
  /runner_status/i,
  /patch_len/i,
  /elapsed_s/i,
  /token_usage/i,
  /probe_id/i,
  /iteration_\d/i,
  /version_\d/i,
  /^\s*```/,
];

export function isBoilerplate(content: string): boolean {
  return BOILERPLATE_PATTERNS.some((p) => p.test(content));
}

// ── Section parser ──────────────────────────────────────────

export interface ParsedSection {
  title: string;
  level: number;        // heading level (1-3)
  lines: string[];      // bullet lines (including sub-headings within)
  raw: string;          // original text block
}

/**
 * Parse AGENTS.md into sections by heading.
 * Each section captures all content until the next heading of same or higher level.
 */
export function parseSections(md: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  const matches: Array<{ level: number; title: string; index: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(md)) !== null) {
    matches.push({
      level: match[1].length,
      title: match[2].trim(),
      index: match.index,
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + md.slice(matches[i].index).indexOf('\n') + 1;
    const end = i + 1 < matches.length ? matches[i + 1].index : md.length;
    const body = md.slice(start, end).trim();
    const lines = body ? body.split('\n').filter((l) => l.trim().length > 0) : [];

    sections.push({
      title: matches[i].title,
      level: matches[i].level,
      lines,
      raw: md.slice(matches[i].index, end),
    });
  }

  return sections;
}

/** Canonicalize a section name to its canonical form. */
export function canonicalize(sectionName: string): CanonicalSection | undefined {
  const lower = sectionName.toLowerCase().trim();

  // Direct match
  if (SECTION_ALIASES[lower]) return SECTION_ALIASES[lower];

  // Check if any canonical section name matches (case-insensitive)
  for (const canonical of CANONICAL_SECTIONS) {
    if (canonical.toLowerCase() === lower) return canonical;
  }

  // Substring match
  for (const [alias, canonical] of Object.entries(SECTION_ALIASES)) {
    if (lower.includes(alias) || alias.includes(lower)) return canonical;
  }

  return undefined;
}

// ── Edit application ────────────────────────────────────────

/**
 * Apply a list of edits to AGENTS.md content deterministically.
 *
 * - add/modify/strengthen: append bullet to section
 * - remove: fuzzy-match and remove matching lines
 * - Enforces character budget with priority-based trimming
 */
export function applyEdits(
  agentsMd: string,
  edits: AgentsEdit[],
  charBudget = AGENTS_MD_CHAR_BUDGET,
): ApplyResult {
  const sections = parseSections(agentsMd);
  let applied = 0;

  for (const edit of edits) {
    // Skip boilerplate
    if (isBoilerplate(edit.content)) continue;

    // Canonicalize section name
    const canonical = canonicalize(edit.section);
    if (!canonical) continue;

    // Find or create the target section
    let section = sections.find(
      (s) => canonicalize(s.title) === canonical,
    );

    if (!section && (edit.action === 'add' || edit.action === 'strengthen')) {
      // Create the section if it doesn't exist
      section = { title: canonical, level: 2, lines: [], raw: '' };
      // Insert before Guardrails (always last)
      const guardrailIdx = sections.findIndex((s) => canonicalize(s.title) === 'Guardrails');
      if (guardrailIdx >= 0) {
        sections.splice(guardrailIdx, 0, section);
      } else {
        sections.push(section);
      }
    }

    if (!section) continue;

    if (edit.action === 'remove') {
      // Fuzzy-match: remove lines containing the edit content
      const needle = edit.content.toLowerCase();
      const before = section.lines.length;
      section.lines = section.lines.filter(
        (line) => !line.toLowerCase().includes(needle),
      );
      if (section.lines.length < before) applied++;
    } else {
      // add / modify / strengthen: append as a bullet
      const bullet = `- ${edit.content}`;
      // Don't add duplicate bullets
      const exists = section.lines.some(
        (line) => line.trim().toLowerCase() === bullet.trim().toLowerCase(),
      );
      if (!exists) {
        section.lines.push(bullet);
        applied++;
      }
    }
  }

  // Reconstruct the document
  let result = reconstructDocument(sections, agentsMd);

  // Enforce budget
  let trimmed = 0;
  if (result.length > charBudget) {
    const trimResult = trimToBudget(sections, charBudget);
    result = trimResult.content;
    trimmed = trimResult.trimmed;
  }

  return { content: result, applied, trimmed };
}

/**
 * Reconstruct the AGENTS.md document from parsed sections.
 * Preserves the document title (# heading) if present.
 */
function reconstructDocument(sections: ParsedSection[], originalMd: string): string {
  const parts: string[] = [];

  // Preserve any content before the first section heading (e.g., # title)
  const firstHeadingMatch = /^#{1,3}\s+/m.exec(originalMd);
  if (firstHeadingMatch && firstHeadingMatch.index > 0) {
    const preamble = originalMd.slice(0, firstHeadingMatch.index).trim();
    if (preamble) parts.push(preamble);
  } else {
    // Check if the document starts with a # title
    const titleMatch = /^#\s+(.+)$/m.exec(originalMd);
    if (titleMatch && !sections.some((s) => s.level === 1 && s.title === titleMatch[1].trim())) {
      parts.push(titleMatch[0]);
    }
  }

  for (const section of sections) {
    const heading = '#'.repeat(section.level) + ' ' + section.title;
    if (section.lines.length > 0) {
      parts.push(heading + '\n' + section.lines.join('\n'));
    } else {
      parts.push(heading);
    }
  }

  return parts.join('\n\n') + '\n';
}

/**
 * Trim bullets from lowest-priority sections to fit within the character budget.
 * Within a priority tier, longest bullets are shed first.
 */
export function trimToBudget(
  sections: ParsedSection[],
  budget: number,
): { content: string; trimmed: number } {
  let trimmed = 0;

  // Build a list of (section index, line index, priority, length) for all bullets
  const candidates: Array<{
    sectionIdx: number;
    lineIdx: number;
    priority: number;
    length: number;
  }> = [];

  for (let si = 0; si < sections.length; si++) {
    const canonical = canonicalize(sections[si].title);
    const priority = canonical ? (SECTION_PRIORITY[canonical] ?? 1) : 1;
    for (let li = 0; li < sections[si].lines.length; li++) {
      candidates.push({
        sectionIdx: si,
        lineIdx: li,
        priority,
        length: sections[si].lines[li].length,
      });
    }
  }

  // Sort: highest priority first (shed first), then longest first
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.length - a.length;
  });

  // Remove candidates one at a time until we're under budget
  const removed = new Set<string>();
  for (const candidate of candidates) {
    const result = reconstructDocument(sections, '');
    if (result.length <= budget) break;

    const key = `${candidate.sectionIdx}:${candidate.lineIdx}`;
    if (removed.has(key)) continue;
    removed.add(key);

    // Keep at least one bullet per section
    const section = sections[candidate.sectionIdx];
    const remainingLines = section.lines.filter((_, i) => {
      const k = `${candidate.sectionIdx}:${i}`;
      return !removed.has(k);
    });
    if (remainingLines.length === 0) {
      removed.delete(key);
      continue;
    }

    trimmed++;
  }

  // Apply removals
  for (let si = sections.length - 1; si >= 0; si--) {
    sections[si].lines = sections[si].lines.filter((_, li) => {
      return !removed.has(`${si}:${li}`);
    });
  }

  return { content: reconstructDocument(sections, ''), trimmed };
}

// ── LLM-augmented apply ──────────────────────────────────────

import type { LlmProvider, ChatMessage } from '@aspectcode/optimizer';
import { chatWithTemp } from './llmUtil';

/**
 * Apply edits with LLM assistance when content exceeds budget or
 * multiple edits target the same section.
 *
 * Falls back to deterministic apply if LLM fails.
 */
export async function applyEditsWithLlm(
  agentsMd: string,
  edits: AgentsEdit[],
  charBudget: number,
  provider: LlmProvider,
  signal?: AbortSignal,
): Promise<ApplyResult> {
  // First try deterministic apply
  const deterministicResult = applyEdits(agentsMd, edits, charBudget);

  // Check if LLM assistance would help:
  // 1. Content was trimmed (lost information)
  // 2. Multiple edits to the same section (consolidation opportunity)
  const sectionCounts = new Map<string, number>();
  for (const edit of edits) {
    const s = edit.section;
    sectionCounts.set(s, (sectionCounts.get(s) ?? 0) + 1);
  }
  const hasConsolidationOpportunity = [...sectionCounts.values()].some((c) => c > 3);
  const needsLlm = deterministicResult.trimmed > 0 || hasConsolidationOpportunity;

  if (!needsLlm) return deterministicResult;

  // LLM-assisted apply
  try {
    const editDescriptions = edits.map((e) =>
      `- ${e.action} in "${e.section}": ${e.content}`
    ).join('\n');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You apply edits to AGENTS.md. Given the current content and proposed edits, produce an updated AGENTS.md that:
- Integrates all edits intelligently (merge related bullets, consolidate redundant content)
- Stays under ${charBudget} characters
- Preserves the most important guidance when trimming
- Maintains section structure and markdown formatting
Output ONLY the updated AGENTS.md content, no code fences.`,
      },
      {
        role: 'user',
        content: `CURRENT AGENTS.MD (${agentsMd.length} chars, budget ${charBudget}):\n---\n${agentsMd}\n---\n\nPROPOSED EDITS:\n${editDescriptions}\n\nApply these edits and produce the updated AGENTS.md.`,
      },
    ];

    const response = await chatWithTemp(provider, messages, 0.0, signal);
    const cleaned = response.replace(/^```(?:markdown)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

    if (cleaned.length > 0 && cleaned.length <= charBudget * 1.1) {
      return { content: cleaned + '\n', applied: edits.length, trimmed: 0 };
    }
  } catch {
    // Fall back to deterministic result
  }

  return deterministicResult;
}
