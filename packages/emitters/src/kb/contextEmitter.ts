/**
 * Context emitter — generates `context.md` content.
 *
 * Pure function: takes data, returns a markdown string.
 * No I/O, no vscode.
 */

import type { DependencyLink } from '@aspectcode/core';
import { KB_SIZE_LIMITS } from './constants';
import { enforceLineBudget, makeRelativePath } from './helpers';
import { classifyFile, isStructuralAppFile } from './classifiers';
import { detectEntryPointsWithContent } from './entryPoints';
import {
  findModuleClusters,
  calculateCentralityScores,
  findDependencyChains,
  detectLayerFlows,
} from './analyzers';
import { getKBEnrichments } from './detectors';

// ── Public API ───────────────────────────────────────────────

export interface ContextEmitterInput {
  files: string[];
  allLinks: DependencyLink[];
  fileContentCache: Map<string, string>;
  workspaceRoot: string;
  generatedAt: string;
}

/**
 * Build the full `context.md` content string.
 * Deterministic for the same inputs.
 */
export function buildContextContent(input: ContextEmitterInput): string {
  const { files, allLinks, fileContentCache, workspaceRoot, generatedAt } = input;

  let content = '# Context\n\n';
  content +=
    '_Data flow and co-location context. Use to understand which files work together._\n\n';

  // Filter links to only include app-to-app dependencies
  const appLinks = allLinks.filter(
    (l) =>
      classifyFile(l.source, workspaceRoot) === 'app' &&
      classifyFile(l.target, workspaceRoot) === 'app',
  );
  const appFiles = files.filter((f) => classifyFile(f, workspaceRoot) === 'app');

  if (appLinks.length === 0) {
    content += '_No dependency data available. Run examination first._\n';
  } else {
    // ── MODULE CLUSTERS ────────────────────────────────────
    const clusters = findModuleClusters(appLinks, workspaceRoot);
    if (clusters.length > 0) {
      content += '## Module Clusters\n\n';
      content +=
        '_Files commonly imported together. Editing one likely requires editing the others._\n\n';

      for (const cluster of clusters.slice(0, 6)) {
        content += `### ${cluster.name}\n\n`;
        content += `_${cluster.reason}_\n\n`;
        for (const file of cluster.files.slice(0, 5)) {
          content += `- \`${file}\`\n`;
        }
        if (cluster.files.length > 5) {
          content += `- _...and ${cluster.files.length - 5} more_\n`;
        }
        content += '\n';
      }
    }

    // ── CRITICAL FLOWS ─────────────────────────────────────
    const centralityScores = calculateCentralityScores(appLinks);
    const topModules = Array.from(centralityScores.entries())
      .filter(([file]) => isStructuralAppFile(file, workspaceRoot))
      .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
      .slice(0, 8);

    if (topModules.length > 0) {
      content += '## Critical Flows\n\n';
      content += '_Most central modules by connectivity. Changes here propagate widely._\n\n';

      content += '| Module | Callers | Dependencies |\n';
      content += '|--------|---------|--------------|\n';
      for (const [file, stats] of topModules) {
        const relPath = makeRelativePath(file, workspaceRoot);
        content += `| \`${relPath}\` | ${stats.inDegree} | ${stats.outDegree} |\n`;
      }
      content += '\n';
    }

    // ── DEPENDENCY CHAINS ──────────────────────────────────
    const entryPointsForChains = detectEntryPointsWithContent(
      appFiles,
      workspaceRoot,
      fileContentCache,
    );
    const runtimeEntryPaths = entryPointsForChains
      .filter((e) => e.category === 'runtime')
      .map((e) => e.path);

    const chains = findDependencyChains(appLinks, workspaceRoot, 4, runtimeEntryPaths);
    if (chains.length > 0) {
      const sortedChains = chains
        .map((c) => ({ chain: c, depth: c.split(' → ').length }))
        .sort((a, b) => b.depth - a.depth || a.chain.localeCompare(b.chain))
        .slice(0, 8)
        .map((c) => c.chain);

      content += '## Dependency Chains\n\n';
      content +=
        '_Top data/call flow paths. Shows how changes propagate through the codebase._\n\n';

      for (let i = 0; i < sortedChains.length && i < 8; i++) {
        const chain = sortedChains[i];
        const depth = chain.split(' → ').length;
        content += `**Chain ${i + 1}** (${depth} modules):\n`;
        content += `\`\`\`\n${chain}\n\`\`\`\n\n`;
      }
    }

    // ── EXTERNAL INTEGRATIONS ──────────────────────────────
    const externalIntegrations = getKBEnrichments(
      'EXTERNAL_INTEGRATION',
      appFiles,
      workspaceRoot,
      fileContentCache,
    ).filter((f) => classifyFile(f.file, workspaceRoot) === 'app');

    if (externalIntegrations.length > 0) {
      content += '## External Integrations\n\n';
      content += '_Connections to external services._\n\n';

      const databases = externalIntegrations.filter(
        (f) =>
          f.message.includes('Database') || f.message.includes('DB') || f.message.includes('SQL'),
      );
      const httpClients = externalIntegrations.filter(
        (f) =>
          f.message.includes('HTTP') || f.message.includes('API') || f.message.includes('fetch'),
      );
      const queues = externalIntegrations.filter(
        (f) =>
          f.message.includes('Queue') || f.message.includes('Kafka') || f.message.includes('Redis'),
      );
      const other = externalIntegrations.filter(
        (f) => !databases.includes(f) && !httpClients.includes(f) && !queues.includes(f),
      );

      if (databases.length > 0) {
        content += '**Database:**\n';
        for (const db of databases.slice(0, 3)) {
          const relPath = makeRelativePath(db.file, workspaceRoot);
          content += `- \`${relPath}\`: ${db.message}\n`;
        }
        content += '\n';
      }

      if (httpClients.length > 0) {
        content += '**HTTP/API Clients:**\n';
        for (const http of httpClients.slice(0, 3)) {
          const relPath = makeRelativePath(http.file, workspaceRoot);
          content += `- \`${relPath}\`: ${http.message}\n`;
        }
        content += '\n';
      }

      if (queues.length > 0) {
        content += '**Message Queues:**\n';
        for (const q of queues.slice(0, 3)) {
          const relPath = makeRelativePath(q.file, workspaceRoot);
          content += `- \`${relPath}\`: ${q.message}\n`;
        }
        content += '\n';
      }

      if (other.length > 0) {
        content += '**Other:**\n';
        for (const o of other.slice(0, 3)) {
          const relPath = makeRelativePath(o.file, workspaceRoot);
          content += `- \`${relPath}\`: ${o.message}\n`;
        }
        content += '\n';
      }
    }

    // ── REQUEST FLOW PATTERN ───────────────────────────────
    const layerFlows = detectLayerFlows(appFiles, appLinks, workspaceRoot);
    if (layerFlows.length > 0) {
      content += '## Request Flow Pattern\n\n';
      content += '_How a typical request flows through the architecture._\n\n';

      for (const layer of layerFlows) {
        content += `**${layer.name}:**\n`;
        content += `\`\`\`\n${layer.flow}\n\`\`\`\n\n`;
      }
    }

    // ── QUICK REFERENCE ────────────────────────────────────
    content += '---\n\n';
    content += '## Quick Reference\n\n';
    content += '**"What files work together for feature X?"**\n';
    content += '→ Check Module Clusters above.\n\n';
    content += '**"Where does data flow from this endpoint?"**\n';
    content += '→ Check Critical Flows and Dependency Chains.\n\n';
    content += '**"Where are external connections?"**\n';
    content += '→ Check External Integrations.\n';
  }

  content += `\n\n_Generated: ${generatedAt}_\n`;

  return enforceLineBudget(content, KB_SIZE_LIMITS.context, 'context.md', generatedAt);
}
