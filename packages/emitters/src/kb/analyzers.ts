/**
 * Graph-analysis helpers for the KB emitter.
 *
 * Centrality scoring, dependency chains, module clusters,
 * directory analysis, layer-flow detection, endpoint grouping.
 *
 * All functions are pure (no I/O, no vscode).
 */

import { toPosix, DependencyLink } from '@aspectcode/core';
import { makeRelativePath, dedupe } from './helpers';
import { isConfigOrToolingFile, classifyFile } from './classifiers';

// ── Centrality ───────────────────────────────────────────────

export function calculateCentralityScores(
  allLinks: DependencyLink[],
): Map<string, { inDegree: number; outDegree: number; score: number }> {
  const scores = new Map<string, { inDegree: number; outDegree: number; score: number }>();
  const allFiles = new Set(allLinks.flatMap((l) => [l.source, l.target]));

  for (const file of allFiles) {
    const inDegree = allLinks.filter((l) => l.target === file && l.source !== file).length;
    const outDegree = allLinks.filter((l) => l.source === file && l.target !== file).length;
    const score = inDegree * 2 + outDegree;
    scores.set(file, { inDegree, outDegree, score });
  }

  return scores;
}

// ── Endpoint grouping ────────────────────────────────────────

export function groupEndpointsByModule(
  handlers: Array<{ file: string; message: string }>,
  workspaceRoot: string,
): Record<string, Array<{ file: string; message: string }>> {
  const groups: Record<string, Array<{ file: string; message: string }>> = {};

  for (const handler of handlers) {
    const relPath = makeRelativePath(handler.file, workspaceRoot);
    const parts = relPath.split(/[/\\]/);
    let moduleName = getBasenameNoExt(handler.file);

    const routeIdx = parts.findIndex((p) => p === 'routes' || p === 'api' || p === 'endpoints');
    if (routeIdx >= 0 && routeIdx < parts.length - 1) {
      const nextPart = parts[routeIdx + 1];
      if (!nextPart.includes('.')) {
        moduleName = nextPart;
      }
    }

    moduleName = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
    if (!groups[moduleName]) groups[moduleName] = [];
    groups[moduleName].push(handler);
  }

  return Object.fromEntries(
    Object.entries(groups).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])),
  );
}

// ── Entry-point flows ────────────────────────────────────────

/**
 * Build call-chain flows starting from known entry points.
 * Follows outgoing links 2 levels deep.
 */
export function buildEntryPointFlows(
  entryPoints: Array<{ path: string; reason: string }>,
  files: string[],
  allLinks: DependencyLink[],
  workspaceRoot: string,
): Array<{ title: string; chain: string[] }> {
  const flows: Array<{ title: string; chain: string[] }> = [];

  for (const entry of entryPoints.slice(0, 5)) {
    const entryFile = files.find((f) => makeRelativePath(f, workspaceRoot) === entry.path);
    if (!entryFile) continue;

    const chain: string[] = [];
    chain.push(`→ ${entry.path} (${entry.reason})`);

    const level1Links = allLinks
      .filter((l) => l.source === entryFile)
      .sort((a, b) => a.target.localeCompare(b.target))
      .slice(0, 3);

    for (const l1 of level1Links) {
      const l1Name = makeRelativePath(l1.target, workspaceRoot);
      const l1Symbols = l1.symbols.slice(0, 2).join(', ');
      chain.push(`  → ${l1Name}${l1Symbols ? ` (${l1Symbols})` : ''}`);

      const level2Links = allLinks
        .filter((l) => l.source === l1.target)
        .sort((a, b) => a.target.localeCompare(b.target))
        .slice(0, 2);
      for (const l2 of level2Links) {
        chain.push(`    → ${makeRelativePath(l2.target, workspaceRoot)}`);
      }
    }

    if (chain.length > 1) flows.push({ title: entry.reason, chain });
  }

  return flows;
}

// ── Layer flows ──────────────────────────────────────────────

