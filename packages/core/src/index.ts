/**
 * @aspectcode/core — public API surface
 *
 * This package contains pure-logic code with ZERO dependency on the `vscode`
 * module. Everything here must be usable from a CLI, a test harness, or the
 * VS Code extension equally.
 */

import * as path from 'path';

// ── Re-exports: types ────────────────────────────────────────

export type {
  AnalysisModel,
  AnalyzedFile,
  ExtractedSymbol,
  FileSymbols,
  Graph,
  GraphNode,
  GraphEdge,
  DependencyLink,
  Metrics,
  HubMetric,
  RepoMeta,
} from './model';

export type { CoreHost, WasmPaths } from './host';
export { createNodeHost } from './host';

// ── Re-exports: paths ────────────────────────────────────────

export { toPosix } from './paths';

// ── Re-exports: stats ────────────────────────────────────────

export { computeModelStats } from './stats';
export type { ModelStats } from './stats';

// ── Re-exports: file system ──────────────────────────────────

export {
  DEFAULT_EXCLUSIONS,
  SUPPORTED_EXTENSIONS,
  PACKAGE_MANAGER_DIRS,
  BUILD_OUTPUT_DIRS,
  VENV_DIRS,
  CACHE_DIRS,
  VCS_IDE_DIRS,
  TEST_OUTPUT_DIRS,
  GENERATED_DIRS,
  VENV_MARKERS,
  BUILD_OUTPUT_MARKERS,
  discoverFiles,
} from './fs/index';
export type { DiscoverOptions } from './fs/index';

// ── Re-exports: parsers ──────────────────────────────────────

export {
  loadGrammars,
  textFor,
  extractPythonImports,
  extractPythonSymbols,
  extractTSJSImports,
  extractTSJSSymbols,
  extractJavaSymbols,
  extractCSharpSymbols,
} from './parsers/index';
export type { LoadedGrammars, GrammarSummary, LogFn } from './parsers/index';

// ── Re-exports: analysis ─────────────────────────────────────

export {
  DependencyAnalyzer,
  analyzeFileImports,
  analyzeFileCalls,
  calculateImportStrength,
  isLikelyExternalCall,
  buildFileIndex,
  resolveModulePathFast,
  resolveCallTargetFast,
} from './analysis/index';
export type {
  DependencyProgressCallback,
  ImportStatement,
  CallSite,
  FileIndex,
} from './analysis/index';

// ── Backward-compat alias ────────────────────────────────────

import type { AnalysisModel, AnalyzedFile } from './model';
import { toPosix } from './paths';
import { DependencyAnalyzer } from './analysis/index';

/**
 * @deprecated Use `AnalysisModel` instead.
 */
export type RepoModel = AnalysisModel;

// ── analyzeRepo (stub → will grow in later PRs) ─────────────

/**
 * Analyze a set of files and produce a serializable AnalysisModel.
 *
 * Today this is a regex-based stub. In later PRs it will grow to use
 * tree-sitter extraction, real dependency resolution, and hub metrics.
 *
 * @param rootDir  Absolute path to the workspace root
 * @param files    Map of relative-path → file content
 */
export function analyzeRepo(
  rootDir: string,
  files: Map<string, string>,
): AnalysisModel {
  const analyzedFiles: AnalyzedFile[] = [];
  const languageCounts: Record<string, number> = {};
  let totalLines = 0;

  for (const [relativePath, content] of files) {
    const language = detectLanguage(relativePath);
    const lineCount = content.split('\n').length;
    const exports = extractExportNames(content, language);
    const imports = extractImportModules(content, language);

    totalLines += lineCount;
    languageCounts[language] = (languageCounts[language] ?? 0) + 1;

    analyzedFiles.push({ relativePath: toPosix(relativePath), language, lineCount, exports, imports });
  }

  return {
    schemaVersion: '0.1',
    generatedAt: new Date().toISOString(),
    repo: { root: rootDir },
    files: analyzedFiles,
    symbols: [],
    graph: { nodes: [], edges: [] },
    metrics: { hubs: [] },
  };
}

/**
 * Analyze repository files and enrich the model with dependency links and hubs.
 *
 * @param rootDir            Absolute path to the workspace root
 * @param relativeFiles      Map of relative-path → file content
 * @param absoluteFiles      Map of absolute-path → file content (for dependency analysis)
 */
export async function analyzeRepoWithDependencies(
  rootDir: string,
  relativeFiles: Map<string, string>,
  absoluteFiles: Map<string, string>,
): Promise<AnalysisModel> {
  const model = analyzeRepo(rootDir, relativeFiles);
  if (absoluteFiles.size === 0) {
    return model;
  }

  const analyzer = new DependencyAnalyzer();
  analyzer.setFileContentsCache(absoluteFiles);
  const absolutePaths = Array.from(absoluteFiles.keys());
  const absoluteEdges = await analyzer.analyzeDependencies(absolutePaths);

  const toRel = (p: string): string => toPosix(path.relative(rootDir, p));
  const edges = absoluteEdges.map((edge) => ({
    ...edge,
    source: toRel(edge.source),
    target: toRel(edge.target),
  }));

  model.graph = {
    nodes: model.files.map((f) => ({
      id: f.relativePath,
      path: f.relativePath,
      language: f.language,
    })),
    edges,
  };
  model.metrics = { hubs: computeHubs(edges) };

  return model;
}

// ── Internal helpers ─────────────────────────────────────────

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    java: 'java',
    cs: 'csharp',
    go: 'go',
  };
  return map[ext] ?? 'unknown';
}

/** Naive export extraction — good enough for snapshot tests */
function extractExportNames(content: string, language: string): string[] {
  const names: string[] = [];
  if (language === 'typescript' || language === 'javascript') {
    const re =
      /export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      names.push(m[1]);
    }
  } else if (language === 'python') {
    const re = /^(?:def|class)\s+(\w+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      names.push(m[1]);
    }
  }
  return names;
}

/** Naive import-module extraction */
function extractImportModules(content: string, language: string): string[] {
  const modules: string[] = [];
  if (language === 'typescript' || language === 'javascript') {
    const re = /from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      modules.push(m[1]);
    }
  } else if (language === 'python') {
    const re = /^(?:import|from)\s+([\w.]+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      modules.push(m[1]);
    }
  }
  return [...new Set(modules)];
}

function computeHubs(
  edges: Array<{ source: string; target: string }>,
): Array<{ file: string; inDegree: number; outDegree: number }> {
  const stats = new Map<string, { inDegree: number; outDegree: number }>();

  for (const edge of edges) {
    const source = stats.get(edge.source) ?? { inDegree: 0, outDegree: 0 };
    source.outDegree += 1;
    stats.set(edge.source, source);

    const target = stats.get(edge.target) ?? { inDegree: 0, outDegree: 0 };
    target.inDegree += 1;
    stats.set(edge.target, target);
  }

  return Array.from(stats.entries())
    .map(([file, value]) => ({ file, inDegree: value.inDegree, outDegree: value.outDegree }))
    .sort(
      (a, b) =>
        b.inDegree +
          b.outDegree -
          (a.inDegree + a.outDegree) ||
        a.file.localeCompare(b.file),
    )
    .slice(0, 10);
}
