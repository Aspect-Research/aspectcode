import * as path from 'path';
import type { AnalysisModel } from '@aspectcode/core';
import type { Emitter, EmitOptions, EmitResult, InstructionsMode } from '../emitter';
import type { EmitterHost } from '../host';
import {
  generateCanonicalContentForMode,
} from './content';
import { mergeAspectCodeSection, removeAspectCodeSection } from './merge';
import { resolveFormatTargets } from './formats';

async function readCustomInstructionsContent(host: EmitterHost, outDir: string): Promise<string | null> {
  const filePath = host.join(outDir, '.aspect', 'instructions.md');
  try {
    const text = await host.readFile(filePath);
    return text.trim();
  } catch {
    return null;
  }
}

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
      const outDir = options.outDir ?? options.workspaceRoot;
      const mode: InstructionsMode = options.instructionsMode ?? 'safe';

      const wrote: string[] = [];

      const aspectCodeContent =
        mode === 'custom'
          ? ((await readCustomInstructionsContent(host, outDir)) ?? generateCanonicalContentForMode('safe'))
          : generateCanonicalContentForMode(mode);

      // Resolve which format targets to write
      const targets = resolveFormatTargets(options.outputFormats ?? []);

      for (const target of targets) {
        const filePath = host.join(outDir, target.filePath);

        if (target.createParentDir) {
          await host.mkdirp(path.dirname(filePath));
        }

        const changed = await upsertWithMarkers(host, filePath, mode, aspectCodeContent, {
          defaultHeader: target.defaultHeader || undefined,
        });
        if (changed) wrote.push(filePath);
      }

      return { filesWritten: wrote };
    },
  };
}
