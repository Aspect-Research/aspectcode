/**
 * Analysis module — dependency analysis with no vscode coupling.
 */

// Import parsers (types only — functions are internal)
export type { ImportStatement, CallSite } from './importParsers';

// Module resolver (types only — functions are internal)
export type { FileIndex } from './moduleResolver';

// Analyzer
export type { DependencyProgressCallback, DependencyWarningCallback } from './analyzer';
export { DependencyAnalyzer } from './analyzer';

// Dependency adapter registry (types only — functions are internal)
export type { DependencyLanguageAdapter } from './dependencyAdapters';
