import type { ModelStats } from '@aspectcode/core';

/**
 * Minimal structured report returned by `runEmitters()`.
 * Intended to be serializable for a future `--json` CLI.
 */
export type EmitReport = {
  schemaVersion: string;
  wrote: Array<{ path: string; bytes: number }>;
  skipped?: Array<{ id: string; reason: string }>;
  stats: {
    files: number;
    edges: number;
    hubsTop: ModelStats['topHubs'];
  };
};
