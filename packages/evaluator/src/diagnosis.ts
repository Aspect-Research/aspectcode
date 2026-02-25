/**
 * Diagnosis engine — analyzes probe failures and proposes AGENTS.md edits.
 *
 * Takes failed probe results + current AGENTS.md, asks the LLM to identify
 * which rules are missing/weak/wrong, and returns targeted edits.
 */

import type { ChatMessage, LlmProvider, OptLogger } from '@aspectcode/optimizer';
import type { ProbeResult, Diagnosis, AgentsEdit } from './types';

/**
 * Build the diagnosis prompt from failed probe results.
 */
function buildDiagnosisPrompt(
  failures: ProbeResult[],
  agentsContent: string,
): string {
  const failureSummaries = failures.map((f, i) => {
    const shortcomings = f.shortcomings.map((s) => `    - ${s}`).join('\n');
    return `${i + 1}. Probe: ${f.probeId}\n   Shortcomings:\n${shortcomings}`;
  }).join('\n\n');

  return `You are diagnosing why an AI coding assistant's AGENTS.md instructions
are failing to guide it correctly. Below are probe test results showing
specific scenarios where the AI fell short.

## Failed Probes
${failureSummaries}

## Current AGENTS.md
${agentsContent}

## Task
Analyze the failures and identify what in AGENTS.md needs to change.
For each issue, propose a specific, actionable edit.

Respond in EXACTLY this format:

SUMMARY: <one paragraph overview of what's wrong>

EDIT_1:
SECTION: <which section/area of AGENTS.md>
ACTION: add|modify|strengthen|remove
CONTENT: <the proposed rule or change>
MOTIVATED_BY: <comma-separated probe IDs>

EDIT_2:
SECTION: ...
ACTION: ...
CONTENT: ...
MOTIVATED_BY: ...

(continue for each edit needed)`;
}

/** Parse the structured diagnosis response. */
function parseDiagnosisResponse(response: string, failureCount: number): Diagnosis {
  // Parse summary
  const summaryMatch = response.match(/SUMMARY:\s*(.+?)(?=\n\s*EDIT_\d|$)/is);
  const summary = summaryMatch ? summaryMatch[1].trim() : 'Could not parse diagnosis summary.';

  // Parse edits
  const edits: AgentsEdit[] = [];
  const editRegex = /EDIT_\d+:\s*\nSECTION:\s*(.+?)\nACTION:\s*(add|modify|strengthen|remove)\s*\nCONTENT:\s*(.+?)\nMOTIVATED_BY:\s*(.+?)(?=\n\s*EDIT_\d|$)/gis;

  let match: RegExpExecArray | null;
  while ((match = editRegex.exec(response)) !== null) {
    edits.push({
      section: match[1].trim(),
      action: match[2].trim().toLowerCase() as AgentsEdit['action'],
      content: match[3].trim(),
      motivatedBy: match[4].trim().split(/,\s*/).filter(Boolean),
    });
  }

  // Fallback: if regex didn't match cleanly, try a looser parse
  if (edits.length === 0) {
    const looseEditRegex = /SECTION:\s*(.+?)\n.*?ACTION:\s*(\w+)\n.*?CONTENT:\s*(.+?)\n.*?MOTIVATED_BY:\s*(.+?)(?=\n\s*(?:EDIT|SECTION)|$)/gis;
    while ((match = looseEditRegex.exec(response)) !== null) {
      const action = match[2].trim().toLowerCase();
      if (['add', 'modify', 'strengthen', 'remove'].includes(action)) {
        edits.push({
          section: match[1].trim(),
          action: action as AgentsEdit['action'],
          content: match[3].trim(),
          motivatedBy: match[4].trim().split(/,\s*/).filter(Boolean),
        });
      }
    }
  }

  return { edits, summary, failureCount };
}

/**
 * Diagnose AGENTS.md shortcomings from failed probe results.
 *
 * Sends the failures + current AGENTS.md to the LLM and asks it to
 * identify what needs to change and propose specific edits.
 */
export async function diagnose(
  failures: ProbeResult[],
  agentsContent: string,
  provider: LlmProvider,
  log?: OptLogger,
  signal?: AbortSignal,
): Promise<Diagnosis> {
  if (failures.length === 0) {
    return { edits: [], summary: 'All probes passed.', failureCount: 0 };
  }

  if (signal?.aborted) {
    return { edits: [], summary: 'Cancelled.', failureCount: failures.length };
  }

  log?.info(`Diagnosing ${failures.length} probe failure${failures.length === 1 ? '' : 's'}…`);

  const prompt = buildDiagnosisPrompt(failures, agentsContent);
  const messages: ChatMessage[] = [
    { role: 'user', content: prompt },
  ];

  let response: string;
  try {
    response = await provider.chat(messages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.error(`Diagnosis LLM call failed: ${msg}`);
    return {
      edits: [],
      summary: `Diagnosis failed: ${msg}`,
      failureCount: failures.length,
    };
  }

  const diagnosis = parseDiagnosisResponse(response, failures.length);
  log?.info(`Diagnosis: ${diagnosis.edits.length} edit${diagnosis.edits.length === 1 ? '' : 's'} proposed`);

  return diagnosis;
}

/**
 * Apply diagnosis edits to AGENTS.md content.
 *
 * Uses the LLM to intelligently merge the proposed edits into the
 * existing content, since edits reference sections by name (not line number).
 */
export async function applyDiagnosisEdits(
  agentsContent: string,
  diagnosis: Diagnosis,
  provider: LlmProvider,
  log?: OptLogger,
  signal?: AbortSignal,
): Promise<{ content: string; appliedEdits: string[] }> {
  if (diagnosis.edits.length === 0) {
    return { content: agentsContent, appliedEdits: [] };
  }

  if (signal?.aborted) {
    return { content: agentsContent, appliedEdits: [] };
  }

  const editDescriptions = diagnosis.edits
    .map((e, i) => `${i + 1}. [${e.action.toUpperCase()}] Section "${e.section}": ${e.content}`)
    .join('\n');

  const prompt = `Apply the following edits to the AGENTS.md instructions.
Each edit specifies a section, an action (add/modify/strengthen/remove), and content.

## Edits to Apply
${editDescriptions}

## Current AGENTS.md
${agentsContent}

## Rules
- Apply ALL edits.
- Keep the same overall structure unless an edit requires restructuring.
- For "add": insert the new rule in the appropriate section.
- For "modify": find and replace the relevant rule.
- For "strengthen": make the existing rule more specific/forceful.
- For "remove": delete the rule.
- AGENTS.md must remain fully self-contained — no references to external documents.
- Output ONLY the full updated AGENTS.md content (no explanations or fences).`;

  const messages: ChatMessage[] = [
    { role: 'user', content: prompt },
  ];

  let response: string;
  try {
    response = await provider.chat(messages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.error(`Edit application failed: ${msg}`);
    return { content: agentsContent, appliedEdits: [] };
  }

  const appliedEdits = diagnosis.edits.map(
    (e) => `[${e.action}] ${e.section}: ${e.content}`,
  );

  log?.info(`Applied ${appliedEdits.length} edit${appliedEdits.length === 1 ? '' : 's'} to AGENTS.md`);

  return { content: response.trim(), appliedEdits };
}

// Exported for testing
export { buildDiagnosisPrompt, parseDiagnosisResponse };
