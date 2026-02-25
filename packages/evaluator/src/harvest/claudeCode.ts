/**
 * Claude Code prompt harvester.
 *
 * Parses conversation JSONL files from `~/.claude/projects/<hash>/`.
 * Each line is a JSON object with `type: "human" | "assistant" | "summary"`.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { HarvestedPrompt } from '../types';
import { extractFilePaths, filterRecent, DEFAULT_MAX_PER_SOURCE, noopLogger } from './common';
import type { OptLogger } from '../types';

/**
 * Harvest prompts from Claude Code's conversation history.
 */
export async function harvestClaudeCode(
  root: string,
  options?: { max?: number; since?: Date; log?: OptLogger },
): Promise<HarvestedPrompt[]> {
  const log = options?.log ?? noopLogger;
  const max = options?.max ?? DEFAULT_MAX_PER_SOURCE;

  const projectDir = findProjectDir(root);
  if (!projectDir) {
    log.debug('claude-code: no project directory found');
    return [];
  }

  const prompts: HarvestedPrompt[] = [];

  // Find all JSONL conversation files
  let files: string[];
  try {
    files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    log.debug(`claude-code: cannot read ${projectDir}`);
    return [];
  }

  for (const file of files) {
    const filePath = path.join(projectDir, file);
    try {
      const parsed = parseClaudeCodeJsonl(filePath, root);
      prompts.push(...parsed);
    } catch (err) {
      log.debug(`claude-code: failed to parse ${file}: ${err}`);
    }
  }

  log.debug(`claude-code: parsed ${prompts.length} conversation turns from ${files.length} files`);
  return filterRecent(prompts, options?.since, max);
}

/**
 * Find the Claude Code project directory for the given workspace root.
 * Tries multiple hash strategies since the hash algorithm isn't documented.
 */
function findProjectDir(root: string): string | undefined {
  const home = os.homedir();
  const claudeBase = path.join(home, '.claude', 'projects');

  if (!fs.existsSync(claudeBase)) return undefined;

  // Strategy 1: Try common hash formats
  const normalised = root.replace(/\\/g, '/');
  const candidates = [
    // MD5 of the path
    crypto.createHash('md5').update(normalised).digest('hex'),
    // SHA-256 truncated
    crypto.createHash('sha256').update(normalised).digest('hex').slice(0, 32),
    // URL-safe base64 of the path
    Buffer.from(normalised).toString('base64url'),
    // The path with slashes replaced by hyphens
    normalised.replace(/\//g, '-').replace(/^-/, ''),
  ];

  for (const candidate of candidates) {
    const dir = path.join(claudeBase, candidate);
    if (fs.existsSync(dir)) return dir;
  }

  // Strategy 2: Scan all project directories for one that references this workspace
  // (fallback — slower but more reliable)
  try {
    const dirs = fs.readdirSync(claudeBase);
    for (const dir of dirs) {
      const fullDir = path.join(claudeBase, dir);
      const stat = fs.statSync(fullDir);
      if (!stat.isDirectory()) continue;

      // Check if any JSONL file in this directory mentions files from our workspace
      const jsonlFiles = fs.readdirSync(fullDir).filter((f) => f.endsWith('.jsonl'));
      if (jsonlFiles.length === 0) continue;

      // Quick heuristic: read first 2KB of the first file and check for workspace path
      const sample = readHead(path.join(fullDir, jsonlFiles[0]), 2048);
      if (sample.includes(normalised) || sample.includes(root.replace(/\\/g, '\\\\'))) {
        return fullDir;
      }
    }
  } catch {
    // Scanning failed, give up
  }

  return undefined;
}

function readHead(filePath: string, bytes: number): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const bytesRead = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.slice(0, bytesRead).toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Parse a single Claude Code JSONL conversation file.
 */
function parseClaudeCodeJsonl(filePath: string, root: string): HarvestedPrompt[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());
  const prompts: HarvestedPrompt[] = [];

  // Build a paired list of human → assistant turns
  let pendingHuman: { text: string; timestamp?: string } | undefined;

  for (const line of lines) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === 'human') {
      const text = extractTextFromContent(entry.message?.content);
      if (text) {
        pendingHuman = {
          text,
          timestamp: entry.timestamp,
        };
      }
    } else if (entry.type === 'assistant' && pendingHuman) {
      const text = extractTextFromContent(entry.message?.content);
      const fileRefs = extractToolFileRefs(entry.message?.content);
      if (text) {
        const allText = pendingHuman.text + '\n' + text;
        const allFiles = [
          ...extractFilePaths(allText, root),
          ...fileRefs,
        ];
        prompts.push({
          source: 'claude-code',
          timestamp: entry.timestamp || pendingHuman.timestamp,
          userPrompt: pendingHuman.text,
          assistantResponse: text,
          filesReferenced: [...new Set(allFiles)],
        });
      }
      pendingHuman = undefined;
    }
  }

  return prompts;
}

/**
 * Extract plain text from a Claude-style content array.
 */
function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block: any) => block.type === 'text' && typeof block.text === 'string')
    .map((block: any) => block.text)
    .join('\n');
}

/**
 * Extract file paths from tool_use blocks in Claude-style content.
 */
function extractToolFileRefs(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const files: string[] = [];
  for (const block of content) {
    if (block.type === 'tool_use' && block.input) {
      // Common tool patterns: Read (file_path), write_to_file (path), etc.
      const filePath = block.input.file_path || block.input.path || block.input.file;
      if (typeof filePath === 'string') {
        files.push(filePath.replace(/\\/g, '/'));
      }
    }
  }
  return files;
}
