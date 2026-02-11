/**
 * @aspectcode/core — public API surface
 *
 * This package contains pure-logic code with ZERO dependency on the `vscode`
 * module. Everything here must be usable from a CLI, a test harness, or the
 * VS Code extension equally.
 *
 * Phase 0: skeleton only. Code will be incrementally moved here from
 * extension/src/services/ and extension/src/assistants/ in later phases.
 */

// ── Types ────────────────────────────────────────────────────

/** A dependency link between two files */
export interface DependencyLink {
  source: string;
  target: string;
  type: 'import' | 'export' | 'call' | 'inherit' | 'circular';
  strength: number;
  symbols: string[];
  lines: number[];
  bidirectional: boolean;
}

/** A single file in the analyzed workspace */
export interface AnalyzedFile {
  /** Workspace-relative path (forward-slash separated) */
  relativePath: string;
  /** Detected language */
  language: string;
  /** Line count */
  lineCount: number;
  /** Exported symbols (functions, classes, types) */
  exports: string[];
  /** Imported modules */
  imports: string[];
}

/** The full analysis model for a workspace / repo */
export interface RepoModel {
  /** ISO-8601 timestamp of when the model was generated */
  generatedAt: string;
  /** Root-relative file list */
  files: AnalyzedFile[];
  /** Dependency graph edges */
  dependencies: DependencyLink[];
  /** Summary statistics */
  stats: {
    totalFiles: number;
    totalLines: number;
    languages: Record<string, number>;
  };
}

// ── Placeholder implementation ───────────────────────────────

/**
 * Analyze a set of files and produce a serializable RepoModel.
 *
 * Today this is a stub. As code moves from the extension into core,
 * this function will grow to cover import extraction, dependency
 * analysis, and symbol discovery — all without touching `vscode`.
 *
 * @param rootDir  Absolute path to the workspace root
 * @param files    Map of relative-path → file content
 */
export function analyzeRepo(
  _rootDir: string,
  files: Map<string, string>,
): RepoModel {
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

    analyzedFiles.push({
      relativePath,
      language,
      lineCount,
      exports,
      imports,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    files: analyzedFiles,
    dependencies: [], // Phase 1: wire up dependency resolution
    stats: {
      totalFiles: analyzedFiles.length,
      totalLines,
      languages: languageCounts,
    },
  };
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
  };
  return map[ext] ?? 'unknown';
}

/** Naive export extraction — good enough for snapshot tests */
function extractExportNames(content: string, language: string): string[] {
  const names: string[] = [];
  if (language === 'typescript' || language === 'javascript') {
    const re = /export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      names.push(m[1]);
    }
  } else if (language === 'python') {
    // Top-level def/class are implicitly exported
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
