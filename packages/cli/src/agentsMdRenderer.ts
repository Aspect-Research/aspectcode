/**
 * Direct AGENTS.md renderer from AnalysisModel.
 *
 * Generates a compact, exploration-first AGENTS.md matching the
 * sweagent_bench/kb/agents_md.py format. No intermediate KB string,
 * no table parsing, no emoji stripping. Deterministic.
 *
 * Budget: 3000 characters.
 */

import type { AnalysisModel } from '@aspectcode/core';

const CHAR_BUDGET = 3000;
const MAX_HUB_RULES = 2;
const MAX_ENTRY_RULES = 2;
const MAX_CONVENTION_RULES = 3;

function extractHubRules(model: AnalysisModel): string[] {
  const hubs = model.metrics.hubs
    .filter((h) => h.inDegree >= 3)
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, MAX_HUB_RULES);

  return hubs.map((h) => `- \`${h.file}\` — hub (${h.inDegree} importers).`);
}

function extractEntryPointRules(model: AnalysisModel): string[] {
  // Entry points are files with no inbound edges but outbound edges (roots of the graph)
  // Or files matching common entry point patterns
  const entryPatterns = /\b(main|index|app|server|handler|worker|cli)\b/i;
  const rules: string[] = [];

  for (const file of model.files) {
    if (entryPatterns.test(file.relativePath)) {
      const kind = file.relativePath.includes('test') ? 'test entry'
        : file.relativePath.includes('route') || file.relativePath.includes('handler') ? 'HTTP handler'
        : file.relativePath.includes('worker') ? 'worker'
        : file.relativePath.includes('cli') ? 'CLI entry'
        : 'entry point';
      rules.push(`- \`${file.relativePath}\` (${kind}).`);
    }
  }

  return rules.slice(0, MAX_ENTRY_RULES);
}

function extractConventionRules(model: AnalysisModel): string[] {
  const rules: string[] = [];
  const seen = new Set<string>();

  // Detect dominant file extension
  const extCounts = new Map<string, number>();
  for (const file of model.files) {
    const ext = file.relativePath.split('.').pop() || '';
    extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
  }
  const topExt = [...extCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topExt) {
    const lang = topExt[0] === 'py' ? 'Python' : topExt[0] === 'ts' ? 'TypeScript'
      : topExt[0] === 'tsx' ? 'TypeScript/React' : topExt[0] === 'js' ? 'JavaScript'
      : topExt[0] === 'java' ? 'Java' : topExt[0] === 'cs' ? 'C#' : topExt[0];
    const rule = `Primary language: ${lang} (${topExt[1]} files).`;
    if (!seen.has(rule.toLowerCase())) { seen.add(rule.toLowerCase()); rules.push(`- ${rule}`); }
  }

  // Detect test directory
  for (const file of model.files) {
    const p = file.relativePath.toLowerCase();
    if (p.includes('test') || p.includes('spec')) {
      const dir = file.relativePath.split('/').slice(0, -1).join('/');
      if (dir) {
        const rule = `Tests in \`${dir}/\`.`;
        if (!seen.has(rule.toLowerCase())) { seen.add(rule.toLowerCase()); rules.push(`- ${rule}`); }
      }
      break;
    }
  }

  return rules.slice(0, MAX_CONVENTION_RULES);
}

function extractImportChainRules(model: AnalysisModel): string[] {
  const circular = model.graph.edges.filter((e) => e.type === 'circular');
  if (circular.length === 0) return [];
  return circular.slice(0, 2).map((e) => `- Chain: \`${e.source}\` <-> \`${e.target}\``);
}

/**
 * Render a compact, exploration-first AGENTS.md from AnalysisModel.
 * Deterministic. No LLM calls. Matches sweagent_bench format.
 */
export function renderAgentsMd(model: AnalysisModel, projectName = 'Project'): string {
  const lines: string[] = [];

  lines.push(`# AGENTS.md — ${projectName}`);

  lines.push(`## Operating Mode`);
  lines.push(`- Verify repo priors with targeted reads before editing.`);
  lines.push(`- Localize, trace deps, then apply minimal scoped edit.`);
  lines.push(`- Run the smallest relevant test first, broaden only if needed.`);

  lines.push(`## Procedural Standards`);
  lines.push(`- Reproduce the failure before editing when possible.`);
  lines.push(`- Read target files and nearby callers before patching.`);
  lines.push(`- Keep first patch minimal; inspect call sites if public API changes.`);
  lines.push(`- Require evidence from file reads or command output — no fabricated edits.`);
  lines.push(`- Patches must be syntactically complete; remove unused imports.`);

  const hubRules = extractHubRules(model);
  const epRules = extractEntryPointRules(model);
  const convRules = extractConventionRules(model);
  const chainRules = extractImportChainRules(model);

  const hasPriors = hubRules.length > 0 || epRules.length > 0 || convRules.length > 0 || chainRules.length > 0;
  if (hasPriors) {
    lines.push(`## Repo Priors`);
  }
  if (hubRules.length > 0) {
    lines.push(`### High-Impact Hubs`);
    lines.push(...hubRules);
  }
  if (epRules.length > 0) {
    lines.push(`### Entry Points`);
    lines.push(...epRules);
  }
  if (chainRules.length > 0) {
    lines.push(`### Import Chains`);
    lines.push(...chainRules);
  }
  if (convRules.length > 0) {
    lines.push(`### Conventions`);
    lines.push(...convRules);
  }

  lines.push(`## Guardrails`);
  lines.push(`- No speculative changes or broad refactors without evidence.`);
  lines.push(`- Every touched file must tie to the diagnosed path.`);

  lines.push(`## Tooling`);
  lines.push(`This project uses [Aspect Code](https://aspectcode.com) to maintain AI context.`);
  lines.push(`Run \`aspectcode --background\` to keep instructions current as you code.`);

  let result = lines.join('\n') + '\n';

  if (result.length > CHAR_BUDGET) {
    result = result.slice(0, CHAR_BUDGET - 20) + '\n[... truncated]\n';
  }

  return result;
}
