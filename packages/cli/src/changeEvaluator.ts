/**
 * Change evaluator — real-time assessment of file changes against the
 * current AnalysisModel and learned preferences.
 *
 * All checks are pure functions. No LLM calls, no file reads beyond
 * what's already in RuntimeState, no tree-sitter. Fast enough to run
 * on every file save.
 */

import * as path from 'path';
import type { AnalysisModel } from '@aspectcode/core';
import type { PreferencesStore } from './preferences';
import { findMatchingPreference, bumpPreferenceHit } from './preferences';

// ── Types ────────────────────────────────────────────────────

export interface TimestampedChange {
  type: 'add' | 'change' | 'unlink';
  path: string;
  timestamp: number;
}

export interface ChangeAssessment {
  file: string;
  type: 'ok' | 'warning' | 'violation';
  rule: string;
  message: string;
  details?: string;
  suggestion?: string;
  dependencyContext?: string;
  dismissable: boolean;
  /** LLM auto-resolve recommendation (attached when auto-resolve is active). */
  llmRecommendation?: {
    decision: 'allow' | 'deny';
    confidence: number;
    reasoning: string;
  };
}

export interface ChangeContext {
  model: AnalysisModel;
  agentsContent: string;
  preferences: PreferencesStore;
  recentChanges: TimestampedChange[];
  fileContents?: ReadonlyMap<string, string>;
  /** Hub inDegree counts from previous analysis (for new-hub detection). */
  previousHubCounts?: ReadonlyMap<string, number>;
}

// ── Burst tracker ────────────────────────────────────────────

const BURST_WINDOW_MS = 60_000;
const recentChanges: TimestampedChange[] = [];

export function trackChange(event: { type: string; path: string }): void {
  recentChanges.push({
    type: event.type as TimestampedChange['type'],
    path: event.path,
    timestamp: Date.now(),
  });
  const cutoff = Date.now() - BURST_WINDOW_MS;
  while (recentChanges.length > 0 && recentChanges[0].timestamp < cutoff) {
    recentChanges.shift();
  }
}

export function getRecentChanges(): TimestampedChange[] {
  const cutoff = Date.now() - BURST_WINDOW_MS;
  while (recentChanges.length > 0 && recentChanges[0].timestamp < cutoff) {
    recentChanges.shift();
  }
  return [...recentChanges];
}

export function clearRecentChanges(): void {
  recentChanges.length = 0;
}

// ── Main evaluator ───────────────────────────────────────────

export function evaluateChange(
  event: { type: string; path: string },
  ctx: ChangeContext,
): ChangeAssessment[] {
  const assessments: ChangeAssessment[] = [];

  // Deleted files don't need convention/naming checks
  if (event.type !== 'unlink') {
    assessments.push(...checkCoChange(event.path, ctx));

    if (event.type === 'add') {
      assessments.push(...checkDirectoryConvention(event.path, ctx));
      assessments.push(...checkNamingConvention(event.path, ctx));
    }

    if (event.type === 'change') {
      assessments.push(...checkImportPattern(event.path, ctx));
      assessments.push(...checkExportContract(event.path, ctx));
      assessments.push(...checkCircularDependency(event.path, ctx));
      assessments.push(...checkTestCoverageGap(event.path, ctx));
      assessments.push(...checkFileSize(event.path, ctx));
      assessments.push(...checkNewHub(event.path, ctx));
      assessments.push(...checkCrossBoundary(event.path, ctx));
      assessments.push(...checkStaleImport(event.path, ctx));
      assessments.push(...checkInheritanceChange(event.path, ctx));
    }
  }

  // Apply preference overrides
  return applyPreferences(assessments, ctx.preferences);
}

// ── Check 1: Co-change detection ─────────────────────────────