export function detectLayerFlows(
  files: string[],
  _allLinks: DependencyLink[],
  _workspaceRoot: string,
): Array<{ name: string; flow: string }> {
  const flows: Array<{ name: string; flow: string }> = [];
  const lower = files.map((f) => f.toLowerCase());

  const hasModels = lower.some((f) => f.includes('model'));
  const hasServices = lower.some((f) => f.includes('service'));
  const hasHandlers = lower.some((f) => f.includes('handler') || f.includes('controller'));
  const hasApi = lower.some((f) => f.includes('/api/') || f.includes('route'));

  if (hasApi && hasHandlers) {
    flows.push({
      name: 'API Request Flow',
      flow: 'Client Request → Routes/API → Handlers/Controllers → Services → Models → Database',
    });
  }
  if (hasModels && hasServices) {
    flows.push({
      name: 'Data Flow',
      flow: 'Models (data) → Services (logic) → Handlers (HTTP) → Response',
    });
  }

  const hasComponents = lower.some((f) => f.includes('component'));
  const hasHooks = lower.some((f) => f.includes('hook') || f.includes('use'));
  if (hasComponents && hasHooks) {
    flows.push({
      name: 'React Data Flow',
      flow: 'Components → Hooks → State/Context → API Calls → Server',
    });
  }

  return flows;
}

// ── Dependency chains ────────────────────────────────────────

/**
 * Find 3-5 dependency chains (3-6 modules) with deterministic ordering.
 */
export function findDependencyChains(
  allLinks: DependencyLink[],
  workspaceRoot: string,
  maxDepth: number = 5,
  preferredStartPaths: string[] = [],
): string[] {
  const chains: Array<{ chain: string[]; depth: number; startPath: string; startsFromEntry: boolean }> = [];

  // Build sorted adjacency map
  const outgoing = new Map<string, string[]>();
  for (const link of allLinks) {
    if (link.source === link.target) continue;
    if (!outgoing.has(link.source)) outgoing.set(link.source, []);
    outgoing.get(link.source)!.push(link.target);
  }
  for (const [key, deps] of outgoing.entries()) {
    outgoing.set(key, deps.sort());
  }

  const preferredSet = new Set(preferredStartPaths.map((p) => p.toLowerCase()));

  // In-degree for start-point ranking
  const inDegree = new Map<string, number>();
  for (const link of allLinks) {
    if (link.source === link.target) continue;
    inDegree.set(link.target, (inDegree.get(link.target) || 0) + 1);
  }

  const entryStartFiles: string[] = [];
  for (const file of outgoing.keys()) {
    const relPath = makeRelativePath(file, workspaceRoot).toLowerCase();
    if (preferredSet.has(relPath)) entryStartFiles.push(file);
  }

  const inDegreeStartFiles = Array.from(inDegree.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([file]) => file)
    .filter((f) => !entryStartFiles.some((e) => e === f));

  const startFiles = [...entryStartFiles.sort(), ...inDegreeStartFiles].slice(0, 10);
  const seenChains = new Set<string>();

  for (const startFile of startFiles) {
    const deps = outgoing.get(startFile) || [];
    if (deps.length === 0) continue;

    const startsFromEntry = preferredSet.has(
      makeRelativePath(startFile, workspaceRoot).toLowerCase(),
    );

    const chain: string[] = [makeRelativePath(startFile, workspaceRoot)];
    let current = deps[0];
    let depth = 0;

    while (depth < maxDepth && current) {
      const relPath = makeRelativePath(current, workspaceRoot);
      if (chain.includes(relPath)) break;
      chain.push(relPath);
      const nextDeps = (outgoing.get(current) || []).filter(
        (d) => !chain.includes(makeRelativePath(d, workspaceRoot)),
      );
      current = nextDeps[0] || '';
      depth++;
    }

    if (chain.length >= 3) {
      const finalChain = chain.slice(0, 6);
      const chainStr = finalChain.join(' → ');
      if (!seenChains.has(chainStr)) {
        seenChains.add(chainStr);
        chains.push({ chain: finalChain, depth: finalChain.length, startPath: startFile, startsFromEntry });
      }
    }
  }

  // Score & sort
  const outDegree = new Map<string, number>();
  for (const link of allLinks) {
    if (link.source === link.target) continue;
    outDegree.set(link.source, (outDegree.get(link.source) || 0) + 1);
  }

  const sortedChains = chains
    .map((c) => {
      const lastFile = c.chain[c.chain.length - 1];
      const isLeaf = (outDegree.get(lastFile) || 0) <= 1;
      const entryBonus = c.startsFromEntry ? 10 : 0;
      return { ...c, score: entryBonus + c.depth + (isLeaf ? 1 : 0) };
    })
    .sort((a, b) => b.score - a.score || b.depth - a.depth || a.startPath.localeCompare(b.startPath))
    .slice(0, 5);

  // Fill with fallback chains if < 3
  if (sortedChains.length < 3) {
    const additionalStarts = Array.from(outgoing.keys())
      .filter((f) => !startFiles.includes(f))
      .sort()
      .slice(0, 5);

    for (const startFile of additionalStarts) {
      if (sortedChains.length >= 5) break;
      const chain: string[] = [makeRelativePath(startFile, workspaceRoot)];
      let current = (outgoing.get(startFile) || [])[0];

      while (chain.length < maxDepth && current) {
        const relPath = makeRelativePath(current, workspaceRoot);
        if (chain.includes(relPath)) break;
        chain.push(relPath);
        const nextDeps = (outgoing.get(current) || []).filter(
          (d) => !chain.includes(makeRelativePath(d, workspaceRoot)),
        );
        current = nextDeps[0] || '';
      }

      if (chain.length >= 3) {
        const finalChain = chain.slice(0, 6);
        const chainStr = finalChain.join(' → ');
        if (!seenChains.has(chainStr)) {
          seenChains.add(chainStr);
          const lastFile = finalChain[finalChain.length - 1];
          const isLeaf = (outDegree.get(lastFile) || 0) <= 1;
          sortedChains.push({
            chain: finalChain,
            depth: finalChain.length,
            startPath: startFile,
            startsFromEntry: false,
            score: finalChain.length + (isLeaf ? 1 : 0),
          });
        }
      }
    }
  }

  return sortedChains.slice(0, 5).map((c) => c.chain.join(' → '));
}

