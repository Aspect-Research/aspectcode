/**
 * Default directory exclusion lists for file discovery.
 *
 * These lists are the single source of truth — both the extension's
 * FileDiscoveryService and DirectoryExclusion import from here instead
 * of maintaining duplicate arrays.
 */

// ── Exclusion categories ─────────────────────────────────────

export const PACKAGE_MANAGER_DIRS: readonly string[] = [
  'node_modules',
  'bower_components',
  'jspm_packages',
  'vendor',
  'packages',
  'site-packages',
  'dist-packages',
  'eggs',
  '.eggs',
];

export const BUILD_OUTPUT_DIRS: readonly string[] = [
  'dist',
  'build',
  'out',
  'output',
  'target',
  'bin',
  'obj',
  'lib',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.parcel-cache',
  '.webpack',
  '.rollup.cache',
];

export const VENV_DIRS: readonly string[] = [
  'venv',
  '.venv',
  'env',
  '.env',
  'virtualenv',
  '.virtualenv',
  '.tox',
  '.nox',
  '.conda',
];

export const CACHE_DIRS: readonly string[] = [
  '__pycache__',
  '.cache',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.hypothesis',
  'coverage',
  'htmlcov',
  '.nyc_output',
  '.coverage',
];

export const VCS_IDE_DIRS: readonly string[] = [
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vs',
  '.vscode',
];

export const TEST_OUTPUT_DIRS: readonly string[] = [
  'e2e',
  'playwright-report',
  'test-results',
  'cypress',
  '.playwright',
];

export const GENERATED_DIRS: readonly string[] = [
  'generated',
  '__generated__',
  '.serverless',
  '.terraform',
  '.pulumi',
];

/** Marker files that indicate a venv directory (even if name is unusual) */
export const VENV_MARKERS: readonly string[] = [
  'pyvenv.cfg',
  'pip-selfcheck.json',
];

/** Marker files that indicate a build output directory */
export const BUILD_OUTPUT_MARKERS: readonly string[] = [
  '.tsbuildinfo',
  '.buildinfo',
];

// ── Merged defaults ──────────────────────────────────────────

/** All default directory exclusions, merged and deduplicated. */
export const DEFAULT_EXCLUSIONS: readonly string[] = [
  ...PACKAGE_MANAGER_DIRS,
  ...BUILD_OUTPUT_DIRS,
  ...VENV_DIRS,
  ...CACHE_DIRS,
  ...VCS_IDE_DIRS,
  ...TEST_OUTPUT_DIRS,
  ...GENERATED_DIRS,
];

// ── Supported file extensions ────────────────────────────────

/**
 * File extensions that the analysis engine processes.
 * Must include the leading dot.
 */
export const SUPPORTED_EXTENSIONS: readonly string[] = [
  '.py',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.java',
  '.cpp',
  '.c',
  '.hpp',
  '.h',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
];
