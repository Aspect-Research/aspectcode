/**
 * Knowledge Base generation — thin wrapper around @aspectcode/core + @aspectcode/emitters.
 *
 * All analysis, detection, and artifact generation logic lives in the shared
 * packages. This module provides the VS Code integration layer:
 *   - File discovery via VS Code APIs
 *   - Progress reporting
 *   - Gitignore prompt
 *   - Impact summary for clipboard command
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { type AnalysisModel } from '@aspectcode/core';
import * as aspectCore from '@aspectcode/core';
import { runEmitters, classifyFile } from '@aspectcode/emitters';
import { AspectCodeState } from '../state';
import { DependencyAnalyzer, type DependencyLink } from '../services/DependencyAnalyzer';
import { loadGrammarsOnce, type LoadedGrammars } from '../tsParser';
import { ensureGitignoreForTarget } from '../services/gitignoreService';
import type { GitignoreTarget } from '../services/aspectSettings';
import { discoverSourceFiles } from '../services/DirectoryExclusion';
import { getFileDiscoveryService } from '../services/FileDiscoveryService';
import { createVsCodeEmitterHost } from '../services/vscodeEmitterHost';
import { buildRelativeFileContentMap } from './kbShared';
import { cliGenerate, cliImpact } from '../services/CliAdapter';

// ============================================================================
// File Content Cache
// ============================================================================

/**
 * Pre-load all file contents into a cache to avoid repeated file reads.
 * Reads each file once and shares the content across all consumers.
 */
async function preloadFileContents(files: string[]): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  const BATCH_SIZE = 30;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        try {
          const uri = vscode.Uri.file(file);
          const content = await vscode.workspace.fs.readFile(uri);
          return { file, content: Buffer.from(content).toString('utf8') };
        } catch {
          return { file, content: '' };
        }
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.content) {
        cache.set(result.value.file, result.value.content);
      }
    }
  }

  return cache;
}

// ============================================================================
// KB Regeneration
// ============================================================================

/**
 * SINGLE entry point for all KB regeneration in the extension.
 * Called by: onChange/idle auto-regen and generateKB command.
 *
 * This function:
 * 1. Checks if .aspect/ exists (skips if not - run configureAssistants first)
 * 2. Delegates to @aspectcode/emitters via generateKnowledgeBase
 * 3. Does NOT regenerate instruction files (those require configureAssistants)
 *
 * @returns Object with regenerated flag and discovered files (for markKbFresh)
 */
export interface RegenerateResult {
  regenerated: boolean;
  files: string[];
}

export async function regenerateEverything(
  state: AspectCodeState,
  outputChannel: vscode.OutputChannel,
  context?: vscode.ExtensionContext,
): Promise<RegenerateResult> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    outputChannel.appendLine('[KB] regenerateEverything: No workspace folder');
    return { regenerated: false, files: [] };
  }

  const workspaceRoot = workspaceFolders[0].uri;

  // Check if .aspect/ already exists - don't auto-create
  // Users must explicitly initialize via configureAssistants command
  try {
    const aspectDir = vscode.Uri.joinPath(workspaceRoot, '.aspect');
    await vscode.workspace.fs.stat(aspectDir);
  } catch {
    // .aspect/ doesn't exist - skip regeneration
    outputChannel.appendLine(
      '[KB] regenerateEverything: Skipped (.aspect/ not yet created - run configureAssistants to initialize)',
    );
    return { regenerated: false, files: [] };
  }

  try {
    const regenStart = Date.now();
    outputChannel.appendLine('[KB] regenerateEverything: Starting KB regeneration...');

    // Regenerate KB files - returns the discovered files
    const files = await generateKnowledgeBase(workspaceRoot, state, outputChannel, context);

    outputChannel.appendLine(`[KB] regenerateEverything: Complete in ${Date.now() - regenStart}ms`);
    return { regenerated: true, files };
  } catch (error) {
    outputChannel.appendLine(`[KB] regenerateEverything: Failed - ${error}`);
    throw error;
  }
}

/**
 * Generates the .aspect/ knowledge base directory.
 *
 * Strategy: try the CLI subprocess first (`aspectcode generate --json --kb-only`).
 * If the CLI is unavailable (not installed / not built), fall back to in-process
 * analysis via @aspectcode/core + @aspectcode/emitters.
 *
 * @returns The list of discovered files (for reuse by markKbFresh)
 */
