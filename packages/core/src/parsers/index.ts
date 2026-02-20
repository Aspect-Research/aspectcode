/**
 * Parser utilities — grammar loading and per-language extractors.
 */

// Grammar loader
export { loadGrammars } from './grammarLoader';
export type { LoadedGrammars, GrammarSummary, LogFn } from './grammarLoader';

// Language registry
export {
	createEmptyGrammarSummary,
} from './languages';
export type { LanguageSpec, GrammarLanguageId } from './languages';

// Shared utilities
export { textFor } from './utils';

// Python
export { extractPythonImports, extractPythonSymbols } from './pythonExtractors';

// TypeScript / JavaScript
export { extractTSJSImports, extractTSJSSymbols } from './tsJsExtractors';

// Java
export { extractJavaImports, extractJavaSymbols } from './javaExtractors';

// C#
export { extractCSharpImports, extractCSharpSymbols } from './csharpExtractors';
