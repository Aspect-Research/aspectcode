/**
 * aspectcode CLI — config types (optional overrides only).
 *
 * The CLI auto-detects everything. Config is never auto-created.
 * `aspectcode.json` is only read if it exists — provides optional overrides.
 */

import * as fs from 'fs';
import * as path from 'path';

export const CONFIG_FILE_NAME = 'aspectcode.json';

/** Shape of optional `aspectcode.json` overrides. */
export interface AspectCodeConfig {
  /** Extra directories to exclude from analysis. */
  exclude?: string[];

  /** AGENTS.md ownership: 'full' overwrites the file, 'section' uses markers. */
  ownership?: 'full' | 'section';

  /** Optimization settings. */
  optimize?: {
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };

  /** Evaluator settings (probe-based quality assessment). */
  evaluate?: {
    /** Enable evaluator. Default: true when an API key is available. */
    enabled?: boolean;
    /** Maximum probes per run. Default: 10. */
    maxProbes?: number;
    /** Harvest prompts from AI tool history. Default: true. */
    harvestPrompts?: boolean;
    /** Specific sources to harvest from. Default: all available. */
    harvestSources?: string[];
  };
}

/**
 * Load `aspectcode.json` from `root`. Returns `undefined` if not found.
 * Never auto-creates. Throws on parse errors.
 */
export function loadConfig(root: string): AspectCodeConfig | undefined {
  const configPath = path.join(root, CONFIG_FILE_NAME);
  if (!fs.existsSync(configPath)) return undefined;

  const raw = fs.readFileSync(configPath, 'utf-8');
  try {
    return JSON.parse(raw) as AspectCodeConfig;
  } catch {
    throw new Error(`Failed to parse ${CONFIG_FILE_NAME}: invalid JSON`);
  }
}

/**
 * Save a partial config update to `aspectcode.json`.
 * Merges with any existing config. Creates the file if it doesn't exist.
 */
export function saveConfig(root: string, update: Partial<AspectCodeConfig>): void {
  const configPath = path.join(root, CONFIG_FILE_NAME);
  let existing: AspectCodeConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as AspectCodeConfig;
    } catch {
      // Overwrite malformed config
    }
  }
  const merged = { ...existing, ...update };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n');
}
