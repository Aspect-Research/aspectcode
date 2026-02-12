/**
 * Emitter interface — the contract for all artifact generators.
 *
 * Each emitter takes an AnalysisModel + options and writes files
 * via the EmitterHost abstraction. Emitters MUST produce deterministic
 * output for the same input (modulo `generatedAt` timestamps).
 */

import type { AnalysisModel } from '@aspectcode/core';
import type { EmitterHost } from './host';

// ── Options ──────────────────────────────────────────────────

/** Flags controlling which assistant instruction files to emit. */
export interface AssistantFlags {
  copilot?: boolean;
  cursor?: boolean;
  claude?: boolean;
  other?: boolean;
}

/** Mode for instruction content generation. */
export type InstructionsMode = 'safe' | 'permissive' | 'custom' | 'off';

/** Options passed to every emitter. */
export interface EmitOptions {
  /** Absolute path to the workspace root. */
  workspaceRoot: string;

  /**
   * Absolute path to the output root where generated artifacts are written.
   *
   * Defaults to `workspaceRoot`.
   *
   * This allows generating into a temp directory (tests/CLI/GitHub Action)
   * without depending on CWD or VS Code workspace filesystem roots.
   */
  outDir?: string;

  /**
   * ISO-8601 timestamp to embed in outputs.
   * Defaults to `new Date().toISOString()` if omitted.
   * Pass a fixed value in tests for determinism.
   */
  generatedAt?: string;

  /** Which assistant instruction files to generate. */
  assistants?: AssistantFlags;

  /** Instruction content mode. */
  instructionsMode?: InstructionsMode;

  /** Pre-loaded file contents (avoids re-reading from disk). */
  fileContents?: Map<string, string>;
}

// ── Result ───────────────────────────────────────────────────

/** Result returned by an emitter after writing artifacts. */
export interface EmitResult {
  /** Absolute paths of all files written or updated. */
  filesWritten: string[];
}

// ── Emitter interface ────────────────────────────────────────

/** A named artifact generator. */
export interface Emitter {
  /** Human-readable name (e.g. "aspect-kb", "instructions"). */
  readonly name: string;

  /**
   * Generate and write artifacts.
   *
   * @param model   The analysis model to consume.
   * @param host    File I/O abstraction.
   * @param options Generation options.
   * @returns       Paths of all files written.
   */
  emit(
    model: AnalysisModel,
    host: EmitterHost,
    options: EmitOptions,
  ): Promise<EmitResult>;
}
