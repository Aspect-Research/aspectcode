/**
 * Shared workspace file-loading utilities for CLI commands.
 *
 * Encapsulates the discover → smart-ignore → read pipeline.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  discoverFiles,
  createNodeHostForWorkspace,
  type CoreHost,
} from '@aspectcode/core';
import type { AspectCodeConfig } from './config';
import { saveConfig } from './config';
import type { Logger } from './logger';
import type { SpinnerFactory } from './cli';
import { createSpinner } from './logger';
import type { LlmProvider, ChatMessage } from '@aspectcode/optimizer';

export interface WorkspaceFiles {
  /** Map of relative (posix) path → file content */
  relativeFiles: Map<string, string>;
  /** Absolute paths returned by discoverFiles */
  discoveredPaths: string[];
  /** Pre-built host for the workspace (undefined when WASM dir cannot be resolved) */
  host: CoreHost | undefined;
}

const SMART_IGNORE_THRESHOLD = 5000;

const SMART_IGNORE_SYSTEM = `You identify directories to exclude from static analysis. You receive a directory tree with file counts and samples. Respond with ONLY a JSON array of directory names. Be conservative — only exclude directories where the name AND file samples clearly indicate non-source content (generated code, vendored deps, build output, test fixtures, data dumps, compiled assets). When in doubt, do NOT exclude.`;

/**
 * Build a compact directory tree summary from flat paths.
 * Groups by directory, shows file count and up to 2 sample filenames per dir.
 */
export function buildDirectoryTree(paths: string[]): string {
  const dirMap = new Map<string, string[]>();
  for (const p of paths) {
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.';
    const file = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
    const existing = dirMap.get(dir);
    if (existing) {
      existing.push(file);
    } else {
      dirMap.set(dir, [file]);
    }
  }

  const lines: string[] = [];
  const sortedDirs = [...dirMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [dir, files] of sortedDirs) {
    const samples = files.slice(0, 2).join(', ');
    const more = files.length > 2 ? `, +${files.length - 2} more` : '';
    lines.push(`${dir}/ (${files.length} files) — ${samples}${more}`);
  }
  return lines.join('\n');
}

export function buildSmartIgnorePrompt(paths: string[]): string {
  const tree = buildDirectoryTree(paths);
  return `Project has ${paths.length} source files. Below is the directory structure with file counts and samples.

Identify top-level or nested directory names that should be excluded from static analysis because they contain generated code, vendored dependencies, build artifacts, test fixtures, data files, compiled output, or other non-source content.

Return ONLY a JSON array of directory names. Example: ["vendor", "generated", "fixtures"]
Already excluded by default: node_modules, dist, build, .git, .next, __pycache__, venv, coverage, target, .wrangler
If nothing should be excluded, return [].

${tree}`;
}

export function parseSmartIgnoreResponse(raw: string): string[] {
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
      return parsed.filter((s) => s.length > 0);
    }
  } catch {
    const match = cleaned.match(/\[[\s\S]*?\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === 'string' && s.length > 0);
      } catch { /* give up */ }
    }
  }
  return [];
}

async function smartIgnore(
  relativePaths: string[],
  provider: LlmProvider,
  log: Logger,
): Promise<{ dirs: string[]; succeeded: boolean }> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SMART_IGNORE_SYSTEM },
    { role: 'user', content: buildSmartIgnorePrompt(relativePaths) },
  ];

  try {
    const response = await provider.chat(messages);
    const dirs = parseSmartIgnoreResponse(response);
    if (dirs.length > 0) {
      log.info(`Smart ignore: excluding ${dirs.join(', ')}`);
    }
    return { dirs, succeeded: true };
  } catch (err) {
    log.debug(`Smart ignore failed: ${err instanceof Error ? err.message : String(err)}`);
    return { dirs: [], succeeded: false };
  }
}

/**
 * Discover and read all source files in the workspace.
 *
 * On first run with many files, asks an LLM to identify directories
 * to exclude, then caches the result in aspectcode.json.
 */
export async function loadWorkspaceFiles(
  root: string,
  config: AspectCodeConfig | undefined,
  log: Logger,
  opts?: { quiet?: boolean; spin?: SpinnerFactory; provider?: LlmProvider },
): Promise<WorkspaceFiles> {
  const userExclude = config?.exclude ?? [];
  const smartExclude = config?.smartExclude ?? [];
  const allExclude = [...userExclude, ...smartExclude];
  const makeSpin = opts?.spin ?? ((msg: string) => createSpinner(msg, { quiet: opts?.quiet }));

  const spin = makeSpin('Discovering files…', 'discovering');
  let discoveredPaths = await discoverFiles(root, allExclude.length > 0 ? { exclude: allExclude } : undefined);

  if (discoveredPaths.length === 0) {
    spin.stop('No files found');
    return { relativeFiles: new Map(), discoveredPaths: [], host: createNodeHostForWorkspace(root) };
  }

  const hitCap = discoveredPaths.length >= 10_000;
  spin.stop(`Discovered ${discoveredPaths.length} files`);

  // Smart ignore: on first run with many files, ask LLM to filter
  if (!config?.smartExclude && discoveredPaths.length > SMART_IGNORE_THRESHOLD && opts?.provider) {
    const relativePaths = discoveredPaths.map((abs) => path.relative(root, abs).replace(/\\/g, '/'));
    const spinSmart = makeSpin('Analyzing file tree…', 'discovering');
    const { dirs: newExclusions, succeeded } = await smartIgnore(relativePaths, opts.provider, log);
    spinSmart.stop(newExclusions.length > 0 ? `Excluding ${newExclusions.length} directories` : 'No extra exclusions needed');

    // Only cache when the LLM actually responded (not on transient failures)
    if (succeeded) {
      saveConfig(root, { smartExclude: newExclusions });
    }

    if (newExclusions.length > 0) {
      // Re-discover with new exclusions
      const updatedExclude = [...allExclude, ...newExclusions];
      discoveredPaths = await discoverFiles(root, { exclude: updatedExclude });
      log.info(`After smart ignore: ${discoveredPaths.length} files`);
    }
  }

  if (hitCap) {
    log.warn(`Capped at 10,000 files — add exclusions to aspectcode.json to cover the full repo`);
  }

  const spinRead = makeSpin(`Reading ${discoveredPaths.length} files…`, 'discovering');
  const relativeFiles = new Map<string, string>();
  for (const abs of discoveredPaths) {
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    try {
      const content = fs.readFileSync(abs, 'utf-8');
      relativeFiles.set(rel, content);
    } catch {
      log.debug(`  skip (unreadable): ${rel}`);
    }
  }
  spinRead.stop(`Read ${relativeFiles.size} files`);

  return {
    relativeFiles,
    discoveredPaths,
    host: createNodeHostForWorkspace(root),
  };
}
