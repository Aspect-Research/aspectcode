/**
 * File classifiers — categorize files as app / test / third-party.
 *
 * Used by KB emitters and the CLI to focus on project code and filter out
 * virtual-env, node_modules, build artifacts, and test files.
 *
 * All functions are pure (no I/O, no vscode).
 */

import { toPosix, makeRelativePath } from './paths';

// ── Types ────────────────────────────────────────────────────

export type FileKind = 'app' | 'test' | 'third_party';

// ── Third-party patterns ─────────────────────────────────────

const THIRD_PARTY_PATTERNS = [
  '/.venv/', '/venv/', '/env/', '/.tox/', '/site-packages/',
  '/node_modules/', '/__pycache__/', '/.pytest_cache/', '/.mypy_cache/',
  '/dist/', '/build/', '/.next/', '/.turbo/', '/coverage/',
  '/.cache/', '/dist-packages/', '/.git/', '/.hg/', '/.wrangler/',
];

const THIRD_PARTY_PREFIXES = [
  '.venv/', 'venv/', 'env/', '.tox/', 'site-packages/',
  'node_modules/', '__pycache__/', '.pytest_cache/', '.mypy_cache/',
  'dist/', 'build/', '.next/', '.turbo/', 'coverage/',
  '.cache/', 'dist-packages/', '.git/', '.hg/', '.wrangler/',
];

// ── Public API ───────────────────────────────────────────────

/**
 * Classify a file as app code, test code, or third-party/environment.
 */
export function classifyFile(absPathOrRel: string, workspaceRoot: string): FileKind {
  const rel = makeRelativePath(absPathOrRel, workspaceRoot).toLowerCase();

  if (
    THIRD_PARTY_PATTERNS.some((p) => rel.includes(p)) ||
    THIRD_PARTY_PREFIXES.some((p) => rel.startsWith(p))
  ) {
    return 'third_party';
  }

  const parts = rel.split('/');
  const filename = parts[parts.length - 1] || '';
  if (
    parts.some((p) => p === 'test' || p === 'tests' || p === 'spec' || p === '__tests__') ||
    filename.startsWith('test_') ||
    filename.endsWith('_test.py') ||
    filename.endsWith('.test.ts') ||
    filename.endsWith('.test.tsx') ||
    filename.endsWith('.test.js') ||
    filename.endsWith('.test.jsx') ||
    filename.endsWith('.spec.ts') ||
    filename.endsWith('.spec.tsx') ||
    filename.endsWith('.spec.js') ||
    filename.endsWith('.spec.jsx') ||
    filename.includes('.spec.') ||
    filename.includes('.test.')
  ) {
    return 'test';
  }

  return 'app';
}

/**
 * Check if a file is "structural app code" — runtime/domain modules,
 * not migrations, hooks, or generated tooling.
 */
export function isStructuralAppFile(file: string, workspaceRoot: string): boolean {
  if (classifyFile(file, workspaceRoot) !== 'app') return false;

  const rel = makeRelativePath(file, workspaceRoot).toLowerCase();

  if (rel.includes('/alembic/') || rel.includes('/migrations/')) return false;
  if (rel.includes('/hooks/')) return false;

  const basename = toPosix(rel).split('/').pop() || '';
  if (
    basename === 'playwright.config.ts' ||
    basename === 'openapi-ts.config.ts' ||
    basename === 'vite.config.ts' ||
    basename === 'vitest.config.ts' ||
    basename === 'jest.config.ts' ||
    basename === 'jest.config.js' ||
    basename.endsWith('.gen.ts') ||
    basename.endsWith('.gen.js') ||
    basename.endsWith('.gen.tsx') ||
    basename.endsWith('.gen.jsx') ||
    basename.endsWith('sdk.gen.ts') ||
    basename.endsWith('types.gen.ts')
  ) {
    return false;
  }

  return true;
}

/**
 * Check if a file is a config/tooling file (not runtime code).
 * Used to filter configs from feature clusters and categorize entry points.
 */
export function isConfigOrToolingFile(filePath: string): boolean {
  const pathLower = filePath.toLowerCase();
  const parts = toPosix(filePath).split('/');
  const fullBasename = parts[parts.length - 1] || '';
  const dotIdx = fullBasename.lastIndexOf('.');
  const baseName = (dotIdx > 0 ? fullBasename.substring(0, dotIdx) : fullBasename).toLowerCase();

  return (
    pathLower.includes('config') ||
    pathLower.includes('.config') ||
    baseName.includes('jest') ||
    baseName.includes('webpack') ||
    baseName.includes('vite') ||
    baseName.includes('tailwind') ||
    baseName.includes('eslint') ||
    baseName.includes('prettier') ||
    baseName.includes('tsconfig') ||
    baseName.includes('babel') ||
    baseName.includes('postcss') ||
    baseName.includes('rollup') ||
    baseName.startsWith('next.') ||
    baseName.startsWith('vitest.') ||
    baseName === 'package' ||
    baseName === 'package-lock' ||
    baseName === 'tsconfig' ||
    baseName === 'jsconfig' ||
    pathLower.endsWith('.config.js') ||
    pathLower.endsWith('.config.ts') ||
    pathLower.endsWith('.config.mjs') ||
    pathLower.endsWith('.config.cjs')
  );
}
