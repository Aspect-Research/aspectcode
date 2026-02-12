/**
 * KB line budgets and per-section item caps.
 *
 * These keep generated files within AI context-window budgets.
 */

/** Maximum line counts for each KB file. */
export const KB_SIZE_LIMITS = {
  architecture: 200,
  map: 300,
  context: 200,
} as const;

/** Maximum items per section to prevent runaway lists. */
export const KB_SECTION_LIMITS = {
  hubs: 12,
  hubDetails: 3,
  entryPoints: 10,
  directories: 12,
  dataModels: 15,
  symbolsPerFile: 10,
  filesInSymbolIndex: 30,
  clusters: 6,
  chains: 8,
  integrations: 4,
} as const;

/** KB-enriching rule IDs. */
export const KB_ENRICHING_RULES = {
  ENTRY_POINT: 'arch.entry_point',
  EXTERNAL_INTEGRATION: 'arch.external_integration',
  DATA_MODEL: 'arch.data_model',
  GLOBAL_STATE: 'arch.global_state_usage',
  IMPORT_CYCLE: 'imports.cycle.advanced',
  CRITICAL_DEPENDENCY: 'architecture.critical_dependency',
  CHANGE_IMPACT: 'analysis.change_impact',
} as const;
