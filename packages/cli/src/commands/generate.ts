/**
 * `aspectcode generate` — discover, analyze, and emit artifacts.
 *
 * Pipeline: discoverFiles → readAll → analyzeRepo → runEmitters → report
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  discoverFiles,
  analyzeRepo,
} from '@aspectcode/core';
import {
  createNodeEmitterHost,
  runEmitters,
  detectAssistants,
} from '@aspectcode/emitters';
import type { EmitOptions, AssistantFlags } from '@aspectcode/emitters';
import type { CliFlags, CommandResult } from '../cli';
import { ExitCode } from '../cli';
import type { AspectCodeConfig } from '../config';
import type { Logger } from '../logger';
import { fmt } from '../logger';

export async function runGenerate(
  root: string,
  flags: CliFlags,
  config: AspectCodeConfig | undefined,
  log: Logger,
): Promise<CommandResult> {
  const startMs = Date.now();

  // ── 1. Resolve options ────────────────────────────────────
  const outDir = flags.out ?? config?.outDir ?? undefined;
  const resolvedOut = outDir ? path.resolve(root, outDir) : root;
  const exclude = config?.exclude;

  log.info(`Workspace: ${fmt.cyan(root)}`);
  if (outDir) log.info(`Output:    ${fmt.cyan(resolvedOut)}`);
  log.blank();

  // ── 2. Discover files ─────────────────────────────────────
  log.debug('Discovering files…');
  const discoveredPaths = await discoverFiles(root, exclude ? { exclude } : undefined);

  if (discoveredPaths.length === 0) {
    log.warn('No source files found. Check your exclude patterns.');
    return { exitCode: ExitCode.ERROR };
  }
  log.info(`Found ${fmt.bold(String(discoveredPaths.length))} source files`);

  // ── 3. Read file contents ─────────────────────────────────
  log.debug('Reading file contents…');
  const fileContents = new Map<string, string>();
  for (const abs of discoveredPaths) {
    const rel = path.relative(root, abs).replace(/\\/g, '/');
    try {
      const content = fs.readFileSync(abs, 'utf-8');
      fileContents.set(rel, content);
    } catch {
      log.debug(`  skip (unreadable): ${rel}`);
    }
  }

  // ── 4. Analyze ────────────────────────────────────────────
  log.debug('Analyzing repository…');
  const model = analyzeRepo(root, fileContents);
  log.info(
    `Analyzed: ${fmt.bold(String(model.files.length))} files, ` +
    `${fmt.bold(String(model.graph.edges.length))} edges`,
  );

  // ── 5. Detect assistants ──────────────────────────────────
  const host = createNodeEmitterHost();
  const assistants = resolveAssistants(flags, config, await detectAssistants(host, root));
  const instructionsMode = config?.instructionsMode ?? 'safe';

  const assistantNames = Object.entries(assistants)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (assistantNames.length > 0) {
    log.info(`Assistants: ${assistantNames.map((n) => fmt.cyan(n)).join(', ')}`);
  }

  // ── 6. Emit artifacts ─────────────────────────────────────
  log.blank();
  log.debug('Emitting artifacts…');

  const emitOpts: EmitOptions = {
    workspaceRoot: root,
    outDir: resolvedOut,
    assistants,
    instructionsMode,
    fileContents,
  };

  const report = await runEmitters(model, host, emitOpts);

  // ── 7. Report ─────────────────────────────────────────────
  const elapsedMs = Date.now() - startMs;

  for (const w of report.wrote) {
    const rel = path.relative(root, w.path).replace(/\\/g, '/');
    log.success(`${rel} (${formatBytes(w.bytes)})`);
  }

  if (report.skipped) {
    for (const s of report.skipped) {
      log.debug(`  skipped: ${s.id} — ${s.reason}`);
    }
  }

  log.blank();
  log.info(
    fmt.dim(`Done in ${(elapsedMs / 1000).toFixed(1)}s — `) +
    `${report.wrote.length} files written`,
  );

  return { exitCode: ExitCode.OK, report };
}

// ── Helpers ──────────────────────────────────────────────────

function resolveAssistants(
  flags: CliFlags,
  config: AspectCodeConfig | undefined,
  detected: Set<string>,
): AssistantFlags {
  // CLI flag takes priority: --assistants copilot,cursor
  if (flags.assistants) {
    const names = flags.assistants.split(',').map((s) => s.trim().toLowerCase());
    return {
      copilot: names.includes('copilot'),
      cursor: names.includes('cursor'),
      claude: names.includes('claude'),
      other: names.includes('other'),
    };
  }

  // Config file next
  if (config?.assistants) {
    return config.assistants;
  }

  // Auto-detect as fallback
  return {
    copilot: detected.has('copilot'),
    cursor: detected.has('cursor'),
    claude: detected.has('claude'),
    other: detected.has('other'),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}
