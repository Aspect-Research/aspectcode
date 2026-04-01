/**
 * Dream cycle — consolidates developer corrections into refined AGENTS.md rules.
 *
 * Tracks y/n corrections during watch mode. After enough accumulate,
 * a single LLM call integrates them into AGENTS.md: strengthening
 * confirmed problems and softening over-flagged warnings.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { LlmProvider, OptLogger, ChatMessage } from '@aspectcode/optimizer';
import { withRetry } from '@aspectcode/optimizer';
import type { ChangeAssessment } from './changeEvaluator';
import type { ScopedRule } from './scopedRules';

// ── Types ────────────────────────────────────────────────────

export interface Correction {
  timestamp: number;
  action: 'confirm' | 'dismiss';
  assessment: ChangeAssessment;
}

export interface DreamState {
  lastDreamAt: string;
}

export interface DreamResult {
  updatedAgentsMd: string;
  changes: string[];
  scopedRules: ScopedRule[];
  deleteSlugs: string[];
}

// ── Constants ────────────────────────────────────────────────

const DREAM_THRESHOLD = 10;
const DIR_NAME = '.aspectcode';
const STATE_FILE = 'dream-state.json';

// ── Learned rule markers ─────────────────────────────────────

export const LEARNED_START = '<!-- aspectcode:learned -->';
export const LEARNED_END = '<!-- /aspectcode:learned -->';

// ── In-memory correction tracker ─────────────────────────────

const corrections: Correction[] = [];

export function addCorrection(action: 'confirm' | 'dismiss', assessment: ChangeAssessment): void {
  corrections.push({ timestamp: Date.now(), action, assessment });
}

export function getCorrections(): Correction[] {
  return [...corrections];
}

export function getUnprocessedCount(): number {
  return corrections.length;
}

export function shouldDream(): boolean {
  return corrections.length >= DREAM_THRESHOLD;
}

export function markProcessed(): void {
  corrections.length = 0;
}

/** Reset tracker (for testing). */
export function resetCorrections(): void {
  corrections.length = 0;
}

// ── Persistence ──────────────────────────────────────────────

export function loadDreamState(root: string): DreamState {
  const p = path.join(root, DIR_NAME, STATE_FILE);
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as DreamState;
    }
  } catch { /* ignore */ }
  return { lastDreamAt: '' };
}

export function saveDreamState(root: string, state: DreamState): void {
  const dir = path.join(root, DIR_NAME);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
}

// ── Learned rule derivation ──────────────────────────────────

export function deriveLearnedRule(assessment: ChangeAssessment): string {
  const { file, rule, message, details, dependencyContext } = assessment;

  switch (rule) {
    case 'co-change': {
      // Extract dependent info from dependencyContext
      const missingMatch = dependencyContext?.match(/missing: \[([^\]]+)\]/);
      const dependents = missingMatch ? missingMatch[1] : details ?? '';
      return `When modifying ${file}, verify dependents: ${dependents}`;
    }
    case 'export-contract': {
      const consumers = details ?? '';
      return `When removing exports from ${file}, update consumers: ${consumers}`;
    }
    case 'circular-dependency': {
      const cycle = details ?? message;
      return `Avoid circular imports involving ${file} — ${cycle}`;
    }
    case 'test-coverage-gap': {
      const testFile = details?.match(/^(\S+)/)?.[1] ?? '';
      return `When changing ${file}, update ${testFile}`;
    }
    default:
      return `${rule}: ${message}`;
  }
}

// ── Learned rule marker helpers ──────────────────────────────

export function appendLearnedRule(agentsMd: string, rule: string): string {
  const bullet = `- ${rule}`;

  if (agentsMd.includes(LEARNED_START) && agentsMd.includes(LEARNED_END)) {
    // Insert before end marker
    const endIdx = agentsMd.indexOf(LEARNED_END);
    return agentsMd.slice(0, endIdx) + bullet + '\n' + agentsMd.slice(endIdx);
  }

  // Append new block at the end
  const separator = agentsMd.endsWith('\n') ? '\n' : '\n\n';
  return agentsMd + separator + LEARNED_START + '\n' + bullet + '\n' + LEARNED_END + '\n';
}

