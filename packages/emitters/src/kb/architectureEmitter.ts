/**
 * Architecture emitter — generates `architecture.md` content.
 *
 * Pure function: takes data, returns a markdown string.
 * No I/O, no vscode.
 */

import type { DependencyLink } from '@aspectcode/core';
import { KB_SIZE_LIMITS, KB_SECTION_LIMITS } from './constants';
import { enforceLineBudget, makeRelativePath, dedupe } from './helpers';
import { classifyFile, isStructuralAppFile } from './classifiers';
import { detectEntryPointsWithContent } from './entryPoints';
import { analyzeDirStructure, inferDirPurpose } from './analyzers';
import { getKBEnrichments } from './detectors';
import { analyzeTestOrganization } from './conventions';

// ── Public API ───────────────────────────────────────────────

export interface ArchitectureEmitterInput {
  files: string[];
  depData: Map<string, { inDegree: number; outDegree: number }>;
  allLinks: DependencyLink[];
  fileContentCache: Map<string, string>;
  workspaceRoot: string;
  generatedAt: string;
}

/**
 * Build the full `architecture.md` content string.
 * Deterministic for the same inputs.
 */
export function buildArchitectureContent(input: ArchitectureEmitterInput): string {
  const { files, depData, allLinks, fileContentCache, workspaceRoot, generatedAt } = input;

  let content = '# Architecture\n\n';
  content += '_Read this first. Describes the project layout and "Do Not Break" zones._\n\n';

  if (files.length === 0) {
    content += '_No source files found._\n';
  } else {
    // Quick stats
    const totalEdges = allLinks.length;
    // Filter out self-references
    const circularLinks = allLinks.filter((l) => l.type === 'circular' && l.source !== l.target);
    const cycleCount = Math.ceil(circularLinks.length / 2);

    content += `**Files:** ${files.length} | **Dependencies:** ${totalEdges} | **Cycles:** ${cycleCount}\n\n`;

    // Filter to app files for architectural views
    const appFiles = files.filter((f) => classifyFile(f, workspaceRoot) === 'app');
    const testFiles = files.filter((f) => classifyFile(f, workspaceRoot) === 'test');

    // ── HIGH-RISK ARCHITECTURAL HUBS ───────────────────────
    const findingCounts = new Map<string, number>();
    const hubs = Array.from(depData.entries())
      .filter(([file]) => isStructuralAppFile(file, workspaceRoot))
      .map(([file, info]) => {
        const depScore = info.inDegree + info.outDegree;
        const fc = findingCounts.get(file) || 0;
        const hotspotScore = depScore * 2 + fc;
        return {
          file,
          inDegree: info.inDegree,
          outDegree: info.outDegree,
          totalDegree: depScore,
          findings: fc,
          hotspotScore,
        };
      })
      .filter((h) => h.totalDegree > 2 || h.findings > 0)
      .sort((a, b) => b.hotspotScore - a.hotspotScore || a.file.localeCompare(b.file))
      .slice(0, KB_SECTION_LIMITS.hubs);

    if (hubs.length > 0) {
      content += '## ⚠️ High-Risk Architectural Hubs\n\n';
      content += '> **These files are architectural load-bearing walls.**\n';
      content +=
        '> Modify with extreme caution. Do not change signatures without checking `map.md`.\n\n';

      content += '| Rank | File | Imports | Imported By | Risk |\n';
      content += '|------|------|---------|-------------|------|\n';

      for (let i = 0; i < hubs.length; i++) {
        const hub = hubs[i];
        const relPath = makeRelativePath(hub.file, workspaceRoot);
        const appImportCount = dedupe(
          allLinks
            .filter((l) => l.target === hub.file && l.source !== hub.file)
            .filter((l) => classifyFile(l.source, workspaceRoot) === 'app'),
          (l) => l.source,
        ).length;
        const risk =
          appImportCount > 8
            ? '🔴 High'
            : appImportCount > 4 || hub.findings > 3
              ? '🟡 Medium'
              : '🟢 Low';
        content += `| ${i + 1} | \`${relPath}\` | ${hub.outDegree} | ${appImportCount} | ${risk} |\n`;
      }
      content += '\n';

      // Hub Details & Blast Radius
      content += '### Hub Details & Blast Radius\n\n';
      content += '_Blast radius = direct dependents + their dependents (2 levels)._\n\n';

      for (let i = 0; i < Math.min(KB_SECTION_LIMITS.hubDetails, hubs.length); i++) {
        const hub = hubs[i];
        const relPath = makeRelativePath(hub.file, workspaceRoot);

        const directImporters = dedupe(
          allLinks
            .filter((l) => l.target === hub.file && l.source !== hub.file)
            .filter((l) => classifyFile(l.source, workspaceRoot) === 'app'),
          (l) => l.source,
        ).sort((a, b) => a.source.localeCompare(b.source));

        const secondLevelImporters = new Set<string>();
        for (const importer of directImporters.slice(0, 10)) {
          const indirectLinks = allLinks
            .filter(
              (l) =>
                l.target === importer.source &&
                l.source !== hub.file &&
                classifyFile(l.source, workspaceRoot) === 'app',
            )
            .sort((a, b) => a.source.localeCompare(b.source));
          for (const il of indirectLinks.slice(0, 3)) {
            secondLevelImporters.add(il.source);
          }
        }

        const directDependentCount = directImporters.length;
        const totalBlastRadius = directDependentCount + secondLevelImporters.size;

        content += `**${i + 1}. \`${relPath}\`** — Blast radius: ${totalBlastRadius} files\n`;
        content += `   - Direct dependents: ${directDependentCount}\n`;
        content += `   - Indirect dependents: ~${secondLevelImporters.size}\n`;

        if (directImporters.length > 0) {
          const shownCount = Math.min(5, directImporters.length);
          content += `\n   Imported by (${directDependentCount} files):\n`;
          for (const imp of directImporters.slice(0, shownCount)) {
            const impRel = makeRelativePath(imp.source, workspaceRoot);
            content += `   - \`${impRel}\`\n`;
          }
          if (directImporters.length > shownCount) {
            content += `   - _...and ${directImporters.length - shownCount} more_\n`;
          }
        }
        content += '\n';
      }
    }

    // ── ENTRY POINTS ───────────────────────────────────────
    const contentBasedEntryPoints = detectEntryPointsWithContent(
      appFiles,
      workspaceRoot,
      fileContentCache,
    );

    if (contentBasedEntryPoints.length > 0) {
      content += '## Entry Points\n\n';
      content +=
        '_Where code execution begins. Categorized by type with detection confidence._\n\n';

      const runtimeEntries = contentBasedEntryPoints.filter((e) => e.category === 'runtime');
      const toolingEntries = contentBasedEntryPoints.filter((e) => e.category === 'tooling');
      const barrelEntries = contentBasedEntryPoints.filter((e) => e.category === 'barrel');

      if (runtimeEntries.length > 0) {
        content += '### Runtime Entry Points\n\n';
        content += '_Server handlers, API routes, application entry._\n\n';
        const topRuntime = runtimeEntries.slice(0, KB_SECTION_LIMITS.entryPoints);
        for (const entry of topRuntime) {
          const confIcon =
            entry.confidence === 'high' ? '🟢' : entry.confidence === 'medium' ? '🟡' : '🟠';
          content += `- ${confIcon} \`${entry.path}\`: ${entry.reason}\n`;
        }
        if (runtimeEntries.length > KB_SECTION_LIMITS.entryPoints) {
          content += `- _...and ${runtimeEntries.length - KB_SECTION_LIMITS.entryPoints} more_\n`;
        }
        content += '\n';
      }

      if (toolingEntries.length > 0) {
        content += '### Runnable Scripts / Tooling\n\n';
        content += '_CLI tools, build scripts, standalone utilities._\n\n';
        const topTooling = toolingEntries.slice(0, 5);
        for (const entry of topTooling) {
          const confIcon =
            entry.confidence === 'high' ? '🟢' : entry.confidence === 'medium' ? '🟡' : '🟠';
          content += `- ${confIcon} \`${entry.path}\`: ${entry.reason}\n`;
        }
        if (toolingEntries.length > 5) {
          content += `- _...and ${toolingEntries.length - 5} more_\n`;
        }
        content += '\n';
      }

      if (barrelEntries.length > 0) {
        content += '### Barrel/Index Exports\n\n';
        content += '_Re-export hubs that aggregate module exports._\n\n';
        const topBarrels = barrelEntries.slice(0, 5);
        for (const entry of topBarrels) {
          content += `- 🟡 \`${entry.path}\`: ${entry.reason}\n`;
        }
        if (barrelEntries.length > 5) {
          content += `- _...and ${barrelEntries.length - 5} more_\n`;
        }
        content += '\n';
      }
    }

    // ── DIRECTORY LAYOUT ───────────────────────────────────
    const dirStructure = analyzeDirStructure(appFiles, workspaceRoot);
    const topDirs = Array.from(dirStructure.entries())
      .filter(([, info]) => info.files.length >= 2)
      .sort((a, b) => b[1].files.length - a[1].files.length || a[0].localeCompare(b[0]))
      .slice(0, 12);

    if (topDirs.length > 0) {
      content += '## Directory Layout\n\n';
      content += '| Directory | Files | Purpose |\n';
      content += '|-----------|-------|--------|\n';

      for (const [dir, info] of topDirs) {
        const relDir = makeRelativePath(dir, workspaceRoot) || '.';
        const purpose = info.purpose || inferDirPurpose(relDir);
        content += `| \`${relDir}/\` | ${info.files.length} | ${purpose} |\n`;
      }
      content += '\n';
    }

    // ── CIRCULAR DEPENDENCIES ──────────────────────────────
    const appCircularLinks = circularLinks
      .filter(
        (l) =>
          isStructuralAppFile(l.source, workspaceRoot) &&
          isStructuralAppFile(l.target, workspaceRoot) &&
          l.source !== l.target,
      )
      .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));

    if (appCircularLinks.length > 0) {
      content += '## ⚠️ Circular Dependencies\n\n';
      content += '_Bidirectional imports that create tight coupling._\n\n';

      const processedPairs = new Set<string>();
      let cycleIndex = 0;

      for (const link of appCircularLinks) {
        if (cycleIndex >= 5) break;
        if (link.source === link.target) continue;

        const pairKey = [link.source, link.target].sort().join('::');
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        const sourceRel = makeRelativePath(link.source, workspaceRoot);
        const targetRel = makeRelativePath(link.target, workspaceRoot);

        content += `- \`${sourceRel}\` ↔ \`${targetRel}\`\n`;
        cycleIndex++;
      }
      content += '\n';
    }

    // ── GLOBAL STATE ───────────────────────────────────────
    const globalStateFindings = getKBEnrichments(
      'GLOBAL_STATE',
      appFiles,
      workspaceRoot,
      fileContentCache,
    ).filter((f) => classifyFile(f.file, workspaceRoot) === 'app');

    if (globalStateFindings.length > 0) {
      content += '## Shared State\n\n';
      content += '_Global/singleton state locations. Consider thread-safety and testability._\n\n';

      for (const finding of globalStateFindings.slice(0, 8)) {
        const relPath = makeRelativePath(finding.file, workspaceRoot);
        content += `- \`${relPath}\`: ${finding.message}\n`;
      }
      if (globalStateFindings.length > 8) {
        content += `- _...and ${globalStateFindings.length - 8} more_\n`;
      }
      content += '\n';
    }

    // ── TESTS SUMMARY ──────────────────────────────────────
    const testInfo = analyzeTestOrganization(
      testFiles.length > 0 ? testFiles : files,
      workspaceRoot,
    );
    if (testInfo.testFiles.length > 0) {
      content += '## Tests\n\n';
      content += `**Test files:** ${testInfo.testFiles.length}`;
      if (testInfo.testDirs.length > 0) {
        content += ` | **Dirs:** ${testInfo.testDirs.slice(0, 2).join(', ')}`;
      }
      content += '\n\n';
    }
  }

  content += `\n_Generated: ${generatedAt}_\n`;

  return enforceLineBudget(content, KB_SIZE_LIMITS.architecture, 'architecture.md', generatedAt);
}
