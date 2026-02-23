import * as path from 'path';
import type { AnalysisModel } from '@aspectcode/core';
import type { Emitter, EmitOptions, EmitResult, InstructionsMode } from '../emitter';
import type { EmitterHost } from '../host';
import { generateCanonicalContentForMode } from './content';
import { mergeAspectCodeSection, removeAspectCodeSection } from './merge';

async function readIfExists(host: EmitterHost, filePath: string): Promise<{ exists: boolean; text: string }> {
  try {
    const text = await host.readFile(filePath);
    return { exists: true, text };
  } catch {
    return { exists: false, text: '' };
  }
}

async function writeIfChanged(host: EmitterHost, filePath: string, content: string): Promise<boolean> {
  const existing = await readIfExists(host, filePath);
  if (existing.exists && existing.text === content) return false;
  await host.mkdirp(path.dirname(filePath));
  await host.writeFile(filePath, content);
  return true;
}

async function upsertWithMarkers(
  host: EmitterHost,
  filePath: string,
  mode: InstructionsMode,
  aspectContent: string,
  options: { defaultHeader?: string },
): Promise<boolean> {
  const { exists, text: existingContentRaw } = await readIfExists(host, filePath);
  const existingContent = existingContentRaw;

  if (mode === 'off') {
    if (!exists) return false;
    const newContent = removeAspectCodeSection(existingContent);
    if (newContent === existingContent) return false;
    await host.writeFile(filePath, newContent);
    return true;
  }

  let baseContent = existingContent;
  if (!exists && options.defaultHeader) {
    baseContent = options.defaultHeader;
  }

  const merged = mergeAspectCodeSection(baseContent, aspectContent);
  return writeIfChanged(host, filePath, merged);
}

export function createInstructionsEmitter(): Emitter {
  return {
    name: 'instructions',

    async emit(_model: AnalysisModel, host: EmitterHost, options: EmitOptions): Promise<EmitResult> {
      const workspaceRoot = options.workspaceRoot;
      const outDir = options.outDir ?? workspaceRoot;
      const mode: InstructionsMode = options.instructionsMode ?? 'safe';
      const kbAvailable = options.generateKb === true;

      const wrote: string[] = [];

      // AGENTS.md — the sole instruction output
      const filePath = host.join(outDir, 'AGENTS.md');
      const content = generateCanonicalContentForMode(mode, kbAvailable);

      const changed = await upsertWithMarkers(host, filePath, mode, content, {
        defaultHeader: '# AI Coding Agent Instructions\n\n',
      });
      if (changed) wrote.push(filePath);

      return { filesWritten: wrote };
    },
  };
}