function checkCoChange(file: string, ctx: ChangeContext): ChangeAssessment[] {
  // Find all files that depend on this file (import from it), weighted by strength
  const dependents: { file: string; strength: number }[] = [];
  for (const edge of ctx.model.graph.edges) {
    if (edge.type === 'import' || edge.type === 'call') {
      if (edge.target === file && edge.source !== file) {
        dependents.push({ file: edge.source, strength: edge.strength });
      }
      if (edge.bidirectional && edge.source === file && edge.target !== file) {
        dependents.push({ file: edge.target, strength: edge.strength });
      }
    }
  }

  // Need at least 2 dependents to be meaningful
  if (dependents.length < 2) return [];

  const strongDependents = dependents.filter((d) => d.strength >= 0.5);
  if (strongDependents.length === 0) return [];

  // Check which dependents have been changed recently
  const recentPaths = new Set(ctx.recentChanges.map((c) => c.path));
  const updatedStrong = strongDependents.filter((d) => recentPaths.has(d.file));
  const missingStrong = strongDependents.filter((d) => !recentPaths.has(d.file));

  const depCtx = `${strongDependents.length} strong dependents, ${updatedStrong.length} updated` +
    (missingStrong.length > 0 ? `, ${missingStrong.length} missing: [${missingStrong.map((d) => d.file).join(', ')}]` : '');

  if (missingStrong.length === 0) {
    return [{
      file,
      type: 'ok',
      rule: 'co-change',
      message: `All ${dependents.length} dependents updated`,
      dependencyContext: depCtx,
      dismissable: false,
    }];
  }

  const shown = missingStrong.slice(0, 3).map((d) => d.file);
  const moreCount = missingStrong.length - shown.length;
  const fileList = shown.join(', ') + (moreCount > 0 ? `, +${moreCount} more` : '');

  return [{
    file,
    type: 'warning',
    rule: 'co-change',
    message: `${dependents.length} dependents, ${updatedStrong.length} of ${strongDependents.length} strong dependents updated`,
    details: `Not yet updated: ${fileList}`,
    suggestion: `You modified ${file} which has ${strongDependents.length} strong dependents. Please verify and update: ${missingStrong.map((d) => d.file).join(', ')}`,
    dependencyContext: depCtx,
    dismissable: true,
  }];
}

// ── Check 2: Directory convention ────────────────────────────

function checkDirectoryConvention(file: string, ctx: ChangeContext): ChangeAssessment[] {
  const dir = path.dirname(file);
  if (dir === '.') return []; // root-level file, no convention to check

  // Check if this directory already has files in the model
  const existingInDir = ctx.model.files.filter(
    (f) => path.dirname(f.relativePath) === dir,
  );
  if (existingInDir.length > 0) return []; // known directory

  // New directory — check if the file type matches where similar files live
  const basename = path.basename(file).toLowerCase();
  const assessments: ChangeAssessment[] = [];

  // Check test file placement
  if (isTestFile(basename)) {
    const testDirs = findDirsMatching(ctx.model, isTestFile);
    if (testDirs.length > 0 && !testDirs.includes(dir)) {
      assessments.push({
        file,
        type: 'warning',
        rule: 'directory-convention',
        message: `Test file in unexpected directory`,
        details: `Tests usually live in: ${testDirs.slice(0, 3).join(', ')}`,
        suggestion: `This test file was created in ${dir}/ but existing tests are in ${testDirs[0]}/. Consider moving it.`,
        dismissable: true,
      });
    }
  }

  // Check route/controller/api file placement
  if (isRouteFile(basename)) {
    const routeDirs = findDirsMatching(ctx.model, isRouteFile);
    if (routeDirs.length > 0 && !routeDirs.includes(dir)) {
      assessments.push({
        file,
        type: 'warning',
        rule: 'directory-convention',
        message: `Route/API file in unexpected directory`,
        details: `Route files usually live in: ${routeDirs.slice(0, 3).join(', ')}`,
        suggestion: `This route file was created in ${dir}/ but existing routes are in ${routeDirs[0]}/. Consider moving it.`,
        dismissable: true,
      });
    }
  }

  return assessments;
}

function isTestFile(name: string): boolean {
  return /\.(test|spec)\.[^.]+$/.test(name) || /^test_/.test(name) || /_test\.[^.]+$/.test(name);
}

function isRouteFile(name: string): boolean {
  return /route|controller|endpoint|handler|api/i.test(name);
}

/** Find directories that contain files matching a predicate. */
function findDirsMatching(
  model: AnalysisModel,
  predicate: (basename: string) => boolean,
): string[] {
  const dirs = new Map<string, number>();
  for (const f of model.files) {
    if (predicate(path.basename(f.relativePath).toLowerCase())) {
      const d = path.dirname(f.relativePath);
      dirs.set(d, (dirs.get(d) ?? 0) + 1);
    }
  }
  // Sort by count descending
  return [...dirs.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d);
}

// ── Check 3: Naming convention ───────────────────────────────

