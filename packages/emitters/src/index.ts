/**
 * @aspectcode/emitters — public API surface.
 *
 * Artifact emitters that consume an AnalysisModel and write KB files,
 * instruction files, and manifests. No vscode dependency.
 */

// ── Host ─────────────────────────────────────────────────────

export type { EmitterHost } from './host';
export { createNodeEmitterHost } from './host';

// ── Emitter interface ────────────────────────────────────────

export type {
  Emitter,
  EmitResult,
  EmitOptions,
  AssistantFlags,
  InstructionsMode,
} from './emitter';

export type { EmitReport } from './report';

// ── Manifest ─────────────────────────────────────────────────

export type { Manifest, ManifestStats } from './manifest';

// ── KB helpers ───────────────────────────────────────────────

export * from './kb';

// ── Instructions ────────────────────────────────────────────

export * from './instructions';

// ── runEmitters ──────────────────────────────────────────────

import type { AnalysisModel } from '@aspectcode/core';
import { computeModelStats } from '@aspectcode/core';
import type { EmitterHost } from './host';
import type { EmitOptions } from './emitter';
import type { EmitReport } from './report';
import { GenerationTransaction } from './transaction';

/**
 * Run all built-in emitters in sequence.
 *
 * Returns the combined list of files written.
 */
export async function runEmitters(
  model: AnalysisModel,
  host: EmitterHost,
  options: EmitOptions,
): Promise<EmitReport> {
  const _generatedAt =
    options.generatedAt ?? new Date().toISOString();
  const outDir = options.outDir ?? options.workspaceRoot;
  const opts: EmitOptions = { ...options, generatedAt: _generatedAt, outDir };

  const wrote: Array<{ path: string; bytes: number }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  // ── KB + manifest transaction (manifest written last) ─────
  const tx = new GenerationTransaction(host);
  const txHost = tx.host;

  const { createKBEmitter } = await import('./kb/kbEmitter');
  const kb = createKBEmitter();
  await kb.emit(model, txHost, opts);

  const { writeManifest: writeM } = await import('./manifest');
  await writeM(model, txHost, outDir, _generatedAt);

  await tx.commit();
  wrote.push(...tx.getWrites().map((w) => ({ path: w.finalPath, bytes: w.bytes })));

  // ── Instructions (outside the .aspect transaction) ─────────
  const assistants = opts.assistants ?? {};
  const wantsAnyInstructions = Boolean(
    assistants.copilot || assistants.cursor || assistants.claude || assistants.other,
  );
  if (wantsAnyInstructions) {
    const { createInstructionsEmitter } = await import('./instructions/instructionsEmitter');
    const instructions = createInstructionsEmitter();

    // Wrap host to capture bytes for report
    const recordingHost: EmitterHost = {
      ...host,
      writeFile: async (filePath: string, content: string) => {
        const bytes = Buffer.byteLength(content, 'utf8');
        await host.writeFile(filePath, content);
        wrote.push({ path: filePath, bytes });
      },
    };

    await instructions.emit(model, recordingHost, opts);
  } else {
    skipped.push({ id: 'instructions', reason: 'No assistants enabled' });
  }

  const stats = computeModelStats(model, 10);

  return {
    schemaVersion: model.schemaVersion,
    wrote,
    skipped: skipped.length > 0 ? skipped : undefined,
    stats: {
      files: stats.fileCount,
      edges: stats.edgeCount,
      hubsTop: stats.topHubs,
    },
  };
}