export async function generateKnowledgeBase(
  workspaceRoot: vscode.Uri,
  state: AspectCodeState,
  outputChannel: vscode.OutputChannel,
  context?: vscode.ExtensionContext,
): Promise<string[]> {
  outputChannel.appendLine('[KB] generateKnowledgeBase called');

  const aspectCodeDir = vscode.Uri.joinPath(workspaceRoot, '.aspect');

  // Ensure .aspect directory exists
  try {
    await vscode.workspace.fs.createDirectory(aspectCodeDir);
    outputChannel.appendLine('[KB] .aspect directory created/confirmed');
  } catch (e) {
    outputChannel.appendLine(`[KB] .aspect directory create result: ${e}`);
  }

  const kbStart = Date.now();
  outputChannel.appendLine('[KB] Generating knowledge base in .aspect/');

  // ── Try CLI subprocess first ──────────────────────────────
  const cliResult = await cliGenerate(workspaceRoot.fsPath, {
    outputChannel,
    extraArgs: ['--kb-only'],
  });

  if (cliResult.exitCode === 0 && cliResult.data) {
    outputChannel.appendLine(
      `[KB] CLI generate succeeded: ${cliResult.data.wrote.length} files in ${Date.now() - kbStart}ms`,
    );

    // Prompt user for .aspect/ gitignore preference AFTER KB is generated.
    const aspectTarget: GitignoreTarget = '.aspect/';
    void ensureGitignoreForTarget(workspaceRoot, aspectTarget, outputChannel).catch((e) => {
      outputChannel.appendLine(`[KB] Gitignore prompt failed (non-critical): ${e}`);
    });

    // Discover workspace files for markKbFresh (cheap, cached by FileDiscoveryService).
    const files = await discoverWorkspaceFiles(workspaceRoot, outputChannel);
    return files;
  }

  // CLI not available — log and fall through to in-process path.
  outputChannel.appendLine(
    `[KB] CLI unavailable (exit=${cliResult.exitCode}), falling back to in-process generation`,
  );
  if (cliResult.stderr) {
    outputChannel.appendLine(`[KB] CLI stderr: ${cliResult.stderr.substring(0, 500)}`);
  }

  // ── In-process fallback ───────────────────────────────────
  return generateKnowledgeBaseInProcess(workspaceRoot, state, outputChannel, context);
}

/**
 * In-process KB generation fallback.
 * Used when the CLI subprocess is not available.
 */