function checkNamingConvention(file: string, ctx: ChangeContext): ChangeAssessment[] {
  const dir = path.dirname(file);
  const basename = path.basename(file);
  const nameOnly = basename.replace(/\.[^.]+$/, ''); // strip extension

  // Find siblings in the same directory
  const siblings = ctx.model.files
    .filter((f) => path.dirname(f.relativePath) === dir)
    .map((f) => path.basename(f.relativePath).replace(/\.[^.]+$/, ''));

  if (siblings.length < 2) return []; // not enough data to detect a pattern

  const dominant = detectNamingPattern(siblings);
  if (!dominant) return [];

  const filePattern = classifyName(nameOnly);
  if (!filePattern || filePattern === dominant) return [];

  return [{
    file,
    type: 'warning',
    rule: 'naming-convention',
    message: `Naming doesn't match directory convention`,
    details: `"${basename}" is ${filePattern} but ${dir}/ uses ${dominant}`,
    dismissable: true,
  }];
}

type NamingPattern = 'camelCase' | 'PascalCase' | 'snake_case' | 'kebab-case';

function classifyName(name: string): NamingPattern | null {
  if (/^[a-z][a-zA-Z0-9]*$/.test(name) && /[A-Z]/.test(name)) return 'camelCase';
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) return 'PascalCase';
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(name)) return 'snake_case';
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(name)) return 'kebab-case';
  return null;
}

function detectNamingPattern(names: string[]): NamingPattern | null {
  const counts: Record<string, number> = {};
  for (const name of names) {
    const pattern = classifyName(name);
    if (pattern) counts[pattern] = (counts[pattern] ?? 0) + 1;
  }

  const entries = Object.entries(counts);
  if (entries.length === 0) return null;

  entries.sort((a, b) => b[1] - a[1]);
  const [topPattern, topCount] = entries[0];

  // Require >50% dominance
  const total = entries.reduce((sum, [, c]) => sum + c, 0);
  if (topCount / total <= 0.5) return null;

  return topPattern as NamingPattern;
}

// ── Check 4: Import pattern ──────────────────────────────────

function checkImportPattern(file: string, ctx: ChangeContext): ChangeAssessment[] {
  if (!ctx.fileContents) return [];

  const content = ctx.fileContents.get(file);
  if (!content) return [];

  // Simple regex-based import extraction
  const currentImports = extractImports(content);
  const hubFiles = new Set(ctx.model.metrics.hubs.map((h) => h.file));

  // Get previous imports from the model
  const modelFile = ctx.model.files.find((f) => f.relativePath === file);
  const previousImports = new Set(modelFile?.imports ?? []);

  const assessments: ChangeAssessment[] = [];

  for (const imp of currentImports) {
    if (previousImports.has(imp)) continue; // not new

    // Resolve relative imports to check against hub paths
    const resolved = resolveRelativeImport(file, imp);
    if (resolved && hubFiles.has(resolved)) {
      const hub = ctx.model.metrics.hubs.find((h) => h.file === resolved);
      assessments.push({
        file,
        type: 'warning',
        rule: 'import-hub',
        message: `New import from high-risk hub`,
        details: `${resolved} (${hub?.inDegree ?? 0} dependents)`,
        dismissable: true,
      });
    }
  }

  return assessments;
}

const IMPORT_PATTERNS = [
  /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,     // ES import
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,         // CommonJS
  /from\s+(\S+)\s+import/g,                         // Python
  /^import\s+(\S+)/gm,                              // Python bare import
];

function extractImports(content: string): string[] {
  const imports = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      imports.add(match[1]);
    }
  }
  return [...imports];
}

function resolveRelativeImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const dir = path.dirname(fromFile);
  let resolved = path.posix.join(dir, specifier);
  // Try common extensions
  for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '.py', '/index.ts', '/index.js']) {
    const candidate = resolved + ext;
    if (candidate === resolved && !resolved.includes('.')) continue;
    // We can't check if file exists, but return the posix-normalized path
    if (ext === '' && resolved.includes('.')) return resolved;
  }
  // Return with .ts as best guess for relative imports
  if (!resolved.includes('.')) {
    return resolved + '.ts';
  }
  return resolved;
}

// ── Check 5: Export contract breakage ─────────────────────────

