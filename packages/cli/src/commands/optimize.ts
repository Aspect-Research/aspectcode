/**
 * `aspectcode optimize` — refine AGENTS.md instructions using an LLM.
 *
 * Reads the current AGENTS.md and kb.md, calls the optimization agent,
 * and writes the improved instructions back into AGENTS.md (marker-based merge).
 *
 * Configuration precedence: CLI flag → aspectcode.json → .env → default.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  resolveProvider,
  loadEnvFile,
  runOptimizeAgent,
} from '@aspectcode/optimizer';
import type { ProviderOptions } from '@aspectcode/optimizer';
import type { CommandContext, CommandResult } from '../cli';
import { ExitCode } from '../cli';
import { fmt } from '../logger';

/** Markers matching those in @aspectcode/emitters. */
const ASPECT_CODE_START = '<!-- ASPECT_CODE_START -->';
const ASPECT_CODE_END = '<!-- ASPECT_CODE_END -->';

/** Extract the content between the Aspect Code markers. */
function extractMarkedSection(content: string): string | null {
  const startIdx = content.indexOf(ASPECT_CODE_START);
  const endIdx = content.indexOf(ASPECT_CODE_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
  return content.slice(startIdx + ASPECT_CODE_START.length, endIdx).trim();
}

/** Replace the content between markers with new content. */
function replaceMarkedSection(fullContent: string, newSection: string): string {
  const startIdx = fullContent.indexOf(ASPECT_CODE_START);
  const endIdx = fullContent.indexOf(ASPECT_CODE_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // No markers — wrap and append
    return fullContent + '\n\n' + ASPECT_CODE_START + '\n' + newSection + '\n' + ASPECT_CODE_END + '\n';
  }
  const before = fullContent.slice(0, startIdx + ASPECT_CODE_START.length);
  const after = fullContent.slice(endIdx);
  return `${before}\n${newSection}\n${after}`;
}

/** Try to read a previous version of kb.md from git for diff computation. */
function readPreviousKb(root: string, kbPath: string): string | null {
  try {
    const { execSync } = require('child_process');
    const relative = path.relative(root, kbPath).replace(/\\/g, '/');
    const result = execSync(`git show HEAD:${relative}`, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result;
  } catch {
    return null;
  }
}

/** Compute a simple line diff between two strings. */
function computeDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const diffLines: string[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === undefined) {
      diffLines.push(`+ ${newLine}`);
    } else if (newLine === undefined) {
      diffLines.push(`- ${oldLine}`);
    } else if (oldLine !== newLine) {
      diffLines.push(`- ${oldLine}`);
      diffLines.push(`+ ${newLine}`);
    }
  }
  return diffLines.join('\n');
}

