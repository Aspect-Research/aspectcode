/**
 * Prompt harvester — aggregates conversation history from AI coding tools.
 *
 * Supported sources:
 * - aider: `.aider.chat.history.md` (markdown)
 * - claude-code: `~/.claude/projects/<hash>/*.jsonl` (JSONL)
 * - cline: VS Code globalStorage `saoudrizwan.claude-dev` (JSON)
 * - copilot-chat: VS Code state.vscdb (SQLite)
 * - cursor: Cursor state.vscdb (SQLite)
 * - windsurf: Windsurf state.vscdb (SQLite)
 * - export: `aspectcode-prompts.jsonl` (JSONL, user-provided)
 *
 * SQLite sources require the optional `better-sqlite3` dependency.
 * If unavailable, those sources are gracefully skipped.
 */

import type { HarvestedPrompt, HarvestOptions, PromptSource } from '../types';
import { noopLogger } from './common';
import { harvestAider } from './aider';
import { harvestClaudeCode } from './claudeCode';
import { harvestCline } from './cline';
import { harvestCopilotChat, harvestCursor, harvestWindsurf } from './vscodeDb';
import { harvestExport } from './export';

/** All supported prompt sources. */
const ALL_SOURCES: PromptSource[] = [
  'aider',
  'claude-code',
  'cline',
  'copilot-chat',
  'cursor',
  'windsurf',
  'export',
];

/** Map from source name to harvester function. */
const HARVESTERS: Record<PromptSource, (
  root: string,
  options?: { max?: number; since?: Date; log?: any },
) => Promise<HarvestedPrompt[]>> = {
  'aider': harvestAider,
  'claude-code': harvestClaudeCode,
  'cline': harvestCline,
  'copilot-chat': harvestCopilotChat,
  'cursor': harvestCursor,
  'windsurf': harvestWindsurf,
  'export': harvestExport,
};

/**
 * Harvest prompts from all configured AI tool conversation histories.
 *
 * Each source is attempted independently — failures in one source
 * don't prevent harvesting from others.
 */
export async function harvestPrompts(options: HarvestOptions): Promise<HarvestedPrompt[]> {
  const log = options.log ?? noopLogger;
  const sources = options.sources ?? ALL_SOURCES;
  const maxPerSource = options.maxPerSource ?? 50;

  const allPrompts: HarvestedPrompt[] = [];

  for (const source of sources) {
    const harvester = HARVESTERS[source];
    if (!harvester) {
      log.warn(`harvest: unknown source "${source}", skipping`);
      continue;
    }

    try {
      const prompts = await harvester(options.root, {
        max: maxPerSource,
        since: options.since,
        log,
      });
      allPrompts.push(...prompts);
      if (prompts.length > 0) {
        log.info(`harvest: ${source} → ${prompts.length} prompts`);
      }
    } catch (err) {
      log.debug(`harvest: ${source} failed: ${err}`);
    }
  }

  log.info(`harvest: total ${allPrompts.length} prompts from ${sources.length} sources`);
  return allPrompts;
}

// Re-export individual harvesters for direct use
export { harvestAider } from './aider';
export { harvestClaudeCode } from './claudeCode';
export { harvestCline } from './cline';
export { harvestCopilotChat, harvestCursor, harvestWindsurf } from './vscodeDb';
export { harvestExport } from './export';