export function extractExportNames(content: string, _language: string): string[] {
  const exports = new Set<string>();

  // export function/class/const/let/var/type/interface/enum Name
  const namedRe = /export\s+(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = namedRe.exec(content)) !== null) exports.add(m[1]);

  // export { A, B, C }
  const braceRe = /export\s*\{([^}]+)\}/g;
  while ((m = braceRe.exec(content)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) exports.add(name);
    }
  }

  // export default function/class Name
  const defaultRe = /export\s+default\s+(?:function|class)\s+(\w+)/g;
  while ((m = defaultRe.exec(content)) !== null) exports.add(m[1]);

  return [...exports];
}

function checkExportContract(file: string, ctx: ChangeContext): ChangeAssessment[] {
  if (!ctx.fileContents) return [];
  const content = ctx.fileContents.get(file);
  if (!content) return [];

  const modelFile = ctx.model.files.find((f) => f.relativePath === file);
  if (!modelFile) return [];

  const previousExports = new Set(modelFile.exports);
  if (previousExports.size === 0) return [];

  const currentExports = new Set(extractExportNames(content, modelFile.language));
  const removedExports = [...previousExports].filter((e) => !currentExports.has(e));
  if (removedExports.length === 0) return [];

  // Find consumers of removed exports
  const affectedConsumers = new Set<string>();
  for (const removed of removedExports) {
    for (const edge of ctx.model.graph.edges) {
      if (edge.target === file && edge.symbols?.includes(removed)) {
        affectedConsumers.add(edge.source);
      }
    }
  }

  if (affectedConsumers.size === 0) return [];

  const consumers = [...affectedConsumers];
  const shown = consumers.slice(0, 3);
  const moreCount = consumers.length - shown.length;
  const consumerList = shown.join(', ') + (moreCount > 0 ? `, +${moreCount} more` : '');
  const depCtx = `Removed exports: [${removedExports.join(', ')}], ${consumers.length} affected consumers: [${consumers.join(', ')}]`;

  return [{
    file,
    type: 'warning',
    rule: 'export-contract',
    message: `Removed export${removedExports.length > 1 ? 's' : ''} ${removedExports.join(', ')} — ${consumers.length} consumer${consumers.length > 1 ? 's' : ''} may break`,
    details: `Affected: ${consumerList}`,
    suggestion: `Verify these files still compile: ${consumers.join(', ')}`,
    dependencyContext: depCtx,
    dismissable: true,
  }];
}

// ── Check 6: Circular dependency introduction ────────────────

export function hasPathInGraph(
  from: string,
  to: string,
  edges: { source: string; target: string }[],
  maxDepth = 20,
): string[] | null {
  const visited = new Set<string>();
  const queue: { node: string; path: string[] }[] = [{ node: from, path: [from] }];

  while (queue.length > 0) {
    const { node, path: currentPath } = queue.shift()!;
    if (currentPath.length > maxDepth) continue;
    if (node === to) return currentPath;

    for (const edge of edges) {
      if (edge.source === node && !visited.has(edge.target)) {
        visited.add(edge.target);
        queue.push({ node: edge.target, path: [...currentPath, edge.target] });
      }
    }
  }

  return null;
}

function checkCircularDependency(file: string, ctx: ChangeContext): ChangeAssessment[] {
  if (!ctx.fileContents) return [];
  const content = ctx.fileContents.get(file);
  if (!content) return [];

  const modelFile = ctx.model.files.find((f) => f.relativePath === file);
  const previousImports = new Set(modelFile?.imports ?? []);

  const currentImports = extractImports(content);
  const newImports = currentImports.filter((imp) => !previousImports.has(imp));

  const assessments: ChangeAssessment[] = [];

  for (const imp of newImports) {
    const resolved = resolveRelativeImport(file, imp);
    if (!resolved) continue;

    // Check if target already has a path back to this file (would create a cycle)
    const cyclePath = hasPathInGraph(resolved, file, ctx.model.graph.edges);
    if (cyclePath) {
      const fullCycle = [file, ...cyclePath];
      const depCtx = `Cycle: ${fullCycle.join(' → ')}`;
      assessments.push({
        file,
        type: 'warning',
        rule: 'circular-dependency',
        message: `New import creates circular dependency`,
        details: `Cycle: ${fullCycle.join(' → ')}`,
        suggestion: `Consider restructuring to break the cycle between ${file} and ${resolved}`,
        dependencyContext: depCtx,
        dismissable: true,
      });
    }
  }

  return assessments;
}

// ── Check 7: Test coverage gap ───────────────────────────────

