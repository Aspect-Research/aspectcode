/**
 * Probe generator — creates scoped micro-tests from KB content.
 *
 * Probes are derived from:
 * 1. KB structure (hubs, entry points, naming conventions, integrations)
 * 2. KB diff (changed areas and their 1-hop dependents)
 * 3. Harvested prompts (real user interactions that reveal problem areas)
 *
 * Each probe is a self-contained scenario that can be "run" by sending it
 * to an LLM with AGENTS.md as context and evaluating the response.
 */

import type {
  Probe,
  ProbeCategory,
  ProbeGeneratorOptions,
  HarvestedPrompt,
} from './types';

// ── KB section parsers ──────────────────────────────────────

/** Extract a section from KB text by heading prefix. */
function extractSection(kb: string, heading: string): string {
  const idx = kb.indexOf(heading);
  if (idx < 0) return '';
  const start = idx + heading.length;
  // Find the next `---` separator or end of string
  const sepIdx = kb.indexOf('\n---\n', start);
  return sepIdx > 0 ? kb.slice(start, sepIdx).trim() : kb.slice(start).trim();
}

/** Parse "High-Risk Architectural Hubs" table rows: | path | in | out | */
function parseHubs(architecture: string): Array<{ file: string; inDegree: number; outDegree: number }> {
  const hubs: Array<{ file: string; inDegree: number; outDegree: number }> = [];
  const tableRegex = /\|\s*`?([^`|]+?)`?\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/g;
  const section = extractSubSection(architecture, 'High-Risk Architectural Hubs');
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(section)) !== null) {
    hubs.push({
      file: match[1].trim(),
      inDegree: parseInt(match[2], 10),
      outDegree: parseInt(match[3], 10),
    });
  }
  return hubs;
}

/** Parse "Entry Points" from architecture section. */
function parseEntryPoints(architecture: string): Array<{ file: string; kind: string }> {
  const entries: Array<{ file: string; kind: string }> = [];
  const section = extractSubSection(architecture, 'Entry Points');
  const regex = /\|\s*`?([^`|]+?)`?\s*\|\s*([^|]+?)\s*\|/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(section)) !== null) {
    const file = match[1].trim();
    const kind = match[2].trim();
    if (file && !file.includes('---') && kind !== 'Kind') {
      entries.push({ file, kind });
    }
  }
  return entries;
}

/** Parse naming conventions from the map section. */
function parseConventions(mapSection: string): string[] {
  const section = extractSubSection(mapSection, 'Conventions');
  return section
    .split('\n')
    .filter((line) => line.startsWith('- ') || line.startsWith('* '))
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

/** Extract a sub-section within a larger section by heading. */
function extractSubSection(section: string, heading: string): string {
  const regex = new RegExp(`#+\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  const match = regex.exec(section);
  if (!match) return '';
  const start = match.index + match[0].length;
  // Find next heading of same or higher level
  const nextHeading = section.slice(start).search(/\n#{1,3}\s/);
  return nextHeading > 0 ? section.slice(start, start + nextHeading).trim() : section.slice(start).trim();
}

/** Parse file paths mentioned in a diff string. */
function parseDiffFiles(diff: string): string[] {
  const files = new Set<string>();
  const regex = /^[+-]{3}\s+[ab]\/(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(diff)) !== null) {
    files.add(match[1]);
  }
  // Also pick up paths from @@ hunks or added/removed lines referencing files
  const pathRegex = /(?:^[+-]\s*(?:import|from|require)\s*.*?['"])([^'"]+)['"]/gm;
  while ((match = pathRegex.exec(diff)) !== null) {
    files.add(match[1]);
  }
  return [...files];
}

// ── Probe generators by category ────────────────────────────

function generateHubProbes(hubs: Array<{ file: string; inDegree: number; outDegree: number }>): Probe[] {
  return hubs.slice(0, 5).map((hub) => ({
    id: `hub-safety-${sanitizeId(hub.file)}`,
    description: `Test that the AI handles ${hub.file} carefully (${hub.inDegree} dependents)`,
    category: 'hub-safety' as ProbeCategory,
    contextFiles: [hub.file],
    task: `I need to modify \`${hub.file}\` to add a new exported function. This file has ${hub.inDegree} files that depend on it. Write the code change and explain what else needs updating.`,
    expectedBehaviors: [
      `Acknowledges that ${hub.file} is a high-risk hub with many dependents`,
      'Warns about or checks for breaking changes to existing exports',
      'Suggests verifying or updating downstream consumers',
      'Makes a minimal, backwards-compatible change',
    ],
  }));
}