// ── Module clusters ──────────────────────────────────────────

export interface ModuleCluster {
  name: string;
  files: string[];
  reason: string;
  sharedImporters: string[];
  score: number;
}

/**
 * Find 3-7 clusters of files commonly imported together.
 */
export function findModuleClusters(
  allLinks: DependencyLink[],
  workspaceRoot: string,
): ModuleCluster[] {
  const clusters: ModuleCluster[] = [];

  // Build importedBy map
  const importedBy = new Map<string, Set<string>>();
  for (const link of allLinks) {
    if (link.source === link.target) continue;
    if (!importedBy.has(link.target)) importedBy.set(link.target, new Set());
    importedBy.get(link.target)!.add(link.source);
  }

  // Pairwise co-import scoring
  const fileList = Array.from(importedBy.keys()).sort();
  const coImportScores = new Map<string, Map<string, { score: number; sharedImporters: string[] }>>();

  for (let i = 0; i < fileList.length; i++) {
    for (let j = i + 1; j < fileList.length; j++) {
      const fileA = fileList[i];
      const fileB = fileList[j];
      const importersA = importedBy.get(fileA) || new Set();
      const importersB = importedBy.get(fileB) || new Set();

      const sharedImporters: string[] = [];
      for (const importer of importersA) {
        if (importersB.has(importer)) sharedImporters.push(importer);
      }

      if (sharedImporters.length >= 2) {
        if (!coImportScores.has(fileA)) coImportScores.set(fileA, new Map());
        sharedImporters.sort();
        coImportScores.get(fileA)!.set(fileB, { score: sharedImporters.length, sharedImporters });
      }
    }
  }

  // Build clusters from high co-import scores
  const processed = new Set<string>();
  const sortedEntries = Array.from(coImportScores.entries()).sort((a, b) => {
    const scoreA = Array.from(a[1].values()).reduce((sum, d) => sum + d.score, 0);
    const scoreB = Array.from(b[1].values()).reduce((sum, d) => sum + d.score, 0);
    return scoreB - scoreA || a[0].localeCompare(b[0]);
  });

  for (const [file, relatedMap] of sortedEntries) {
    if (processed.has(file)) continue;

    const related = Array.from(relatedMap.entries())
      .filter(([_, data]) => data.score >= 2)
      .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
      .slice(0, 7);

    if (related.length >= 1) {
      const rawFiles = [file, ...related.map(([f]) => f)].map((f) => makeRelativePath(f, workspaceRoot));
      const clusterFiles = dedupe(rawFiles.filter((f) => !isConfigOrToolingFile(f)))
        .sort()
        .slice(0, 8);

      if (clusterFiles.length < 2) {
        processed.add(file);
        related.forEach(([f]) => processed.add(f));
        continue;
      }

      const allSharedImporters = new Set<string>();
      for (const [_, data] of related) {
        for (const imp of data.sharedImporters) allSharedImporters.add(makeRelativePath(imp, workspaceRoot));
      }

      const clusterScore = related.reduce((sum, [_, d]) => sum + d.score, 0);
      const parts = clusterFiles[0].split(/[/\\]/);
      let clusterName = parts.length > 1 ? parts[parts.length - 2] : getBasenameNoExt(clusterFiles[0]);
      clusterName = clusterName.charAt(0).toUpperCase() + clusterName.slice(1);

      const topImporters = Array.from(allSharedImporters).sort().slice(0, 3);
      const reason =
        topImporters.length > 0
          ? `Co-imported by: ${topImporters.map((i) => `\`${i}\``).join(', ')}${allSharedImporters.size > 3 ? ` (+${allSharedImporters.size - 3} more)` : ''}`
          : 'Frequently used together';

      clusters.push({
        name: clusterName,
        files: clusterFiles,
        reason,
        sharedImporters: Array.from(allSharedImporters).sort(),
        score: clusterScore,
      });

      processed.add(file);
      related.forEach(([f]) => processed.add(f));
    }
  }

  const sortedClusters = clusters.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  if (sortedClusters.length < 3 && fileList.length > 5) {
    const dirClusters = buildDirectoryClusters(allLinks, workspaceRoot, processed);
    for (const dc of dirClusters) {
      if (sortedClusters.length >= 7) break;
      if (!sortedClusters.some((c) => c.name === dc.name)) sortedClusters.push(dc);
    }
  }

  disambiguateClusterNames(sortedClusters);
  return sortedClusters.slice(0, 7);
}

// ── Directory analysis ───────────────────────────────────────

export interface DirInfo {
  files: string[];
  fileTypes: Map<string, number>;
  purpose?: string;
}

export function analyzeDirStructure(
  files: string[],
  _workspaceRoot: string,
): Map<string, DirInfo> {
  const structure = new Map<string, DirInfo>();

  for (const file of files) {
    const p = toPosix(file);
    const lastSlash = p.lastIndexOf('/');
    const dir = lastSlash >= 0 ? p.substring(0, lastSlash) : '.';

    if (!structure.has(dir)) structure.set(dir, { files: [], fileTypes: new Map() });
    const info = structure.get(dir)!;
    info.files.push(file);

    const ext = getExtension(file);
    info.fileTypes.set(ext, (info.fileTypes.get(ext) || 0) + 1);
  }

  for (const [dir, info] of structure.entries()) {
    const lastSlash = dir.lastIndexOf('/');
    const dirName = lastSlash >= 0 ? dir.substring(lastSlash + 1) : dir;
    info.purpose = inferDirPurpose(dirName);
  }

  return structure;
}

export function inferDirPurpose(dirName: string): string {
  const lower = dirName.toLowerCase();
  const purposes: Record<string, string> = {
    src: 'Source code',
    source: 'Source code',
    lib: 'Libraries',
    test: 'Tests',
    tests: 'Tests',
    spec: 'Tests',
    docs: 'Documentation',
    doc: 'Documentation',
    config: 'Configuration',
    utils: 'Utilities',
    helpers: 'Utilities',
    api: 'API layer',
    server: 'Server code',
    client: 'Client code',
    frontend: 'Frontend',
    backend: 'Backend',
    models: 'Data models',
    views: 'Views/UI',
    controllers: 'Controllers',
    services: 'Services',
    components: 'Components',
  };
  return purposes[lower] || 'General';
}

// ── Symbol callers ───────────────────────────────────────────

/**
 * Find callers of a given symbol from the dependency graph.
 * Returns shortened relative paths for display, capped at 5 + overflow.
 */
export function getSymbolCallers(
  symbolName: string,
  targetFile: string,
  allLinks: DependencyLink[],
  workspaceRoot: string,
): string[] {
  const callers = allLinks.filter((l) => {
    if (l.target !== targetFile) return false;
    const hasSymbol =
      l.symbols.includes(symbolName) ||
      l.symbols.includes('*') ||
      l.symbols.length === 0 ||
      l.type === 'import';
    if (!hasSymbol) return false;
    if (workspaceRoot && classifyFile(l.source, workspaceRoot) !== 'app') return false;
    return true;
  });

  const uniqueCallers = dedupe(callers, (l) => l.source);
  const sorted = uniqueCallers.sort((a, b) => a.source.localeCompare(b.source));

  const maxDisplay = 5;
  const result: string[] = [];

  for (let i = 0; i < Math.min(maxDisplay, sorted.length); i++) {
    const caller = sorted[i];
    const relPath = workspaceRoot
      ? makeRelativePath(caller.source, workspaceRoot)
      : getBasenameNoExt(caller.source);

    const segments = relPath.split('/');
    const shortened = segments.length > 2 ? segments.slice(-2).join('/') : relPath;
    result.push(shortened);
  }

  if (sorted.length > maxDisplay) {
    result.push(`(+${sorted.length - maxDisplay} more)`);
  }

  return result;
}

// ── Internal helpers ─────────────────────────────────────────

function disambiguateClusterNames(clusters: Array<{ name: string; files: string[] }>): void {
  const nameGroups = new Map<string, number[]>();
  for (let i = 0; i < clusters.length; i++) {
    const name = clusters[i].name;
    if (!nameGroups.has(name)) nameGroups.set(name, []);
    nameGroups.get(name)!.push(i);
  }

  for (const [name, indices] of nameGroups.entries()) {
    if (indices.length <= 1) continue;

    const pathContexts: string[] = [];
    for (const idx of indices) {
      const firstFile = clusters[idx].files[0] || '';
      const segments = firstFile.split('/');
      if (segments.length >= 2) {
        pathContexts.push(segments[segments.length - 2]);
      } else if (segments.length >= 1) {
        pathContexts.push(getBasenameNoExt(segments[0]));
      } else {
        pathContexts.push('');
      }
    }

    const uniqueContexts = new Set(pathContexts);
    if (uniqueContexts.size === pathContexts.length && !pathContexts.some((c) => c === '')) {
      for (let i = 0; i < indices.length; i++) {
        clusters[indices[i]].name = `${name} (${pathContexts[i]})`;
      }
    } else {
      for (let i = 0; i < indices.length; i++) {
        clusters[indices[i]].name = `${name} #${i + 1}`;
      }
    }
  }
}

