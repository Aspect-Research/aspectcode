/**
 * Provider resolution — loads API keys from environment / .env file
 * and returns the appropriate LlmProvider implementation.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { LlmProvider, ProviderName } from '../types';
import { PROVIDER_ENV_KEYS, LLM_PROVIDER_ENV } from '../types';
import { createOpenAiProvider } from './openai';

/**
 * Parse a `.env` file into key=value pairs.
 * Handles comments, blank lines, and optional quoting.
 */
export function parseDotenv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Load environment variables from a `.env` file at the workspace root,
 * merged with `process.env` (process.env wins on conflicts).
 */
export function loadEnvFile(root: string): Record<string, string> {
  const envPath = path.join(root, '.env');
  const env: Record<string, string> = {};

  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    Object.assign(env, parseDotenv(content));
  }

  // process.env values take precedence
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return env;
}

/**
 * Build the provider name → factory mapping.
 * Only OpenAI is wired up today; extend here for Anthropic, etc.
 */
const PROVIDER_FACTORIES: Record<
  ProviderName,
  (apiKey: string, model?: string) => LlmProvider
> = {
  openai: createOpenAiProvider,
  anthropic: (_key: string, _model?: string) => {
    throw new Error('Anthropic provider is not yet implemented');
  },
};

/**
 * Resolve an LlmProvider from environment variables.
 *
 * Resolution order:
 * 1. If `LLM_PROVIDER` is set, use that provider (error if key missing).
 * 2. Otherwise try providers in order: openai → anthropic.
 * 3. If no key is found, throw with setup instructions.
 */
export function resolveProvider(env: Record<string, string>): LlmProvider {
  const forcedProvider = env[LLM_PROVIDER_ENV] as ProviderName | undefined;
  const model = env['LLM_MODEL'];

  if (forcedProvider) {
    const envKey = PROVIDER_ENV_KEYS[forcedProvider];
    if (!envKey) {
      throw new Error(
        `Unknown LLM_PROVIDER "${forcedProvider}". Supported: ${Object.keys(PROVIDER_ENV_KEYS).join(', ')}`,
      );
    }
    const apiKey = env[envKey];
    if (!apiKey) {
      throw new Error(
        `LLM_PROVIDER is set to "${forcedProvider}" but ${envKey} is not defined.\n` +
        `Add ${envKey}=sk-... to your .env file.`,
      );
    }
    return PROVIDER_FACTORIES[forcedProvider](apiKey, model);
  }

  // Auto-detect: try each provider in order
  const providerOrder: ProviderName[] = ['openai', 'anthropic'];
  for (const name of providerOrder) {
    const envKey = PROVIDER_ENV_KEYS[name];
    const apiKey = env[envKey];
    if (apiKey) {
      return PROVIDER_FACTORIES[name](apiKey, model);
    }
  }

  throw new Error(
    'No LLM API key found. To use `aspectcode optimize`, add one of:\n' +
    '  OPENAI_API_KEY=sk-...\n' +
    '  ANTHROPIC_API_KEY=sk-ant-...\n' +
    'to a .env file in your workspace root.',
  );
}
