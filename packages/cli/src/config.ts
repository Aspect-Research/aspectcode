/**
 * aspectcode CLI — config file handling.
 *
 * The CLI looks for `aspectcode.json` in the workspace root.
 */

import * as fs from 'fs';
import * as path from 'path';

export const CONFIG_FILE_NAME = 'aspectcode.json';

/** Shape of `aspectcode.json`. */
export interface AspectCodeConfig {
  /** Instructions mode (safe-only for now). */
  instructionsMode?: 'safe';

  /** Auto-update trigger mode. */
  updateRate?: 'manual' | 'onChange' | 'idle';

  /** Extra directories to exclude from analysis. */
  exclude?: string[];

  /**
   * Whether to generate the KB file (.aspect/).
   * Defaults to false. Set true to include KB generation in `generate`.
   */
  generateKb?: boolean;

  /** Automatically run optimize after each generate. */
  autoOptimize?: boolean;

  /**
   * List of output format IDs for instruction files.
   * When set, generates instructions for these AI tools (plus AGENTS.md always).
   * Supported: 'copilot', 'cursor', 'claudeCode', 'windsurf', 'cline',
   * 'gemini', 'aider', 'amazonq', 'codex'.
   */
  outputFormats?: string[];

  /** Optimization settings. */
  optimize?: OptimizeConfig;
}

/** Optimization-specific configuration in `aspectcode.json`. */
export interface OptimizeConfig {
  /** LLM provider to use: "openai" or "anthropic". */
  provider?: string;
  /** Model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514"). */
  model?: string;
  /** Max agent iterations (optimize → eval → refine). Default: 3. */
  maxIterations?: number;
  /** Minimum eval score (1–10) to accept a candidate. Default: 8. */
  acceptThreshold?: number;
  /** Sampling temperature (0–2). Default: 0.4. */
  temperature?: number;
  /** Max tokens for LLM response. Default: 4096. */
  maxTokens?: number;
}

export type RawAspectCodeConfig = Record<string, unknown>;

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

/**
 * Load raw `aspectcode.json` object from `root`.
 * Returns `undefined` if not found.
 */
export function loadRawConfig(root: string): RawAspectCodeConfig | undefined {
  const filePath = path.join(root, CONFIG_FILE_NAME);
  if (!fs.existsSync(filePath)) return undefined;

  const raw = fs.readFileSync(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse ${CONFIG_FILE_NAME}: invalid JSON`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Failed to parse ${CONFIG_FILE_NAME}: expected JSON object`);
  }

  return parsed as RawAspectCodeConfig;
}

/**
 * Save raw config object to `aspectcode.json`.
 */
export function saveRawConfig(root: string, config: RawAspectCodeConfig): void {
  const filePath = configPath(root);
  const content = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(filePath, content, 'utf-8');
}

/** Resolve the config file path for a given root. */
export function configPath(root: string): string {
  return path.join(root, CONFIG_FILE_NAME);
}