function buildDirectoryClusters(
  allLinks: DependencyLink[],
  workspaceRoot: string,
  processedFiles: Set<string>,
): ModuleCluster[] {
  const dirGroups = new Map<string, string[]>();
  const allFiles = new Set(allLinks.flatMap((l) => [l.source, l.target]));

  for (const file of allFiles) {
    if (processedFiles.has(file)) continue;
    const relPath = makeRelativePath(file, workspaceRoot);
    if (isConfigOrToolingFile(relPath)) continue;

    const p = toPosix(relPath);
    const lastSlash = p.lastIndexOf('/');
    const dir = lastSlash >= 0 ? p.substring(0, lastSlash) : '.';

    if (!dirGroups.has(dir)) dirGroups.set(dir, []);
    dirGroups.get(dir)!.push(relPath);
  }

  return Array.from(dirGroups.entries())
    .filter(([_, files]) => files.length >= 3)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([dir, files]) => {
      const lastSlash = dir.lastIndexOf('/');
      const dirBasename = lastSlash >= 0 ? dir.substring(lastSlash + 1) : dir;
      return {
        name: dirBasename || 'Root',
        files: files.filter((f) => !isConfigOrToolingFile(f)).sort().slice(0, 8),
        reason: `Files in \`${dir}/\` directory`,
        sharedImporters: [],
        score: files.length,
      };
    });
}

function getExtension(filePath: string): string {
  const p = toPosix(filePath);
  const lastDot = p.lastIndexOf('.');
  return lastDot >= 0 ? p.substring(lastDot).toLowerCase() : '';
}

function getBasenameNoExt(filePath: string): string {
  const p = toPosix(filePath);
  const lastSlash = p.lastIndexOf('/');
  const name = lastSlash >= 0 ? p.substring(lastSlash + 1) : p;
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.substring(0, lastDot) : name;
}
