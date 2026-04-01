/**
 * Repository-level analysis — the top-level pipeline that builds an
 * AnalysisModel from a set of workspace files.
 *
 * Extracted from index.ts to keep the barrel file lean.
 */

import * as path from 'path';
import type Parser from 'web-tree-sitter';
import type { AnalysisModel, AnalyzedFile, ExtractedSymbol, FileSymbols } from '../model';
import { toPosix } from '../paths';
import { deriveHubs } from '../stats';
import { DependencyAnalyzer } from './index';
import { createNodeHostForWorkspace, type CoreHost } from '../host';
import { LANGUAGE_SPECS, type GrammarLanguageId } from '../parsers/languages';
import type { LoadedGrammars } from '../parsers/grammarLoader';
import { loadGrammars } from '../parsers/grammarLoader';
import { extractPythonImports, extractPythonSymbols } from '../parsers/pythonExtractors';
import { extractTSJSImports, extractTSJSSymbols } from '../parsers/tsJsExtractors';
import { extractJavaImports, extractJavaSymbols } from '../parsers/javaExtractors';
import { extractCSharpImports, extractCSharpSymbols } from '../parsers/csharpExtractors';
import { extractGenericImports, extractGenericSymbols, GENERIC_LANGUAGE_IDS } from '../parsers/genericExtractors';
import { setDependencyAdapterGrammars } from './dependencyAdapters';

// ── Language dispatch tables ─────────────────────────────────

/** Map file extension → grammar language id (built from LANGUAGE_SPECS SSOT). */
const extToLanguageId = new Map<string, GrammarLanguageId>();
for (const spec of LANGUAGE_SPECS) {
  for (const ext of spec.extensions) {
    extToLanguageId.set(ext, spec.id);
  }
}

/** Collapse grammar ids to model-level display names (tsx → typescript). */
const LANGUAGE_DISPLAY: Partial<Record<GrammarLanguageId, string>> = {
  tsx: 'typescript',
};

type ImportExtractorFn = (lang: Parser.Language, code: string) => string[];
type SymbolExtractorFn = (lang: Parser.Language, code: string) => ExtractedSymbol[];

const IMPORT_EXTRACTORS: Partial<Record<GrammarLanguageId, ImportExtractorFn>> = {
  python: extractPythonImports,
  typescript: extractTSJSImports,
  tsx: extractTSJSImports,
  javascript: extractTSJSImports,
  java: extractJavaImports,
  csharp: extractCSharpImports,
  // Generic extractors — curried with language id
  ...Object.fromEntries(
    GENERIC_LANGUAGE_IDS.map((id) => [id, (lang: Parser.Language, code: string) => extractGenericImports(id, lang, code)]),
  ),
};

const SYMBOL_EXTRACTORS: Partial<Record<GrammarLanguageId, SymbolExtractorFn>> = {
  python: extractPythonSymbols,
  typescript: extractTSJSSymbols,
  tsx: extractTSJSSymbols,
  javascript: extractTSJSSymbols,
  java: extractJavaSymbols,
  csharp: extractCSharpSymbols,
  // Generic extractors — curried with language id
  ...Object.fromEntries(
    GENERIC_LANGUAGE_IDS.map((id) => [id, (lang: Parser.Language, code: string) => extractGenericSymbols(id, lang, code)]),
  ),
};

// ── analyzeRepo ──────────────────────────────────────────────

/**
 * Analyze a set of files and produce a serializable AnalysisModel.
 *
 * When `grammars` are provided, uses tree-sitter extractors for
 * precise import/symbol extraction; otherwise falls back to regex.
 *
 * @param rootDir   Absolute path to the workspace root
 * @param files     Map of relative-path → file content
 * @param grammars  Optional pre-loaded tree-sitter grammars
 */
