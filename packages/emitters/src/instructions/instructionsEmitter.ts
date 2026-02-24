/**
 * Instructions emitter — writes AGENTS.md with full-file ownership.
 *
 * No markers, no merge logic. The entire file is owned by AspectCode.
 * Content comes from the static generator or from the optimizer.
 */

import type { AnalysisModel } from '@aspectcode/core';
import type { Emitter, EmitOptions, EmitResult } from '../emitter';
import type { EmitterHost } from '../host';
import { generateCanonicalContentForMode } from './content';

export function createInstructionsEmitter(): Emitter {
  return {
    name: 'instructions',

    async emit(_model: AnalysisModel, host: EmitterHost, options: EmitOptions): Promise<EmitResult> {
      const outDir = options.outDir ?? options.workspaceRoot;
      const mode = options.instructionsMode ?? 'safe';
      const wrote: string[] = [];

      if (mode === 'off') {
        return { filesWritten: wrote };
      }

      // Generate canonical content — full-file, no markers
      const content = generateCanonicalContentForMode(mode, options.generateKb);

      const filePath = host.join(outDir, 'AGENTS.md');
      await host.writeFile(filePath, content);
      wrote.push(filePath);

      return { filesWritten: wrote };
    },
  };
}