function generateEntryPointProbes(entries: Array<{ file: string; kind: string }>): Probe[] {
  return entries.slice(0, 3).map((entry) => ({
    id: `entry-point-${sanitizeId(entry.file)}`,
    description: `Test that the AI handles ${entry.kind} entry point ${entry.file} correctly`,
    category: 'entry-point' as ProbeCategory,
    contextFiles: [entry.file],
    task: `I want to add a new ${entry.kind.toLowerCase()} route/command in \`${entry.file}\`. Where should I add it and what patterns should I follow?`,
    expectedBehaviors: [
      `References the existing patterns in ${entry.file}`,
      `Follows the ${entry.kind.toLowerCase()} conventions used in the project`,
      'Suggests appropriate error handling consistent with existing handlers',
      'Places the new code in the correct location within the file',
    ],
  }));
}

function generateNamingProbes(conventions: string[]): Probe[] {
  if (conventions.length === 0) return [];
  const conventionText = conventions.slice(0, 5).join('; ');
  return [{
    id: 'naming-conventions',
    description: 'Test that the AI follows the project\'s naming conventions',
    category: 'naming' as ProbeCategory,
    contextFiles: [],
    task: `I need to create a new utility module with a helper function and a class. What should I name the file, function, and class? The project has these conventions: ${conventionText}`,
    expectedBehaviors: conventions.slice(0, 5).map((c) =>
      `Follows convention: ${c}`
    ),
  }];
}

function generateDiffProbes(diffFiles: string[]): Probe[] {
  if (diffFiles.length === 0) return [];
  return diffFiles.slice(0, 3).map((file) => ({
    id: `diff-area-${sanitizeId(file)}`,
    description: `Test AI awareness of recently changed file ${file}`,
    category: 'architecture' as ProbeCategory,
    contextFiles: [file],
    task: `I'm working on \`${file}\` which was recently modified. I need to add a related feature. What do I need to know about this file and its dependencies before making changes?`,
    expectedBehaviors: [
      `Identifies the role/purpose of ${file} in the project`,
      'Notes any imports/exports that constrain changes',
      'Suggests checking dependent files',
      'Follows the existing code style in the file',
    ],
  }));
}

function generateHarvestedProbes(prompts: HarvestedPrompt[]): Probe[] {
  // Take the most recent prompts that reference specific files
  const withFiles = prompts
    .filter((p) => p.filesReferenced.length > 0)
    .slice(0, 3);

  return withFiles.map((p, i) => ({
    id: `harvested-${i}-${sanitizeId(p.filesReferenced[0] ?? 'general')}`,
    description: `Probe from real ${p.source} interaction involving ${p.filesReferenced.join(', ')}`,
    category: 'harvested' as ProbeCategory,
    contextFiles: p.filesReferenced,
    task: p.userPrompt,
    expectedBehaviors: [
      'Produces a response consistent with the project\'s conventions',
      'References the correct files and their roles',
      'Does not hallucinate non-existent APIs or patterns',
      `Handles the task at least as well as the original ${p.source} response`,
    ],
  }));
}

// ── Helpers ─────────────────────────────────────────────────

function sanitizeId(path: string): string {
  return path
    .replace(/[/\\]/g, '-')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .toLowerCase()
    .slice(0, 40);
}

// ── Public API ──────────────────────────────────────────────

/**
 * Generate probes scoped to the KB content and optional diff.
 *
 * When a diff is provided, probes focus on changed areas.
 * Otherwise, probes cover the full KB (hubs, entry points, conventions).
 */
export function generateProbes(options: ProbeGeneratorOptions): Probe[] {
  const { kb, kbDiff, harvestedPrompts, maxProbes = 10 } = options;

  const architecture = extractSection(kb, '## High-Risk Architectural Hubs');
  const fullArch = extractSection(kb, '# Architecture') || extractSection(kb, '## High-Risk');
  const mapSection = extractSection(kb, '# Map') || extractSection(kb, '## Data Models');
  const probes: Probe[] = [];

  // 1. Hub safety probes
  const hubs = parseHubs(fullArch || architecture);
  probes.push(...generateHubProbes(hubs));

  // 2. Entry point probes
  const entries = parseEntryPoints(fullArch || architecture);
  probes.push(...generateEntryPointProbes(entries));

  // 3. Naming convention probes
  const conventions = parseConventions(mapSection);
  probes.push(...generateNamingProbes(conventions));

  // 4. Diff-scoped probes (prioritized when available)
  if (kbDiff) {
    const diffFiles = parseDiffFiles(kbDiff);
    const diffProbes = generateDiffProbes(diffFiles);
    // Insert diff probes at the front (highest priority)
    probes.unshift(...diffProbes);
  }

  // 5. Harvested prompt probes
  if (harvestedPrompts && harvestedPrompts.length > 0) {
    probes.push(...generateHarvestedProbes(harvestedPrompts));
  }

  // Deduplicate by id and cap at maxProbes
  const seen = new Set<string>();
  const unique: Probe[] = [];
  for (const probe of probes) {
    if (!seen.has(probe.id) && unique.length < maxProbes) {
      seen.add(probe.id);
      unique.push(probe);
    }
  }

  return unique;
}

// Exported for testing
export { extractSection, parseHubs, parseEntryPoints, parseConventions, parseDiffFiles };
