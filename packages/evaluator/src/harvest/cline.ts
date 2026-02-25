/**
 * Cline prompt harvester.
 *
 * Parses `api_conversation_history.json` files from Cline's globalStorage.
 * Format mirrors the Anthropic Messages API: array of {role, content} objects.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { HarvestedPrompt } from '../types';
import {
  extractFilePaths,
  filterRecent,
  vscodeGlobalStoragePath,
  DEFAULT_MAX_PER_SOURCE,
  noopLogger,
} from './common';
import type { OptLogger } from '../types';

const CLINE_EXTENSION_ID = 'saoudrizwan.claude-dev';

/**
 * Harvest prompts from Cline's conversation history.
 */
export async function harvestCline(
  root: string,
  options?: { max?: number; since?: Date; log?: OptLogger },
): Promise<HarvestedPrompt[]> {
  const log = options?.log ?? noopLogger;
  const max = options?.max ?? DEFAULT_MAX_PER_SOURCE;

  const storageDir = vscodeGlobalStoragePath(CLINE_EXTENSION_ID);
  const tasksDir = path.join(storageDir, 'tasks');

  if (!fs.existsSync(tasksDir)) {
    log.debug(`cline: no tasks directory at ${tasksDir}`);
    return [];
  }

  const prompts: HarvestedPrompt[] = [];
  let taskDirs: string[];

  try {
    taskDirs = fs.readdirSync(tasksDir).filter((d) => {
      return fs.statSync(path.join(tasksDir, d)).isDirectory();
    });
  } catch {
    log.debug(`cline: cannot read ${tasksDir}`);
    return [];
  }

  // Sort by task ID (timestamp) descending to get most recent first
  taskDirs.sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (isNaN(na) || isNaN(nb)) return b.localeCompare(a);
    return nb - na;
  });

  for (const taskDir of taskDirs) {
    const historyFile = path.join(tasksDir, taskDir, 'api_conversation_history.json');
    if (!fs.existsSync(historyFile)) continue;

    try {
      const parsed = parseClineHistory(historyFile, taskDir, root);
      prompts.push(...parsed);
    } catch (err) {
      log.debug(`cline: failed to parse task ${taskDir}: ${err}`);
    }

    // Early exit if we already have enough
    if (prompts.length >= max * 2) break;
  }

  log.debug(`cline: parsed ${prompts.length} conversation turns from ${taskDirs.length} tasks`);
  return filterRecent(prompts, options?.since, max);
}

/**
 * Parse a single Cline api_conversation_history.json file.
 */
function parseClineHistory(
  filePath: string,
  taskId: string,
  root: string,
): HarvestedPrompt[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const messages: ClineMessage[] = JSON.parse(content);
  if (!Array.isArray(messages)) return [];

  const prompts: HarvestedPrompt[] = [];

  // Derive timestamp from task ID (it's milliseconds since epoch)
  const taskTimestamp = parseInt(taskId, 10);
  const timestamp = isNaN(taskTimestamp)
    ? undefined
    : new Date(taskTimestamp).toISOString();

  // Pair user → assistant messages
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;

    // Find the next assistant message
    const next = messages[i + 1];
    if (!next || next.role !== 'assistant') continue;

    const userText = extractTextFromClineContent(msg.content);
    const assistantText = extractTextFromClineContent(next.content);

    // Skip tool_result-only user messages (not real user prompts)
    if (!userText || isToolResultOnly(msg.content)) continue;
    if (!assistantText) continue;

    const fileRefs = [
      ...extractFilePaths(userText + '\n' + assistantText, root),
      ...extractToolFileRefs(next.content),
    ];

    prompts.push({
      source: 'cline',
      timestamp,
      userPrompt: userText,
      assistantResponse: assistantText,
      filesReferenced: [...new Set(fileRefs)],
    });

    i++; // Skip the assistant message we just consumed
  }

  return prompts;
}

// ── Cline message types ─────────────────────────────────────

interface ClineMessage {
  role: 'user' | 'assistant';
  content: ClineContentBlock[];
}

type ClineContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: unknown }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | unknown };

/**
 * Extract plain text from Cline content blocks.
 */
function extractTextFromClineContent(content: ClineContentBlock[]): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Check if a content array is only tool_result blocks (not a real user message).
 */
function isToolResultOnly(content: ClineContentBlock[]): boolean {
  if (!Array.isArray(content)) return false;
  return content.every((b) => b.type === 'tool_result');
}

/**
 * Extract file paths from tool_use blocks.
 */
function extractToolFileRefs(content: ClineContentBlock[]): string[] {
  if (!Array.isArray(content)) return [];
  const files: string[] = [];
  for (const block of content) {
    if (block.type === 'tool_use' && block.input) {
      const filePath =
        (block.input as any).path ||
        (block.input as any).file_path ||
        (block.input as any).filePath;
      if (typeof filePath === 'string') {
        files.push(filePath.replace(/\\/g, '/'));
      }
    }
  }
  return files;
}
