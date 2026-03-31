/**
 * Language registry for parser/grammar support.
 *
 * This is the single source of truth for grammar ids, wasm filenames,
 * and extension coverage used by core and extension integration points.
 */

export interface LanguageSpec {
  id: string;
  grammarFile: string;
  extensions: readonly string[];
}

export const LANGUAGE_SPECS = [
  {
    id: 'python',
    grammarFile: 'python.wasm',
    extensions: ['.py'],
  },
  {
    id: 'typescript',
    grammarFile: 'typescript.wasm',
    extensions: ['.ts'],
  },
  {
    id: 'tsx',
    grammarFile: 'tsx.wasm',
    extensions: ['.tsx'],
  },
  {
    id: 'javascript',
    grammarFile: 'javascript.wasm',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  },
  {
    id: 'java',
    grammarFile: 'java.wasm',
    extensions: ['.java'],
  },
  {
    id: 'csharp',
    grammarFile: 'c_sharp.wasm',
    extensions: ['.cs'],
  },
  {
    id: 'go',
    grammarFile: 'go.wasm',
    extensions: ['.go'],
  },
  {
    id: 'rust',
    grammarFile: 'rust.wasm',
    extensions: ['.rs'],
  },
  {
    id: 'ruby',
    grammarFile: 'ruby.wasm',
    extensions: ['.rb'],
  },
  {
    id: 'php',
    grammarFile: 'php.wasm',
    extensions: ['.php'],
  },
  {
    id: 'cpp',
    grammarFile: 'cpp.wasm',
    extensions: ['.c', '.cpp', '.h', '.hpp'],
  },
] as const satisfies readonly LanguageSpec[];

export type GrammarLanguageId = (typeof LANGUAGE_SPECS)[number]['id'];

export type GrammarSummary = Record<GrammarLanguageId, boolean> & {
  initFailed: boolean;
};

export function createEmptyGrammarSummary(): GrammarSummary {
  const summary = Object.fromEntries(
    LANGUAGE_SPECS.map((spec) => [spec.id, false]),
  ) as Record<GrammarLanguageId, boolean>;

  return {
    ...summary,
    initFailed: false,
  };
}

export function getGrammarFileMap(): Record<GrammarLanguageId, string> {
  return Object.fromEntries(
    LANGUAGE_SPECS.map((spec) => [spec.id, spec.grammarFile]),
  ) as Record<GrammarLanguageId, string>;
}

export function getSupportedSourceExtensions(): string[] {
  const merged = new Set<string>();
  for (const spec of LANGUAGE_SPECS) {
    for (const ext of spec.extensions) {
      merged.add(ext);
    }
  }
  return Array.from(merged);
}