async function generateKnowledgeBaseInProcess(
  workspaceRoot: vscode.Uri,
  _state: AspectCodeState,
  outputChannel: vscode.OutputChannel,
  context?: vscode.ExtensionContext,
): Promise<string[]> {
  const kbStart = Date.now();

  // Load tree-sitter grammars if context is available
  let grammars: LoadedGrammars | null = null;
  if (context) {
    try {
      const tGrammar = Date.now();
      grammars = await loadGrammarsOnce(context, outputChannel);
      outputChannel.appendLine(`[KB] Tree-sitter grammars loaded (${Date.now() - tGrammar}ms)`);
    } catch (e) {
      outputChannel.appendLine(
        `[KB] Tree-sitter grammars not available, using regex fallback: ${e}`,
      );
    }
  }

  // Pre-fetch shared data using FileDiscoveryService (or fallback)
  const tDiscover = Date.now();
  const files = await discoverWorkspaceFiles(workspaceRoot, outputChannel);
  outputChannel.appendLine(
    `[KB][Perf] discoverWorkspaceFiles: ${files.length} files in ${Date.now() - tDiscover}ms`,
  );

  // Pre-load all file contents once to avoid repeated reads (major perf optimization)
  const tCache = Date.now();
  const fileContentCache = await preloadFileContents(files);
  outputChannel.appendLine(
    `[KB][Perf] preloadFileContents: ${fileContentCache.size} files cached in ${Date.now() - tCache}ms`,
  );

  const generatedAt = new Date().toISOString();
  const rootFsPath = workspaceRoot.fsPath;
  const tAnalyze = Date.now();
  const relativeFileContents = buildRelativeFileContentMap(files, rootFsPath, fileContentCache);
  const sharedAnalyze = (aspectCore as {
    analyzeRepoWithDependencies?: (
      rootDir: string,
      relativeFiles: Map<string, string>,
      absoluteFiles: Map<string, string>,
    ) => Promise<AnalysisModel>;
  }).analyzeRepoWithDependencies;
  if (typeof sharedAnalyze !== 'function') {
    throw new Error('Installed @aspectcode/core does not expose analyzeRepoWithDependencies');
  }

  const model: AnalysisModel = await sharedAnalyze(
    rootFsPath,
    relativeFileContents,
    fileContentCache,
  );
  model.generatedAt = generatedAt;
  outputChannel.appendLine(
    `[KB][Perf] analyzeRepoWithDependencies(shared): ${model.graph.edges.length} edges in ${Date.now() - tAnalyze}ms`,
  );

  // Delegate artifact generation (KB + manifest) to @aspectcode/emitters.
  // This keeps the extension as a thin wrapper, with deterministic output and
  // transaction-style staging (manifest written last).
  const tWrite = Date.now();
  outputChannel.appendLine(
    `[KB] Starting emitter generation: outDir=${workspaceRoot.fsPath}, files=${files.length}`,
  );

  try {
    const host = createVsCodeEmitterHost();
    const report = await runEmitters(model, host, {
      workspaceRoot: rootFsPath,
      outDir: rootFsPath,
      generatedAt,
      fileContents: fileContentCache,
      // KB-only from this entry point; instruction generation is handled elsewhere.
      assistants: {},
      instructionsMode: 'off',
    });

    outputChannel.appendLine(
      `[KB][Perf] emitter wrote ${report.wrote.length} files in ${Date.now() - tWrite}ms`,
    );
  } catch (writeErr) {
    outputChannel.appendLine(`[KB] ERROR running emitters: ${writeErr}`);
    throw writeErr;
  }

  outputChannel.appendLine(
    `[KB] Knowledge base generation complete (KB + manifest) in ${Date.now() - kbStart}ms`,
  );

  // Prompt user for .aspect/ gitignore preference AFTER KB is generated.
  // This runs async (non-blocking) so it doesn't hold up the rest of the flow.
  const aspectTarget: GitignoreTarget = '.aspect/';
  void ensureGitignoreForTarget(workspaceRoot, aspectTarget, outputChannel).catch((e) => {
    outputChannel.appendLine(`[KB] Gitignore prompt failed (non-critical): ${e}`);
  });

  // Return the discovered files so they can be reused (e.g., by markKbFresh)
  return files;
}

// ============================================================================
// Impact Analysis
// ============================================================================

export type ImpactSummary = {
  file: string;
  dependents_count: number;
  top_dependents: Array<{ file: string; dependent_count: number }>;
  generated_at: string;
};

/**
 * Computes a lightweight impact summary for a single file.
 * Tries CLI subprocess first, falls back to in-process analysis.
 */
export async function computeImpactSummaryForFile(
  workspaceRoot: vscode.Uri,
  absoluteFilePath: string,
  outputChannel: vscode.OutputChannel,
): Promise<ImpactSummary | null> {
  // ── Try CLI subprocess first ──────────────────────────────
  const relPath = path.relative(workspaceRoot.fsPath, absoluteFilePath).replace(/\\/g, '/');
  const cliResult = await cliImpact(workspaceRoot.fsPath, relPath, { outputChannel });
  if (cliResult.exitCode === 0 && cliResult.data) {
    outputChannel.appendLine(`[Impact] CLI impact succeeded for ${relPath}`);
    return cliResult.data;
  }

  outputChannel.appendLine(
    `[Impact] CLI unavailable (exit=${cliResult.exitCode}), falling back to in-process`,
  );

  // ── In-process fallback ───────────────────────────────────
  return computeImpactSummaryInProcess(workspaceRoot, absoluteFilePath, outputChannel);
}

/**
 * In-process impact analysis fallback.
 */
