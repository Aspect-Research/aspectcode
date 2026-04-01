/**
 * aspectcode CLI — config types (optional overrides only).
 *
 * Project-level settings live in `aspectcode.json` (committed to repo).
 * User-level settings (provider, model, temperature) live in the cloud.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadCredentials, WEB_APP_URL } from './auth';

export const CONFIG_FILE_NAME = 'aspectcode.json';

/** Project-level config — shared across the team, committed to repo. */
export interface AspectCodeConfig {
  /** Extra directories to exclude from analysis. */
  exclude?: string[];

  /** AGENTS.md ownership: 'full' overwrites the file, 'section' uses markers. */
  ownership?: 'full' | 'section';

  /** Your own OpenAI or Anthropic API key. Provider auto-detected from key prefix (sk-ant- = Anthropic, sk- = OpenAI). */
  apiKey?: string;

  /** @deprecated Use `platforms` instead. Kept for backward compat. */
  platform?: string;

  /** AI platforms to write rules for. Multi-select. */
  platforms?: string[];

  /** Evaluator settings (probe-and-refine tuning). */
  evaluate?: {
    /** Enable probe and refine. Default: true when an API key is available. */
    enabled?: boolean;
    /** Maximum probes per iteration. Default: 10. */
    maxProbes?: number;
    /** Maximum iterations for the probe-and-refine loop. Default: 3. */
    maxIterations?: number;
    /** Maximum edits applied per iteration. Default: 5. */
    maxEditsPerIteration?: number;
    /** Character budget for the AGENTS.md artifact. Default: 8000. */
    charBudget?: number;
  };
}

/** User-level settings — personal, synced from cloud. */
export interface UserSettings {
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Auto-resolve threshold (0.0 = always auto, 1.0 = never auto). Default 0.8. */
  autoResolveThreshold?: number;
}

/** Resolve platforms from config with backward compat for `platform` (singular). */
export function getConfigPlatforms(config?: AspectCodeConfig): string[] | undefined {
  if (config?.platforms?.length) return config.platforms;
  if (config?.platform) return [config.platform];
  return undefined;
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

/**
 * Fetch user-level settings from the cloud. Returns empty object if offline/not logged in.
 */
export async function loadUserSettings(): Promise<UserSettings> {
  const creds = loadCredentials();
  if (!creds) return {};

  try {
    const res = await fetch(`${WEB_APP_URL}/api/cli/settings`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { settings?: UserSettings };
    return data.settings ?? {};
  } catch {
    return {};
  }
}

/**
 * Save user-level settings to the cloud. Fire-and-forget.
 */
export function saveUserSettings(settings: UserSettings): void {
  const creds = loadCredentials();
  if (!creds) return;

  fetch(`${WEB_APP_URL}/api/cli/settings`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  }).catch(() => {});
}
