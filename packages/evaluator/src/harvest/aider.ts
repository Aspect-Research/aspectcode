/**
 * Aider prompt harvester.
 *
 * Parses `.aider.chat.history.md` — a markdown file where:
 * - Sessions start with `# aider chat started at <timestamp>`
 * - User turns are `#### <message>` (H4 headings)
 * - Assistant turns are unprefixed text between H4 headings
 */

import * as fs from 'fs';
import * as path from 'path';
import type { HarvestedPrompt } from '../types';
import { extractFilePaths, filterRecent, DEFAULT_MAX_PER_SOURCE, noopLogger } from './common';
import type { OptLogger } from '../types';

/** Default history file name. */
const HISTORY_FILE = '.aider.chat.history.md';

/**
 * Harvest prompts from Aider's chat history.
 */
export async function harvestAider(
  root: string,
  options?: { max?: number; since?: Date; log?: OptLogger },
): Promise<HarvestedPrompt[]> {
  const log = options?.log ?? noopLogger;
  const max = options?.max ?? DEFAULT_MAX_PER_SOURCE;

  const historyPath = path.join(root, HISTORY_FILE);
  if (!fs.existsSync(historyPath)) {
    log.debug(`aider: no history file at ${historyPath}`);
    return [];
  }

  const content = fs.readFileSync(historyPath, 'utf-8');
  const prompts = parseAiderHistory(content, root);
  log.debug(`aider: parsed ${prompts.length} conversation turns`);

  return filterRecent(prompts, options?.since, max);
}

/**
 * Parse aider markdown chat history into harvested prompts.
 */
export function parseAiderHistory(content: string, root: string): HarvestedPrompt[] {
  const prompts: HarvestedPrompt[] = [];
  const lines = content.split('\n');

  let currentTimestamp: string | undefined;
  let currentUserPrompt: string | undefined;
  let assistantLines: string[] = [];

  function flush(): void {
    if (currentUserPrompt !== undefined && assistantLines.length > 0) {
      const assistantResponse = assistantLines.join('\n').trim();
      if (assistantResponse) {
        const allText = currentUserPrompt + '\n' + assistantResponse;
        prompts.push({
          source: 'aider',
          timestamp: currentTimestamp,
          userPrompt: currentUserPrompt,
          assistantResponse,
          filesReferenced: extractFilePaths(allText, root),
        });
      }
    }
    currentUserPrompt = undefined;
    assistantLines = [];
  }

  for (const line of lines) {
    // Session header: # aider chat started at 2025-06-14 10:23:45
    const sessionMatch = line.match(/^# aider chat started at (.+)$/);
    if (sessionMatch) {
      flush();
      currentTimestamp = parseAiderTimestamp(sessionMatch[1].trim());
      continue;
    }

    // User turn: #### <message>
    if (line.startsWith('#### ')) {
      flush();
      currentUserPrompt = line.slice(5).trim();
      continue;
    }

    // Assistant text (anything between user turns)
    if (currentUserPrompt !== undefined) {
      assistantLines.push(line);
    }
  }

  // Flush final turn
  flush();

  return prompts;
}

/**
 * Parse aider's timestamp format (YYYY-MM-DD HH:MM:SS) to ISO-8601.
 */
function parseAiderTimestamp(ts: string): string {
  // "2025-06-14 10:23:45" → "2025-06-14T10:23:45"
  const isoish = ts.replace(' ', 'T');
  const date = new Date(isoish);
  return isNaN(date.getTime()) ? ts : date.toISOString();
}