export async function runOptimize(ctx: CommandContext): Promise<CommandResult> {
  const { root, flags, config, log } = ctx;
  const optConfig = config?.optimize;

  // ── Resolve settings: CLI flag → aspectcode.json → default ──
  const maxIterations = flags.maxIterations ?? optConfig?.maxIterations ?? 3;
  const dryRun = flags.dryRun ?? false;
  const acceptThreshold = flags.acceptThreshold ?? optConfig?.acceptThreshold ?? 8;
  const temperature = flags.temperature ?? optConfig?.temperature;
  const model = flags.model ?? optConfig?.model;
  const providerOverride = flags.provider ?? optConfig?.provider;
  const maxTokens = optConfig?.maxTokens;

  const startMs = Date.now();

  if (!flags.json) {
    log.info(`${fmt.bold('Optimizing')} AGENTS.md instructions…`);
    log.blank();
  }

  // ── 1. Load environment & resolve LLM provider ─────────
  let env: Record<string, string>;
  try {
    env = loadEnvFile(root);
  } catch {
    log.error('Failed to load .env file.');
    return { exitCode: ExitCode.ERROR };
  }

  // Apply provider override from config/flags into env so resolveProvider picks it up
  if (providerOverride && !env['LLM_PROVIDER']) {
    env['LLM_PROVIDER'] = providerOverride;
  }

  const providerOptions: ProviderOptions = {};
  if (model) providerOptions.model = model;
  if (temperature !== undefined) providerOptions.temperature = temperature;
  if (maxTokens !== undefined) providerOptions.maxTokens = maxTokens;

  let provider;
  try {
    provider = resolveProvider(env, providerOptions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(msg);
    return { exitCode: ExitCode.ERROR };
  }

  if (!flags.json) {
    log.info(`Provider: ${fmt.cyan(provider.name)}`);
    if (model) log.info(`Model: ${fmt.cyan(model)}`);
  }

  // ── 2. Read AGENTS.md ─────────────────────────────────
  const agentsPath = path.join(root, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    log.error('AGENTS.md not found. Run `aspectcode generate` first.');
    return { exitCode: ExitCode.ERROR };
  }

  const agentsContent = fs.readFileSync(agentsPath, 'utf-8');
  const currentInstructions = extractMarkedSection(agentsContent);
  if (!currentInstructions) {
    log.error('AGENTS.md does not contain Aspect Code markers. Run `aspectcode generate` first.');
    return { exitCode: ExitCode.ERROR };
  }

  // ── 3. Read kb.md (optional) ──────────────────────────
  const kbPath = path.join(root, '.aspect', 'kb.md');
  let kb = '';
  if (fs.existsSync(kbPath)) {
    kb = fs.readFileSync(kbPath, 'utf-8');
  } else {
    log.warn('kb.md not found. Optimize will proceed without KB context.');
    log.warn('Run `aspectcode generate --kb` first for best results.');
  }

  // ── 4. Compute KB diff (best-effort) ──────────────────
  let kbDiff: string | undefined;
  if (kb) {
    const previousKb = readPreviousKb(root, kbPath);
    if (previousKb && previousKb !== kb) {
      kbDiff = computeDiff(previousKb, kb);
      if (!flags.json) log.info('KB diff computed from git history.');
    }
  }

  // ── 5. Run optimization agent ─────────────────────────
  if (!flags.json) {
    log.info(`Max iterations: ${fmt.cyan(String(maxIterations))}`);
    if (acceptThreshold !== 8) log.info(`Accept threshold: ${fmt.cyan(String(acceptThreshold))}`);
    log.blank();
  }

  const result = await runOptimizeAgent({
    currentInstructions,
    kb,
    kbDiff,
    maxIterations,
    provider,
    log: flags.quiet ? undefined : log,
    acceptThreshold,
    iterationDelayMs: 1_000,
  });

  // ── 6. Output results ─────────────────────────────────
  const elapsedMs = Date.now() - startMs;

  if (dryRun) {
    if (flags.json) {
      console.log(JSON.stringify({
        dryRun: true,
        iterations: result.iterations,
        reasoning: result.reasoning,
        optimizedInstructions: result.optimizedInstructions,
      }, null, 2));
    } else {
      log.info(fmt.bold('Dry run — proposed optimized instructions:'));
      log.blank();
      console.log(result.optimizedInstructions);
      log.blank();
      log.info(`Iterations: ${result.iterations} | Time: ${(elapsedMs / 1000).toFixed(1)}s`);
      for (const reason of result.reasoning) {
        log.info(`  ${fmt.dim(reason)}`);
      }
    }
    return { exitCode: ExitCode.OK };
  }

  // ── 7. Write updated AGENTS.md ────────────────────────
  const updatedContent = replaceMarkedSection(agentsContent, result.optimizedInstructions);
  fs.writeFileSync(agentsPath, updatedContent, 'utf-8');

  if (flags.json) {
    console.log(JSON.stringify({
      iterations: result.iterations,
      reasoning: result.reasoning,
      path: agentsPath,
      elapsedMs,
    }, null, 2));
  } else {
    log.success(`AGENTS.md optimized (${result.iterations} iteration${result.iterations === 1 ? '' : 's'}, ${(elapsedMs / 1000).toFixed(1)}s)`);
    for (const reason of result.reasoning) {
      log.info(`  ${fmt.dim(reason)}`);
    }
  }

  return { exitCode: ExitCode.OK };
}