async function computeImpactSummaryInProcess(
  workspaceRoot: vscode.Uri,
  absoluteFilePath: string,
  outputChannel: vscode.OutputChannel,
): Promise<ImpactSummary | null> {
  try {
    const files = await discoverWorkspaceFiles(workspaceRoot);
    if (files.length === 0) return null;

    const normalizedTarget = path.resolve(absoluteFilePath);
    const fileContentCache = await preloadFileContents(files);
    const { stats: depData, links: allLinks } = await getDetailedDependencyData(
      workspaceRoot,
      files,
      outputChannel,
      fileContentCache,
    );

    const targetClass = classifyFile(normalizedTarget, workspaceRoot.fsPath);
    if (targetClass === 'third_party') {
      return {
        file: makeRelativePath(normalizedTarget, workspaceRoot.fsPath),
        dependents_count: 0,
        top_dependents: [],
        generated_at: new Date().toISOString(),
      };
    }

    const dependentAbs = dedupe(
      allLinks
        .filter((l) => l.target && path.resolve(l.target) === normalizedTarget)
        .map((l) => l.source)
        .filter(Boolean)
        .filter((s) => s !== normalizedTarget)
        .filter((s) => classifyFile(s, workspaceRoot.fsPath) !== 'third_party'),
    );

    // Prefer showing app/test dependents; if none, fall back to whatever we found.
    const appOrTestDependents = dependentAbs.filter((s) => {
      const c = classifyFile(s, workspaceRoot.fsPath);
      return c === 'app' || c === 'test';
    });
    const dependentsToUse = appOrTestDependents.length > 0 ? appOrTestDependents : dependentAbs;

    const dependentsWithCounts = dependentsToUse
      .map((dep) => ({
        abs: dep,
        dependent_count: depData.get(dep)?.inDegree ?? 0,
      }))
      .sort((a, b) => b.dependent_count - a.dependent_count || a.abs.localeCompare(b.abs));

    const dependentsCount = dependentsWithCounts.length;

    const topDependents = dependentsWithCounts.slice(0, 5).map((d) => ({
      file: makeRelativePath(d.abs, workspaceRoot.fsPath),
      dependent_count: d.dependent_count,
    }));

    return {
      file: makeRelativePath(normalizedTarget, workspaceRoot.fsPath),
      dependents_count: dependentsCount,
      top_dependents: topDependents,
      generated_at: new Date().toISOString(),
    };
  } catch (e) {
    outputChannel.appendLine(`[Impact] Impact summary failed: ${e}`);
    return null;
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function getDetailedDependencyData(
  workspaceRoot: vscode.Uri,
  files: string[],
  outputChannel: vscode.OutputChannel,
  fileContentCache?: Map<string, string>,
): Promise<{
  stats: Map<string, { inDegree: number; outDegree: number }>;
  links: DependencyLink[];
}> {
  const stats = new Map<string, { inDegree: number; outDegree: number }>();
  let links: DependencyLink[] = [];

  try {
    if (files.length === 0) return { stats, links };

    const analyzer = new DependencyAnalyzer();
    if (fileContentCache && fileContentCache.size > 0) {
      analyzer.setFileContentsCache(fileContentCache);
    }
    outputChannel.appendLine(`[KB] Starting dependency analysis for ${files.length} files...`);
    const depStart = Date.now();
    links = await analyzer.analyzeDependencies(files);
    outputChannel.appendLine(
      `[KB] Dependency analysis complete: ${links.length} links in ${Date.now() - depStart}ms`,
    );

    for (const file of files) {
      stats.set(file, { inDegree: 0, outDegree: 0 });
    }

    for (const link of links) {
      const sourceStats = stats.get(link.source);
      const targetStats = stats.get(link.target);
      if (sourceStats) sourceStats.outDegree++;
      if (targetStats) targetStats.inDegree++;
    }

    outputChannel.appendLine(`[KB] Analyzed ${links.length} dependencies`);
  } catch (error) {
    outputChannel.appendLine(`[KB] Dependency analysis failed: ${error}`);
  }

  return { stats, links };
}

/**
 * Discover workspace files using the centralized FileDiscoveryService.
 * Falls back to direct discovery if the service isn't initialized.
 */
async function discoverWorkspaceFiles(
  workspaceRoot: vscode.Uri,
  outputChannel?: vscode.OutputChannel,
): Promise<string[]> {
  const service = getFileDiscoveryService();
  if (service) {
    return service.getFiles();
  }
  return discoverSourceFiles(workspaceRoot, outputChannel);
}

function makeRelativePath(absPath: string, workspaceRoot: string): string {
  const normalizedAbs = absPath.replace(/\\/g, '/');
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '');

  if (normalizedAbs.startsWith(normalizedRoot)) {
    return normalizedAbs.substring(normalizedRoot.length).replace(/^\//, '');
  }
  return path.basename(absPath);
}

function dedupe<T>(items: T[], keyFn?: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn ? keyFn(item) : String(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
