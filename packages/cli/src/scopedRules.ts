/**
 * Scoped rule generation — deterministic, analysis-driven rules for
 * Claude Code, Cursor, and Copilot.
 *
 * Extracts path-specific guidance from the AnalysisModel and writes
 * platform-specific rule files. AGENTS.md stays broad; scoped rules
 * activate only when relevant files are touched.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import type { AnalysisModel } from '@aspectcode/core';
import type { EmitterHost } from '@aspectcode/emitters';
import { AI_TOOL_DETECTION_PATHS } from '@aspectcode/emitters';
import type { AiToolId } from '@aspectcode/emitters';

// ── Types ────────────────────────────────────────────────────

export interface ScopedRule {
  /** Unique slug for file naming, e.g. "src-core" */
  slug: string;
  /** Human-readable description for frontmatter */
  description: string;
  /** Glob patterns this rule applies to */
  globs: string[];
  /** Markdown body (no frontmatter) */
  content: string;
  /** Which extractor generated this */
  source: 'hub' | 'convention' | 'circular-dep' | 'dream';
}

interface ManifestEntry {
  slug: string;
  platform: string;
  path: string;
  hash: string;
}

interface Manifest {
  version: 1;
  rules: ManifestEntry[];
}

// ── Supported platforms ──────────────────────────────────────

const SUPPORTED_PLATFORMS: AiToolId[] = ['claudeCode', 'cursor', 'copilot'];

// ── Extractors ───────────────────────────────────────────────

/**
 * Extract all scoped rules from the analysis model.
 */
export function extractScopedRules(model: AnalysisModel): ScopedRule[] {
  return [
    ...extractHubRules(model),
    ...extractConventionRules(model),
    ...extractCircularDepRules(model),
  ];
}

/**
 * Hub directory rules — for directories containing high-connectivity files.
 */
export function extractHubRules(model: AnalysisModel): ScopedRule[] {
  const hubs = model.metrics.hubs.filter((h) => h.inDegree >= 3);
  if (hubs.length === 0) return [];

  // Group hubs by directory
  const dirHubs = new Map<string, typeof hubs>();
  for (const hub of hubs) {
    const dir = path.posix.dirname(hub.file);
    const existing = dirHubs.get(dir) ?? [];
    existing.push(hub);
    dirHubs.set(dir, existing);
  }

  const rules: ScopedRule[] = [];
  for (const [dir, hubsInDir] of dirHubs) {
    // Find top dependents across all hubs in this directory
    const dependents = new Set<string>();
    for (const hub of hubsInDir) {
      for (const edge of model.graph.edges) {
        if (edge.target === hub.file && edge.source !== hub.file) {
          dependents.add(edge.source);
        }
      }
    }

    const hubList = hubsInDir
      .sort((a, b) => b.inDegree - a.inDegree)
      .map((h) => `\`${path.posix.basename(h.file)}\` (${h.inDegree} dependents)`)
      .join(', ');

    const topDeps = [...dependents].slice(0, 5).map((d) => `\`${d}\``).join(', ');

    const slug = dirToSlug(dir);
    rules.push({
      slug: `hub-${slug}`,
      description: `High-impact hub files in ${dir}/`,
      globs: [`${dir}/**`],
      content: [
        `## High-Impact Hubs`,
        ``,
        `This directory contains hub files with many dependents: ${hubList}.`,
        ``,
        `- Read the hub file and trace callers before editing.`,
        `- Changes here ripple widely. Verify dependent files after modifications.`,
        ...(topDeps ? [`- Key dependents: ${topDeps}`] : []),
      ].join('\n') + '\n',
      source: 'hub',
    });
  }

  return rules;
}

/**
 * Convention cluster rules — for directories with naming patterns
 * that differ from the repo-wide dominant.
 */