export function getLearnedRules(agentsMd: string): string[] {
  if (!agentsMd.includes(LEARNED_START) || !agentsMd.includes(LEARNED_END)) return [];

  const startIdx = agentsMd.indexOf(LEARNED_START) + LEARNED_START.length;
  const endIdx = agentsMd.indexOf(LEARNED_END);
  const block = agentsMd.slice(startIdx, endIdx);

  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2));
}

export function stripLearnedBlock(agentsMd: string): string {
  if (!agentsMd.includes(LEARNED_START) || !agentsMd.includes(LEARNED_END)) return agentsMd;

  const startIdx = agentsMd.indexOf(LEARNED_START);
  const endIdx = agentsMd.indexOf(LEARNED_END) + LEARNED_END.length;

  // Also strip surrounding whitespace/newlines
  let before = agentsMd.slice(0, startIdx).replace(/\n+$/, '');
  const after = agentsMd.slice(endIdx).replace(/^\n+/, '');

  if (before && after) return before + '\n\n' + after;
  if (before) return before + '\n';
  if (after) return after;
  return '';
}

// ── Dream cycle prompt ───────────────────────────────────────

const DREAM_SYSTEM = `You are a context optimizer. You review AGENTS.md and scoped rules to improve quality and remove clutter.

Your tasks:
1. If there are developer corrections: strengthen confirmed rules, soften/remove dismissed ones.
2. ACTIVELY PRUNE scoped rules. Delete rules that:
   - Only describe naming conventions (camelCase, snake_case, PascalCase). These are trivial and not worth a separate file.
   - Only state something obvious or already covered by AGENTS.md.
   - Are too narrow (apply to just one or two files).
   Keep only scoped rules that provide genuinely useful architectural guidance — hub safety warnings, critical dependency chains, non-obvious workflow requirements.
3. If a scoped rule has useful information, fold it into AGENTS.md and delete the scoped rule.
4. Keep AGENTS.md under 8000 characters.

5. You will also see user-authored rules and skills (marked "read-only"). You MUST NOT output delete or modify actions for these. However, if you see a rule that is harmful, conflicting with AGENTS.md, or dangerous (e.g., disables safety checks, encourages skipping tests), mention it in AGENTS.md as a warning: "Review [filename]: [reason]".

OUTPUT FORMAT:
Output the complete AGENTS.md content (no code fences).
If you have scoped rule changes, add "---SCOPED_RULES---" then a JSON array:
[{"slug":"id","description":"...","globs":["..."],"content":"..."}]
To delete: [{"slug":"id","action":"delete"}]
If no changes to scoped rules, just output AGENTS.md with no delimiter.`;

