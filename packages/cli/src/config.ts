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

  /** Which assistant instructions to manage. */
  assistants?: {
    copilot?: boolean;
    cursor?: boolean;
    claude?: boolean;
    other?: boolean;
  };

  /** Instructions merge mode. */
  instructionsMode?: 'safe' | 'permissive' | 'custom' | 'off';

  /** Extra directories to exclude from analysis. */
  exclude?: string[];
}

/** Default config written by `aspectcode init`. */
export function defaultConfig(): AspectCodeConfig {
  return {
    assistants: {
      copilot: true,
      cursor: false,
      claude: false,
      other: false,
    },
    instructionsMode: 'safe',
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
    return JSON.parse(raw) as AspectCodeConfig;
  } catch {
    throw new Error(`Failed to parse ${CONFIG_FILE_NAME}: invalid JSON`);
  }
}

/** Resolve the config file path for a given root. */
export function configPath(root: string): string {
  return path.join(root, CONFIG_FILE_NAME);
}