export function extractConventionRules(model: AnalysisModel): ScopedRule[] {
  // Determine repo-wide dominant naming pattern
  const allFiles = model.files.map((f) => f.relativePath);
  const repoDominant = detectDominantNaming(allFiles);

  // Group files by directory
  const dirFiles = new Map<string, string[]>();
  for (const file of model.files) {
    const dir = path.posix.dirname(file.relativePath);
    const existing = dirFiles.get(dir) ?? [];
    existing.push(file.relativePath);
    dirFiles.set(dir, existing);
  }

  const rules: ScopedRule[] = [];
  for (const [dir, files] of dirFiles) {
    if (files.length < 3) continue; // not enough data

    const dirDominant = detectDominantNaming(files);
    if (!dirDominant || dirDominant === repoDominant) continue;

    // Check for test co-location
    const hasTests = files.some((f) => {
      const base = path.posix.basename(f).toLowerCase();
      return /\.(test|spec)\.[^.]+$/.test(base);
    });

    const lines = [`## Directory Conventions`, ``];
    lines.push(`- Files in this directory use **${dirDominant}** naming.`);
    if (hasTests) {
      lines.push(`- Tests are co-located alongside source files.`);
    }

    const slug = dirToSlug(dir);
    rules.push({
      slug: `conv-${slug}`,
      description: `Naming conventions for ${dir}/`,
      globs: [`${dir}/**`],
      content: lines.join('\n') + '\n',
      source: 'convention',
    });
  }

  return rules;
}

/**
 * Circular dependency zone rules — for directories involved in cycles.
 */
export function extractCircularDepRules(model: AnalysisModel): ScopedRule[] {
  const circularEdges = model.graph.edges.filter((e) => e.type === 'circular');
  if (circularEdges.length === 0) return [];

  // Group by directory of source file
  const dirCycles = new Map<string, Set<string>>();
  for (const edge of circularEdges) {
    const dir = path.posix.dirname(edge.source);
    const existing = dirCycles.get(dir) ?? new Set();
    existing.add(edge.source);
    existing.add(edge.target);
    dirCycles.set(dir, existing);
  }

  const rules: ScopedRule[] = [];
  for (const [dir, involvedFiles] of dirCycles) {
    const fileList = [...involvedFiles]
      .map((f) => `\`${f}\``)
      .join(', ');

    const slug = dirToSlug(dir);
    rules.push({
      slug: `circular-${slug}`,
      description: `Circular dependency warning for ${dir}/`,
      globs: [`${dir}/**`],
      content: [
        `## Circular Dependencies`,
        ``,
        `This directory has circular import chains involving: ${fileList}.`,
        ``,
        `- Avoid adding new imports between these files.`,
        `- When modifying, check if the change deepens the cycle.`,
        `- Consider extracting shared types to break the cycle.`,
      ].join('\n') + '\n',
      source: 'circular-dep',
    });
  }

  return rules;
}

// ── Platform serializers ─────────────────────────────────────

export function serializeForClaudeCode(rule: ScopedRule): { path: string; content: string } {
  const globs = rule.globs.map((g) => `  - "${g}"`).join('\n');
  const content = `---\ndescription: "${escapeYaml(rule.description)}"\nglobs:\n${globs}\n---\n\n${rule.content}`;
  return { path: `.claude/rules/ac-${rule.slug}.md`, content };
}

export function serializeForCursor(rule: ScopedRule): { path: string; content: string } {
  const globs = rule.globs.map((g) => `  - "${g}"`).join('\n');
  const content = `---\ndescription: "${escapeYaml(rule.description)}"\nglobs:\n${globs}\nalwaysApply: false\n---\n\n${rule.content}`;
  return { path: `.cursor/rules/ac-${rule.slug}.mdc`, content };
}

// ── Platform resolution ──────────────────────────────────────

/** User-facing platform names mapped to internal AiToolId. */
const PLATFORM_MAP: Record<string, AiToolId> = {
  claude: 'claudeCode',
  cursor: 'cursor',
};

/**
 * Resolve the active platform. Returns null if ambiguous (needs survey).
 * Priority: flag → config → auto-detect (single match) → null.
 */
export async function resolvePlatform(
  host: EmitterHost,
  root: string,
  flagPlatform?: string,
  configPlatform?: string,
): Promise<AiToolId | null> {
  // 1. CLI flag
  if (flagPlatform) {
    const mapped = PLATFORM_MAP[flagPlatform];
    if (mapped) return mapped;
  }

  // 2. Config
  if (configPlatform) {
    const mapped = PLATFORM_MAP[configPlatform];
    if (mapped) return mapped;
  }

  // 3. Auto-detect from filesystem
  const detected: AiToolId[] = [];
  for (const entry of AI_TOOL_DETECTION_PATHS) {
    if (!SUPPORTED_PLATFORMS.includes(entry.id)) continue;
    for (const p of entry.paths) {
      if (await host.exists(host.join(root, p))) {
        detected.push(entry.id);
        break;
      }
    }
  }

  if (detected.length === 1) return detected[0];
  return null; // ambiguous or none — caller should survey
}

