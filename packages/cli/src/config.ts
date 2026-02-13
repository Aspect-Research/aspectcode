/**
 * @aspectcode/cli — config file handling.
 *
 * The CLI looks for `aspectcode.json` in the workspace root.
 * This replaces the extension's `.aspect/.settings.json`.
 */

import * as fs from 'fs';
import * as path from 'path';

export const CONFIG_FILE_NAME = 'aspectcode.json';

/** Shape of `aspectcode.json`. */
export interface AspectCodeConfig {
  /** Override output directory (relative to workspace root). */
  outDir?: string;

  /** Instructions mode (safe-only for now). */
  instructionsMode?: 'safe';

  /** Auto-update trigger mode. */
  updateRate?: 'manual' | 'onChange' | 'idle';

  /** Extra directories to exclude from analysis. */
  exclude?: string[];
}

/** Default config written by `aspectcode init`. */
export function defaultConfig(): AspectCodeConfig {
  return {
    instructionsMode: 'safe',
    updateRate: 'onChange',
  };
}

/**
 * Load `aspectcode.json` from `root`. Returns `undefined` if not found.
 * Throws on parse errors.
 */
export function loadConfig(root: string): AspectCodeConfig | undefined {
  const configPath = path.join(root, CONFIG_FILE_NAME);
  if (!fs.existsSync(configPath)) return undefined;

  const raw = fs.readFileSync(configPath, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as AspectCodeConfig & {
      autoRegenerateKb?: 'off' | 'onSave' | 'idle';
      instructionsMode?: 'safe' | 'permissive' | 'custom' | 'off';
    };

    // Backward compat: extension-style mode key.
    if (!parsed.updateRate && parsed.autoRegenerateKb) {
      parsed.updateRate =
        parsed.autoRegenerateKb === 'off'
          ? 'manual'
          : parsed.autoRegenerateKb === 'onSave'
            ? 'onChange'
            : 'idle';
    }

    // Safe-only policy.
    parsed.instructionsMode = 'safe';

    return parsed;
  } catch {
    throw new Error(`Failed to parse ${CONFIG_FILE_NAME}: invalid JSON`);
  }
}

/** Resolve the config file path for a given root. */
export function configPath(root: string): string {
  return path.join(root, CONFIG_FILE_NAME);
}