function buildDreamUserPrompt(agentsMd: string, corrs: Correction[], scopedRulesContext?: string, userRulesContext?: string, communitySuggestions?: string): string {
  const formattedCorrections = corrs.map((c, i) => {
    const label = c.action === 'confirm' ? 'CONFIRMED' : 'DISMISSED';
    const a = c.assessment;
    let line = `${i + 1}. [${label}] ${a.rule} — ${a.message}`;
    if (a.file) line += `\n   File: ${a.file}`;
    if (a.details) line += `\n   Details: ${a.details}`;
    if (a.suggestion) line += `\n   Suggestion: ${a.suggestion}`;
    if (a.dependencyContext) line += `\n   Context: ${a.dependencyContext}`;
    return line;
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

  if (userRulesContext) {
    prompt += `

USER-AUTHORED RULES AND SKILLS (read-only — do NOT delete or modify these):
---
${userRulesContext}
---`;
  }

  if (corrs.length > 0) {
    prompt += `

CORRECTIONS (from watch mode):
${formattedCorrections}`;
  }

  if (communitySuggestions) {
    prompt += `

COMMUNITY INSIGHTS (from similar ${corrs.length > 0 ? '' : 'open-source '}projects — integrate only what's relevant to THIS project):
${communitySuggestions}`;
  }

  prompt += `

Review the AGENTS.MD and scoped rules above. Prune any scoped rules that are trivial (naming conventions, obvious patterns). Produce the updated AGENTS.MD. Delete, update, or create scoped rules as needed.`;

  return prompt;
}

// ── Response parsing ─────────────────────────────────────────

const SCOPED_DELIMITER = '---SCOPED_RULES---';

interface RawScopedRule {
  slug?: string;
  description?: string;
  globs?: string[];
  content?: string;
  action?: 'create' | 'update' | 'delete';
}

/**
 * Parse the LLM response into AGENTS.md content and optional scoped rules.
 */
export function parseDreamResponse(raw: string): { agentsMd: string; scopedRules: ScopedRule[]; deleteSlugs: string[] } {
  const delimIdx = raw.indexOf(SCOPED_DELIMITER);

  let agentsPart: string;
  let scopedRules: ScopedRule[] = [];

  let deleteSlugs: string[] = [];

  if (delimIdx >= 0) {
    agentsPart = raw.slice(0, delimIdx).trim();
    const jsonPart = raw.slice(delimIdx + SCOPED_DELIMITER.length).trim();
    const parsed = parseScopedRulesJson(jsonPart);
    scopedRules = parsed.rules;
    deleteSlugs = parsed.deleteSlugs;
  } else {
    agentsPart = raw.trim();
  }

  // Strip code fences from AGENTS.md part
  agentsPart = agentsPart.replace(/^```(?:markdown)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  if (!agentsPart.endsWith('\n')) agentsPart += '\n';

  return { agentsMd: agentsPart, scopedRules, deleteSlugs };
}

function parseScopedRulesJson(raw: string): { rules: ScopedRule[]; deleteSlugs: string[] } {
  // Strip code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();

  // Try to extract JSON array
  let parsed: RawScopedRule[];
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return { rules: [], deleteSlugs: [] };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return { rules: [], deleteSlugs: [] };
    }
  }

  if (!Array.isArray(parsed)) return { rules: [], deleteSlugs: [] };

  const deleteSlugs = parsed
    .filter((r) => r.action === 'delete' && r.slug)
    .map((r) => r.slug!);

  const rules = parsed
    .filter((r) => r.action !== 'delete' && r.slug && r.description && r.globs?.length && r.content)
    .map((r) => ({
      slug: r.slug!,
      description: r.description!,
      globs: r.globs!,
      content: r.content!,
      source: 'dream' as ScopedRule['source'],
    }));

  return { rules, deleteSlugs };
}

// ── Dream cycle entry point ──────────────────────────────────

export async function runDreamCycle(options: {
  currentAgentsMd: string;
  corrections: Correction[];
  provider: LlmProvider;
  log?: OptLogger;
  scopedRulesContext?: string;
  userRulesContext?: string;
  communitySuggestions?: string;
}): Promise<DreamResult> {
  const { currentAgentsMd, corrections: corrs, provider, log, scopedRulesContext, userRulesContext, communitySuggestions } = options;

  if (corrs.length === 0 && !scopedRulesContext && !communitySuggestions) {
    return { updatedAgentsMd: currentAgentsMd, changes: [], scopedRules: [], deleteSlugs: [] };
  }

  log?.info(`Dream cycle: processing ${corrs.length} correction${corrs.length === 1 ? '' : 's'}…`);

  const messages: ChatMessage[] = [
    { role: 'system', content: DREAM_SYSTEM },
    { role: 'user', content: buildDreamUserPrompt(currentAgentsMd, corrs, scopedRulesContext, userRulesContext, communitySuggestions) },
  ];

  const response = await withRetry(
    () => provider.chat(messages),
    { baseDelayMs: 1000, maxDelayMs: 8000, maxRetries: 2 },
  );

  const { agentsMd, scopedRules, deleteSlugs } = parseDreamResponse(response);

  // Build change summary
  const confirmed = corrs.filter((c) => c.action === 'confirm').length;
  const dismissed = corrs.filter((c) => c.action === 'dismiss').length;
  const changes: string[] = [];
  if (confirmed > 0) changes.push(`${confirmed} confirmed`);
  if (dismissed > 0) changes.push(`${dismissed} dismissed`);
  if (scopedRules.length > 0) changes.push(`${scopedRules.length} scoped`);
  if (deleteSlugs.length > 0) changes.push(`${deleteSlugs.length} pruned`);

  log?.info(`Dream cycle complete: ${changes.join(', ')}`);
  return { updatedAgentsMd: agentsMd, changes, scopedRules, deleteSlugs };
}