function checkTestCoverageGap(file: string, ctx: ChangeContext): ChangeAssessment[] {
  const basename = path.basename(file).toLowerCase();
  if (isTestFile(basename)) return [];

  const dir = path.dirname(file);
  const nameNoExt = path.basename(file).replace(/\.[^.]+$/, '');
  const ext = path.extname(file);

  // Generate candidate test paths
  const candidates = [
    path.posix.join(dir, `${nameNoExt}.test${ext}`),
    path.posix.join(dir, `${nameNoExt}.spec${ext}`),
    path.posix.join(dir, 'test', `${nameNoExt}.test${ext}`),
    path.posix.join(dir, '__tests__', `${nameNoExt}.test${ext}`),
  ];

  const modelPaths = new Set(ctx.model.files.map((f) => f.relativePath));
  const matchedTestFile = candidates.find((c) => modelPaths.has(c));
  if (!matchedTestFile) return []; // no test file exists — skip silently

  const recentPaths = new Set(ctx.recentChanges.map((c) => c.path));
  if (recentPaths.has(matchedTestFile)) return []; // test was updated recently

  return [{
    file,
    type: 'warning',
    rule: 'test-coverage-gap',
    message: `Test file exists but wasn't updated`,
    details: `${matchedTestFile} may need updates`,
    suggestion: `Consider updating ${matchedTestFile} to cover the changes in ${file}`,
    dependencyContext: `Source: ${file}, test: ${matchedTestFile}`,
    dismissable: true,
  }];
}

// ── Check 8: File size growth ────────────────────────────────

const FILE_SIZE_THRESHOLD = 500;
const FILE_SIZE_GROWTH = 100;

function checkFileSize(file: string, ctx: ChangeContext): ChangeAssessment[] {
  if (!ctx.fileContents) return [];
  const content = ctx.fileContents.get(file);
  if (!content) return [];

  const currentLines = content.split('\n').length;
  const modelFile = ctx.model.files.find((f) => f.relativePath === file);
  const previousLines = modelFile?.lineCount ?? 0;

  // Only fire if over threshold OR grew by a lot
  if (currentLines < FILE_SIZE_THRESHOLD && currentLines - previousLines < FILE_SIZE_GROWTH) return [];
  // Don't fire if file was already large (only on crossing threshold or big growth)
  if (previousLines >= FILE_SIZE_THRESHOLD && currentLines - previousLines < FILE_SIZE_GROWTH) return [];

  return [{
    file,
    type: 'warning',
    rule: 'file-size',
    message: currentLines >= FILE_SIZE_THRESHOLD
      ? `File is ${currentLines} lines (threshold: ${FILE_SIZE_THRESHOLD})`
      : `File grew by ${currentLines - previousLines} lines (now ${currentLines})`,
    suggestion: `Consider splitting ${file} into smaller modules.`,
    dismissable: true,
  }];
}

// ── Check 9: New hub detection ──────────────────────────────

const HUB_THRESHOLD = 3;

function checkNewHub(file: string, ctx: ChangeContext): ChangeAssessment[] {
  // Count current inDegree for this file
  let inDegree = 0;
  for (const edge of ctx.model.graph.edges) {
    if ((edge.type === 'import' || edge.type === 'call') && edge.target === file) {
      inDegree++;
    }
  }

  if (inDegree < HUB_THRESHOLD) return [];

  const previousInDegree = ctx.previousHubCounts?.get(file) ?? 0;
  if (previousInDegree >= HUB_THRESHOLD) return []; // was already a hub

  return [{
    file,
    type: 'warning',
    rule: 'new-hub',
    message: `Now imported by ${inDegree} files — becoming a hub`,
    details: `Changes to this file will affect ${inDegree} dependents.`,
    suggestion: `${file} is becoming a shared dependency. Ensure its API is stable and well-tested.`,
    dismissable: true,
  }];
}

// ── Check 10: Cross-boundary import ─────────────────────────

