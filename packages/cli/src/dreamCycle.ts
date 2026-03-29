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

const DREAM_THRESHOLD = 5;
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

const DREAM_SYSTEM = `You are an AGENTS.md editor. You will receive the current AGENTS.md, existing scoped rules, and developer corrections from watch mode.

Your job:
1. For CONFIRMED problems: strengthen or add rules so the AI assistant catches these in the future.
2. For DISMISSED warnings: soften or remove rules that over-flagged — the developer said these aren't issues.
3. If there is a <!-- aspectcode:learned --> block, integrate its content and remove the markers.
4. Keep AGENTS.md under 8000 characters.

SCOPED RULES PHILOSOPHY:
- Prefer adding general guidance to AGENTS.md. Only use scoped rules when content is truly directory-specific and would be misleading if applied globally.
- Do NOT create scoped rules for naming conventions alone — that belongs in AGENTS.md.
- You can create, update, or delete scoped rules. To delete, use: {"slug":"id","action":"delete"}
- When in doubt, add to AGENTS.md.

OUTPUT FORMAT:
First, output the complete updated AGENTS.md content (no code fences, no markers).
Then, if you have scoped rule changes, add a line containing exactly "---SCOPED_RULES---" followed by a JSON array:
[{"slug":"short-id","description":"what this rule does","globs":["path/pattern/**"],"content":"markdown rule body"}]
To delete a rule: [{"slug":"rule-to-remove","action":"delete"}]

If no scoped rule changes are needed, just output the AGENTS.md content with no delimiter.`;

function buildDreamUserPrompt(agentsMd: string, corrs: Correction[], scopedRulesContext?: string): string {
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

  prompt += `

DEVELOPER CORRECTIONS (from watch mode):
${formattedCorrections}

Produce the updated AGENTS.MD now. You may also create, update, or delete scoped rules if appropriate, but prefer AGENTS.md for general guidance.`;

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
}): Promise<DreamResult> {
  const { currentAgentsMd, corrections: corrs, provider, log, scopedRulesContext } = options;

  if (corrs.length === 0) {
    return { updatedAgentsMd: currentAgentsMd, changes: [], scopedRules: [], deleteSlugs: [] };
  }

  log?.info(`Dream cycle: processing ${corrs.length} correction${corrs.length === 1 ? '' : 's'}…`);

  const messages: ChatMessage[] = [
    { role: 'system', content: DREAM_SYSTEM },
    { role: 'user', content: buildDreamUserPrompt(currentAgentsMd, corrs, scopedRulesContext) },
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
