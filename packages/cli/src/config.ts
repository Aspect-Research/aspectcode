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

  /** Optimization settings. */
  optimize?: {
    provider?: string;
    model?: string;
    maxIterations?: number;
    acceptThreshold?: number;
    temperature?: number;
    maxTokens?: number;
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