export function analyzeRepo(
  rootDir: string,
  files: Map<string, string>,
  grammars?: LoadedGrammars,
): AnalysisModel {
  const analyzedFiles: AnalyzedFile[] = [];
  const allSymbols: FileSymbols[] = [];

  for (const [relativePath, content] of files) {
    const ext = path.extname(relativePath).toLowerCase();
    const langId = extToLanguageId.get(ext);
    const language = langId ? (LANGUAGE_DISPLAY[langId] ?? langId) : 'unknown';
    const lineCount = content.split('\n').length;
    const posixPath = toPosix(relativePath);

    let exports: string[];
    let imports: string[];
    let symbols: ExtractedSymbol[] | undefined;

    const grammar = langId && grammars ? grammars[langId] : undefined;

    if (grammar) {
      // ── Tree-sitter extraction path ──
      const extractImports = IMPORT_EXTRACTORS[langId!];
      const extractSymbols = SYMBOL_EXTRACTORS[langId!];

      if (extractImports) {
        try {
          imports = [...new Set(extractImports(grammar, content))];
        } catch {
          imports = extractImportModulesRegex(content, language);
        }
      } else {
        imports = extractImportModulesRegex(content, language);
      }

      if (extractSymbols) {
        try {
          symbols = extractSymbols(grammar, content);
          exports = symbols.filter((s) => s.exported).map((s) => s.name);
        } catch {
          exports = extractExportNamesRegex(content, language);
        }
      } else {
        exports = extractExportNamesRegex(content, language);
      }
    } else {
      // ── Regex fallback path ──
      exports = extractExportNamesRegex(content, language);
      imports = extractImportModulesRegex(content, language);
    }

    analyzedFiles.push({ relativePath: posixPath, language, lineCount, exports, imports });

    if (symbols && symbols.length > 0) {
      allSymbols.push({ file: posixPath, symbols });
    }
  }

  return {
    schemaVersion: '0.1',
    generatedAt: new Date().toISOString(),
    repo: { root: rootDir },
    files: analyzedFiles,
    symbols: allSymbols,
    graph: { nodes: [], edges: [] },
    metrics: { hubs: [] },
  };
}

/**
 * Analyze repository files and enrich the model with dependency links and hubs.
 *
 * Loads tree-sitter grammars (when available) for precise extraction
 * and pre-seeds the dependency adapter layer to avoid double-loading.
 *
 * @param rootDir            Absolute path to the workspace root
 * @param relativeFiles      Map of relative-path → file content
 * @param absoluteFiles      Map of absolute-path → file content (for dependency analysis)
 * @param host               Optional CoreHost for file I/O and WASM paths
 */
export async function analyzeRepoWithDependencies(
  rootDir: string,
  relativeFiles: Map<string, string>,
  absoluteFiles: Map<string, string>,
  host?: CoreHost,
): Promise<AnalysisModel> {
  const resolvedHost = host ?? createNodeHostForWorkspace(rootDir);

  // Load grammars once for both analyzeRepo() and DependencyAnalyzer
  let grammars: LoadedGrammars = {};
  if (resolvedHost?.wasmPaths?.treeSitter && Object.keys(resolvedHost.wasmPaths.grammars ?? {}).length > 0) {
    try {
      const loaded = await loadGrammars(resolvedHost);
      grammars = loaded.grammars;
    } catch {
      // Fall back to regex extraction
    }
  }

  const model = analyzeRepo(rootDir, relativeFiles, grammars);

  if (absoluteFiles.size === 0) {
    return model;
  }

  // Pre-seed adapters so DependencyAnalyzer skips redundant grammar loading
  setDependencyAdapterGrammars(grammars);

  const analyzer = new DependencyAnalyzer();
  analyzer.setFileContentsCache(absoluteFiles);
  const absolutePaths = Array.from(absoluteFiles.keys());
  const absoluteEdges = await analyzer.analyzeDependencies(absolutePaths, resolvedHost);

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
  model.metrics = { hubs: deriveHubs(edges) };

  return model;
}

// ── Internal helpers ─────────────────────────────────────────

/** Regex-based export extraction — fallback when grammars unavailable. */
function extractExportNamesRegex(content: string, language: string): string[] {
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

/** Regex-based import extraction — fallback when grammars unavailable. */
function extractImportModulesRegex(content: string, language: string): string[] {
  const modules: string[] = [];
  if (language === 'typescript' || language === 'javascript') {
    // ES imports: import ... from '...'
    const esRe = /from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = esRe.exec(content)) !== null) {
      modules.push(m[1]);
    }
    // CommonJS: require('...')
    const cjsRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = cjsRe.exec(content)) !== null) {
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
