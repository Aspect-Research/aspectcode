/**
 * @aspectcode/core — public API surface
 *
 * Pure-logic code analysis engine with no external runtime dependencies.
 */

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
export {
  createNodeHost,
  createNodeHostForWorkspace,
  resolveWasmDirForWorkspace,
} from './host';

// ── Re-exports: paths ────────────────────────────────────────

export { toPosix, makeRelativePath } from './paths';

// ── Re-exports: classifiers ──────────────────────────────────

export { classifyFile, isStructuralAppFile, isConfigOrToolingFile } from './classifiers';
export type { FileKind } from './classifiers';

// ── Re-exports: stats ────────────────────────────────────────

export { computeModelStats, deriveHubs } from './stats';
export type { ModelStats } from './stats';

// ── Re-exports: file system ──────────────────────────────────

export {
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
  createEmptyGrammarSummary,
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
} from './analysis/index';
export type {
  DependencyProgressCallback,
  DependencyWarningCallback,
  ImportStatement,
  CallSite,
  FileIndex,
  DependencyLanguageAdapter,
} from './analysis/index';

// ── Re-exports: repo-level analysis ──────────────────────────

export { analyzeRepo, analyzeRepoWithDependencies } from './analysis/repo';