/** Map AiToolId back to user-facing name. */
export function platformLabel(id: AiToolId | null): string {
  if (id === 'claudeCode') return 'claude';
  if (id === 'cursor') return 'cursor';
  return '';
}

// ── Writer ───────────────────────────────────────────────────

/**
 * Write scoped rules for a single platform. Manages manifest
 * to track owned files and clean up stale ones.
 */
export async function writeScopedRules(
  host: EmitterHost,
  root: string,
  rules: ScopedRule[],
  platform: AiToolId,
): Promise<string[]> {
  const manifest = await loadManifest(host, root);
  const newEntries: ManifestEntry[] = [];
  const written: string[] = [];

  for (const rule of rules) {
    const serialized = platform === 'claudeCode'
      ? serializeForClaudeCode(rule)
      : serializeForCursor(rule);

    const absPath = host.join(root, serialized.path);
    const dir = host.join(root, path.posix.dirname(serialized.path));
    await host.mkdirp(dir);
    await host.writeFile(absPath, serialized.content);

    const hash = crypto.createHash('md5').update(serialized.content).digest('hex').slice(0, 8);
    newEntries.push({ slug: rule.slug, platform, path: serialized.path, hash });
    written.push(serialized.path);
  }

  // Clean up stale files (in old manifest but not in new)
  const newPaths = new Set(newEntries.map((e) => e.path));
  for (const old of manifest.rules) {
    if (!newPaths.has(old.path)) {
      try {
        await host.rmrf(host.join(root, old.path));
      } catch { /* file may already be gone */ }
    }
  }

  await saveManifest(host, root, { version: 1, rules: newEntries });
  return written;
}

// ── Manifest ─────────────────────────────────────────────────

const MANIFEST_PATH = '.aspectcode/scoped-rules.json';

async function loadManifest(host: EmitterHost, root: string): Promise<Manifest> {
  try {
    const raw = await host.readFile(host.join(root, MANIFEST_PATH));
    const parsed = JSON.parse(raw) as Manifest;
    if (parsed.version === 1 && Array.isArray(parsed.rules)) return parsed;
  } catch { /* missing or malformed */ }
  return { version: 1, rules: [] };
}

async function saveManifest(host: EmitterHost, root: string, manifest: Manifest): Promise<void> {
  const dir = host.join(root, '.aspectcode');
  await host.mkdirp(dir);
  await host.writeFile(host.join(root, MANIFEST_PATH), JSON.stringify(manifest, null, 2) + '\n');
}

// ── Helpers ──────────────────────────────────────────────────

/** Convert a directory path to a slug for file naming. */
function dirToSlug(dir: string): string {
  return dir
    .replace(/^\.?\/?/, '')
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/gi, '')
    .toLowerCase()
    || 'root';
}

/** Escape a string for YAML double-quoted value. */
function escapeYaml(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

type NamingPattern = 'camelCase' | 'PascalCase' | 'snake_case' | 'kebab-case';

/** Detect the dominant naming pattern in a list of file paths. */
function detectDominantNaming(files: string[]): NamingPattern | null {
  const counts: Record<string, number> = {};
  for (const file of files) {
    const basename = path.posix.basename(file).replace(/\.[^.]+$/, '');
    // Skip index files and test files
    if (basename === 'index' || /test|spec/i.test(basename)) continue;

    let pattern: NamingPattern | null = null;
    if (basename.includes('-')) pattern = 'kebab-case';
    else if (basename.includes('_')) pattern = 'snake_case';
    else if (/^[A-Z]/.test(basename)) pattern = 'PascalCase';
    else if (/[a-z][A-Z]/.test(basename)) pattern = 'camelCase';

    if (pattern) counts[pattern] = (counts[pattern] ?? 0) + 1;
  }

  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);

  const total = entries.reduce((sum, [, c]) => sum + c, 0);
  return entries[0][1] / total > 0.5 ? entries[0][0] as NamingPattern : null;
}
