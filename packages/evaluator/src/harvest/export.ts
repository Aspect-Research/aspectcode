/**
 * Export-based prompt harvester.
 *
 * Reads a user-provided `aspectcode-prompts.jsonl` file containing
 * manually exported or tool-exported conversation turns.
 *
 * Format: one JSON object per line:
 * ```jsonl
 * {"userPrompt":"...","assistantResponse":"...","filesReferenced":["src/foo.ts"],"timestamp":"2025-01-01T00:00:00Z"}
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import type { HarvestedPrompt } from '../types';
import { extractFilePaths, filterRecent, DEFAULT_MAX_PER_SOURCE, noopLogger } from './common';
import type { OptLogger } from '../types';

/** Default export file name. */
const EXPORT_FILE = 'aspectcode-prompts.jsonl';

/**
 * Harvest prompts from a user-provided JSONL export file.
 */
export async function harvestExport(
  root: string,
  options?: { max?: number; since?: Date; log?: OptLogger; filePath?: string },
): Promise<HarvestedPrompt[]> {
  const log = options?.log ?? noopLogger;
  const max = options?.max ?? DEFAULT_MAX_PER_SOURCE;

  const exportPath = options?.filePath || path.join(root, EXPORT_FILE);

  if (!fs.existsSync(exportPath)) {
    log.debug(`export: no file at ${exportPath}`);
    return [];
  }

  const content = fs.readFileSync(exportPath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());
  const prompts: HarvestedPrompt[] = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]);
      const userPrompt = entry.userPrompt || entry.user_prompt || entry.prompt || '';
      const assistantResponse = entry.assistantResponse || entry.assistant_response || entry.response || '';

      if (!userPrompt || !assistantResponse) continue;

      const explicitFiles: string[] = Array.isArray(entry.filesReferenced)
        ? entry.filesReferenced
        : Array.isArray(entry.files_referenced)
          ? entry.files_referenced
          : [];

      const allText = userPrompt + '\n' + assistantResponse;

      prompts.push({
        source: 'export',
        timestamp: entry.timestamp || undefined,
        userPrompt,
        assistantResponse,
        filesReferenced: [...new Set([
          ...explicitFiles,
          ...extractFilePaths(allText, root),
        ])],
      });
    } catch (err) {
      log.debug(`export: failed to parse line ${i + 1}: ${err}`);
    }
  }

  log.debug(`export: parsed ${prompts.length} entries from ${exportPath}`);
  return filterRecent(prompts, options?.since, max);
}
