/**
 * KB helpers barrel — re-exports all pure KB analysis functions.
 */

// Constants & limits
export { KB_SIZE_LIMITS, KB_SECTION_LIMITS, KB_ENRICHING_RULES } from './constants';

// Core helpers
export { enforceLineBudget, makeRelativePath, dedupe, dedupeFindings } from './helpers';
export type { KBEnrichingFinding } from './helpers';

// File classification
export { classifyFile, isStructuralAppFile, isConfigOrToolingFile } from './classifiers';
export type { FileKind } from './classifiers';

// Pattern detectors
export {
  detectDataModelsLocally,
  detectExternalIntegrationsLocally,
  detectGlobalStateLocally,
  getKBEnrichments,
} from './detectors';
export type { EnrichmentRuleType } from './detectors';

// Entry-point detection
export { detectEntryPointsWithContent, detectEntryPointsByName } from './entryPoints';
export type { DetectedEntryPoint } from './entryPoints';

// Graph analysis
export {
  calculateCentralityScores,
  groupEndpointsByModule,
  buildEntryPointFlows,
  detectLayerFlows,
  findDependencyChains,
  findModuleClusters,
  analyzeDirStructure,
  inferDirPurpose,
  getSymbolCallers,
} from './analyzers';
export type { ModuleCluster, DirInfo } from './analyzers';

// Convention analysis
export {
  analyzeFileNaming,
  analyzeFunctionNaming,
  analyzeClassNaming,
  analyzeImportPatterns,
  analyzeTestNaming,
  analyzeTestOrganization,
  detectFrameworkPatterns,
  getFixTemplate,
} from './conventions';

// Symbol extraction
export { extractModelSignature, extractFileSymbolsWithSignatures } from './symbols';
export type { LoadedGrammars, SymbolExtractor, SymbolExtractors } from './symbols';

// Dependency stats
export { buildDepStats } from './depData';

// ── KB file emitters (pure content builders) ─────────────────

export { buildArchitectureContent } from './architectureEmitter';
export type { ArchitectureEmitterInput } from './architectureEmitter';

export { buildMapContent } from './mapEmitter';
export type { MapEmitterInput } from './mapEmitter';

export { buildContextContent } from './contextEmitter';
export type { ContextEmitterInput } from './contextEmitter';

// ── KB orchestrator ──────────────────────────────────────────

export { createKBEmitter } from './kbEmitter';
export type { KBEmitterOptions } from './kbEmitter';