function checkCrossBoundary(file: string, ctx: ChangeContext): ChangeAssessment[] {
  if (!ctx.fileContents) return [];
  const content = ctx.fileContents.get(file);
  if (!content) return [];

  const fileSegment = file.split('/')[0];
  if (!fileSegment) return [];

  // Only check if the top-level dir has enough files to be a real boundary
  const dirFileCounts = new Map<string, number>();
  for (const f of ctx.model.files) {
    const seg = f.relativePath.split('/')[0];
    dirFileCounts.set(seg, (dirFileCounts.get(seg) ?? 0) + 1);
  }
  if ((dirFileCounts.get(fileSegment) ?? 0) < 3) return [];

  const modelFile = ctx.model.files.find((f) => f.relativePath === file);
  const previousImports = new Set(modelFile?.imports ?? []);
  const currentImports = extractImports(content);
  const newImports = currentImports.filter((imp) => !previousImports.has(imp));

  const assessments: ChangeAssessment[] = [];

  for (const imp of newImports) {
    const resolved = resolveRelativeImport(file, imp);
    if (!resolved) continue;

    const targetSegment = resolved.split('/')[0];
    if (!targetSegment || targetSegment === fileSegment) continue;
    if ((dirFileCounts.get(targetSegment) ?? 0) < 3) continue;

    assessments.push({
      file,
      type: 'warning',
      rule: 'cross-boundary',
      message: `New import crosses ${fileSegment}/${targetSegment} boundary`,
      details: `${file} now imports from ${resolved}`,
      suggestion: `Verify this cross-boundary import is intentional (${fileSegment} → ${targetSegment}).`,
      dependencyContext: `boundary: ${fileSegment} → ${targetSegment}`,
      dismissable: true,
    });
    break; // One warning per boundary crossing is enough
  }

  return assessments;
}

// ── Check 11: Stale import (deleted target) ─────────────────

function checkStaleImport(file: string, ctx: ChangeContext): ChangeAssessment[] {
  // Check if any recently deleted files were imported by this file
  const recentDeletes = ctx.recentChanges
    .filter((c) => c.type === 'unlink')
    .map((c) => c.path);

  if (recentDeletes.length === 0) return [];

  const modelFile = ctx.model.files.find((f) => f.relativePath === file);
  if (!modelFile) return [];

  // Check graph edges: does this file import any recently deleted file?
  const importTargets = new Set<string>();
  for (const edge of ctx.model.graph.edges) {
    if (edge.source === file && (edge.type === 'import' || edge.type === 'call')) {
      importTargets.add(edge.target);
    }
  }

  const assessments: ChangeAssessment[] = [];
  for (const deleted of recentDeletes) {
    if (importTargets.has(deleted)) {
      assessments.push({
        file,
        type: 'warning',
        rule: 'stale-import',
        message: `Imports from ${deleted} which was just deleted`,
        suggestion: `Update or remove the import from ${deleted} in ${file}.`,
        dependencyContext: `deleted: ${deleted}, importer: ${file}`,
        dismissable: true,
      });
    }
  }

  return assessments;
}

// ── Check 12: Inheritance change propagation ────────────────

function checkInheritanceChange(file: string, ctx: ChangeContext): ChangeAssessment[] {
  // Find files that inherit from symbols in this file
  const children: string[] = [];
  for (const edge of ctx.model.graph.edges) {
    if (edge.type === 'inherit' && edge.target === file && edge.source !== file) {
      children.push(edge.source);
    }
  }

  if (children.length === 0) return [];

  // Check if children were recently updated
  const recentPaths = new Set(ctx.recentChanges.map((c) => c.path));
  const missingChildren = children.filter((c) => !recentPaths.has(c));

  if (missingChildren.length === 0) return [];

  const shown = missingChildren.slice(0, 3);
  const moreCount = missingChildren.length - shown.length;
  const childList = shown.join(', ') + (moreCount > 0 ? `, +${moreCount} more` : '');

  return [{
    file,
    type: 'warning',
    rule: 'inheritance-change',
    message: `Base class/interface modified — ${missingChildren.length} child${missingChildren.length === 1 ? '' : 'ren'} may need updates`,
    details: `Not yet updated: ${childList}`,
    suggestion: `Verify child implementations: ${missingChildren.join(', ')}`,
    dependencyContext: `${children.length} children, ${missingChildren.length} not updated: [${missingChildren.join(', ')}]`,
    dismissable: true,
  }];
}

// ── Preference override ──────────────────────────────────────

function applyPreferences(
  assessments: ChangeAssessment[],
  preferences: PreferencesStore,
): ChangeAssessment[] {
  return assessments.filter((a) => {
    const dir = path.dirname(a.file) + '/';
    const pref = findMatchingPreference(preferences, a.rule, a.file, dir);

    if (!pref) return true;

    if (pref.disposition === 'allow') {
      bumpPreferenceHit(preferences, pref.id);
      return false; // suppress
    }
    if (pref.disposition === 'deny') {
      bumpPreferenceHit(preferences, pref.id);
      a.type = 'violation'; // upgrade to violation
    }
    return true;
  });
}
