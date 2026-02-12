/**
 * Map emitter — generates `map.md` content.
 *
 * Pure function: takes data, returns a markdown string.
 * No I/O, no vscode.
 */

import * as path from 'path';
import type { DependencyLink } from '@aspectcode/core';
import { KB_SIZE_LIMITS } from './constants';
import { enforceLineBudget, makeRelativePath } from './helpers';
import { classifyFile } from './classifiers';
import { detectEntryPointsWithContent } from './entryPoints';
import { getKBEnrichments } from './detectors';
import { extractModelSignature, extractFileSymbolsWithSignatures } from './symbols';
import type { LoadedGrammars } from './symbols';
import { analyzeFileNaming, analyzeFunctionNaming, detectFrameworkPatterns } from './conventions';

// ── Public API ───────────────────────────────────────────────

export interface MapEmitterInput {
  files: string[];
  depData: Map<string, { inDegree: number; outDegree: number }>;
  allLinks: DependencyLink[];
  grammars: LoadedGrammars | null | undefined;
  fileContentCache: Map<string, string>;
  workspaceRoot: string;
  generatedAt: string;
}

/**
 * Build the full `map.md` content string.
 * Deterministic for the same inputs.
 */
export function buildMapContent(input: MapEmitterInput): string {
  const { files, depData: _depData, allLinks, grammars, fileContentCache, workspaceRoot, generatedAt } =
    input;

  let content = '# Map\n\n';
  content +=
    '_Symbol index with signatures and conventions. Use to find types, functions, and coding patterns._\n\n';

  const appFiles = files.filter((f) => classifyFile(f, workspaceRoot) === 'app');

  // ── DATA MODELS ──────────────────────────────────────────
  const dataModels = getKBEnrichments('DATA_MODEL', appFiles, workspaceRoot, fileContentCache);

  if (dataModels.length > 0) {
    content += '## Data Models\n\n';
    content += '_Core data structures. Check these before modifying data handling._\n\n';

    // Group by type
    const ormModels = dataModels.filter(
      (f) =>
        f.message.includes('ORM') || f.message.includes('Entity') || f.message.includes('SQLModel'),
    );
    const dataClasses = dataModels.filter(
      (f) =>
        f.message.includes('Data Class') ||
        f.message.includes('dataclass') ||
        f.message.includes('Pydantic') ||
        f.message.includes('BaseModel'),
    );
    const interfaces = dataModels.filter(
      (f) =>
        f.message.includes('Interface') ||
        f.message.includes('Type Alias') ||
        f.message.includes('type '),
    );
    const other = dataModels.filter(
      (f) => !ormModels.includes(f) && !dataClasses.includes(f) && !interfaces.includes(f),
    );

    // Pre-extract model signatures
    const allModelsToExtract = [
      ...ormModels.slice(0, 15).map((m) => ({ model: m, type: 'orm' as const })),
      ...dataClasses.slice(0, 15).map((m) => ({ model: m, type: 'dataclass' as const })),
      ...interfaces.slice(0, 15).map((m) => ({ model: m, type: 'interface' as const })),
    ];

    const signatureMap = new Map<string, { modelInfo: string; signature: string | null }>();
    for (const { model } of allModelsToExtract) {
      const modelInfo = model.message.replace('Data model: ', '').replace('ORM model: ', '');
      const signature = extractModelSignature(model.file, modelInfo, fileContentCache);
      signatureMap.set(model.file, { modelInfo, signature });
    }

    if (ormModels.length > 0) {
      content += '### ORM / Database Models\n\n';
      for (const model of ormModels.slice(0, 15)) {
        const relPath = makeRelativePath(model.file, workspaceRoot);
        const data = signatureMap.get(model.file);
        if (data?.signature) {
          content += `**\`${relPath}\`**: \`${data.signature}\`\n\n`;
        } else {
          const modelInfo = model.message.replace('Data model: ', '').replace('ORM model: ', '');
          content += `**\`${relPath}\`**: ${modelInfo}\n\n`;
        }
      }
    }

    if (dataClasses.length > 0) {
      content += '### Pydantic / Data Classes\n\n';
      for (const model of dataClasses.slice(0, 15)) {
        const relPath = makeRelativePath(model.file, workspaceRoot);
        const data = signatureMap.get(model.file);
        if (data?.signature) {
          content += `**\`${relPath}\`**: \`${data.signature}\`\n\n`;
        } else {
          let modelInfo = model.message.replace('Data model: ', '');
          modelInfo = modelInfo.replace(/\s*\([^)]+\)\s*-\s*\w+\s*$/, '');
          content += `**\`${relPath}\`**: ${modelInfo}\n\n`;
        }
      }
    }

    if (interfaces.length > 0) {
      content += '### TypeScript Interfaces & Types\n\n';
      for (const model of interfaces.slice(0, 15)) {
        const relPath = makeRelativePath(model.file, workspaceRoot);
        const data = signatureMap.get(model.file);
        if (data?.signature) {
          content += `**\`${relPath}\`**: \`${data.signature}\`\n\n`;
        } else {
          const modelInfo = model.message.replace('Data model: ', '');
          content += `**\`${relPath}\`**: ${modelInfo}\n\n`;
        }
      }
    }

    if (other.length > 0) {
      content += '### Other Data Structures\n\n';
      for (const model of other.slice(0, 10)) {
        const relPath = makeRelativePath(model.file, workspaceRoot);
        content += `- \`${relPath}\`: ${model.message}\n`;
      }
      content += '\n';
    }
  }

  // ── SYMBOL INDEX ─────────────────────────────────────────
  const relevantFiles = new Set<string>();
  for (const link of allLinks) {
    relevantFiles.add(link.source);
    relevantFiles.add(link.target);
  }

  if (relevantFiles.size > 0) {
    content += '## Symbol Index\n\n';
    content += '_Functions, classes, and exports with call relationships._\n\n';

    // Build set of architecturally important files
    const archFiles = new Set<string>();
    for (const model of dataModels) {
      if (classifyFile(model.file, workspaceRoot) === 'app') {
        archFiles.add(model.file);
      }
    }
    const entryPointFindings = detectEntryPointsWithContent(
      appFiles,
      workspaceRoot,
      fileContentCache,
    ).map((e) => ({ file: path.join(workspaceRoot, e.path), message: e.reason }));
    const integrationFindings = getKBEnrichments(
      'EXTERNAL_INTEGRATION',
      appFiles,
      workspaceRoot,
      fileContentCache,
    );
    for (const f of entryPointFindings) {
      if (classifyFile(f.file, workspaceRoot) === 'app') archFiles.add(f.file);
    }
    for (const f of integrationFindings) {
      if (classifyFile(f.file, workspaceRoot) === 'app') archFiles.add(f.file);
    }

    // Score files by importance
    const fileScores = new Map<string, number>();
    for (const file of relevantFiles) {
      const kind = classifyFile(file, workspaceRoot);
      if (kind === 'third_party') continue;

      const base = kind === 'test' ? -10 : 0;
      const archBoost = archFiles.has(file) ? 25 : 0;
      const outLinks = allLinks.filter((l) => l.source === file).length;
      const inLinks = allLinks.filter((l) => l.target === file).length;

      const score = base + archBoost + inLinks * 2 + outLinks;
      fileScores.set(file, score);
    }

    const sortedFiles = Array.from(fileScores.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 40)
      .map(([file]) => file);

    // Extract symbols
    const symbolExtractionResults: Array<{
      file: string;
      symbols: Array<{ name: string; kind: string; signature: string | null; calledBy: string[] }>;
    }> = [];
    for (const file of sortedFiles) {
      const symbols = extractFileSymbolsWithSignatures(
        file,
        allLinks,
        workspaceRoot,
        grammars,
        fileContentCache,
      );
      symbolExtractionResults.push({ file, symbols });
    }

    for (const { file, symbols } of symbolExtractionResults) {
      if (symbols.length === 0) continue;

      const relPath = makeRelativePath(file, workspaceRoot);

      content += `### \`${relPath}\`\n\n`;
      content += '| Symbol | Kind | Signature | Used In (files) |\n';
      content += '|--------|------|-----------|----------------|\n';

      for (const symbol of symbols.slice(0, 12)) {
        const sig = symbol.signature ? `\`${symbol.signature}\`` : '—';
        const sortedCallers = [...symbol.calledBy].sort();
        const usedIn =
          sortedCallers
            .slice(0, 2)
            .map((c) => `\`${c}\``)
            .join(', ') || '—';
        content += `| \`${symbol.name}\` | ${symbol.kind} | ${sig} | ${usedIn} |\n`;
      }

      if (symbols.length > 12) {
        content += `\n_+${symbols.length - 12} more symbols_\n`;
      }
      content += '\n';
    }
  }

  // ── CONVENTIONS ──────────────────────────────────────────
  if (appFiles.length > 0) {
    content += '---\n\n';
    content += '## Conventions\n\n';
    content += '_Naming patterns and styles. Follow these for consistency._\n\n';

    // File naming
    const fileNaming = analyzeFileNaming(appFiles, workspaceRoot);
    if (fileNaming.patterns.length > 0) {
      content += '### File Naming\n\n';
      content += '| Pattern | Example | Count |\n';
      content += '|---------|---------|-------|\n';
      for (const pattern of fileNaming.patterns.slice(0, 4)) {
        content += `| ${pattern.style} | \`${pattern.example}\` | ${pattern.count} |\n`;
      }
      content += '\n';
      if (fileNaming.dominant) {
        content += `**Use:** ${fileNaming.dominant} for new files.\n\n`;
      }
    }

    // Function naming patterns
    const funcNaming = analyzeFunctionNaming(appFiles, fileContentCache);
    if (funcNaming.patterns.length > 0) {
      content += '### Function Naming\n\n';
      for (const pattern of funcNaming.patterns.slice(0, 5)) {
        content += `- \`${pattern.pattern}\` → \`${pattern.example}\` (${pattern.usage})\n`;
      }
      content += '\n';
    }

    // Framework patterns
    const frameworkPatterns = detectFrameworkPatterns(appFiles, workspaceRoot);
    if (frameworkPatterns.length > 0) {
      content += '### Framework Patterns\n\n';
      for (const fw of frameworkPatterns) {
        content += `**${fw.name}:**\n`;
        for (const pattern of fw.patterns.slice(0, 3)) {
          content += `- ${pattern}\n`;
        }
        content += '\n';
      }
    }
  }

  content += `\n_Generated: ${generatedAt}_\n`;

  return enforceLineBudget(content, KB_SIZE_LIMITS.map, 'map.md', generatedAt);
}
