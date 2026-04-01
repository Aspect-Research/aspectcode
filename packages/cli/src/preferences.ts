/**
 * Preferences store — persistent learned preferences from developer corrections.
 *
 * Synced to the cloud via the Aspect Code API. Requires login.
 * When a developer dismisses a warning ("this naming is fine for this directory"),
 * the dismissal is recorded as a preference so the same warning doesn't appear again.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { loadCredentials, WEB_APP_URL } from './auth';
import { store } from './ui/store';

// ── Types ────────────────────────────────────────────────────

export interface LearnedPreference {
  id: string;
  /** Which check produced this (e.g. 'co-change', 'naming-convention'). */
  rule: string;
  /** What was dismissed/confirmed (human-readable). */
  pattern: string;
  /** 'allow' = this is fine, 'deny' = always flag this. */
  disposition: 'allow' | 'deny';
  /** Specific file this applies to, or undefined for broader match. */
  file?: string;
  /** Directory pattern this applies to (e.g. 'src/routes/'). */
  directory?: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** What kind of file change triggered this assessment. */
  triggerEvent?: 'add' | 'change' | 'unlink';
  /** The assessment's details string (e.g. "Tests usually live in: test/"). */
  details?: string;
  /** The assessment's suggestion (for deny dispositions). */
  suggestion?: string;
  /** Times this preference suppressed/upgraded an assessment. */
  hitCount?: number;
  /** ISO-8601 timestamp of last hit. */
  lastHitAt?: string;
  /** Why the assessment fired (graph context). */
  dependencyContext?: string;

  // ── Origin ──
  /** Where this preference came from. */
  source?: 'assessment' | 'probe-refine' | 'probe-refine-specific';

  // ── Repo context (populated automatically, used for cross-project suggestions) ──
  /** File extension (e.g. '.tsx', '.py'). */
  fileExtension?: string;
  /** Detected language (e.g. 'typescript', 'python'). */
  language?: string;
  /** Detected framework (e.g. 'react', 'nextjs'). */
  framework?: string;
  /** Repo structural pattern (e.g. 'monorepo', 'flat'). */
  repoPattern?: string;
}

export interface PreferencesStore {
  version: 1;
  preferences: LearnedPreference[];
}

// ── Helpers ──────────────────────────────────────────────────

function projectName(root: string): string {
  return path.basename(root);
}

/** Remove legacy local preferences.json if it exists. */
function cleanupLocalPreferences(root: string): void {
  const p = path.join(root, '.aspectcode', 'preferences.json');
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
}

// ── Cloud load / save ───────────────────────────────────────

export async function loadPreferences(root: string): Promise<PreferencesStore> {
  const creds = loadCredentials();
  if (!creds) return { version: 1, preferences: [] };

  try {
    const project = projectName(root);
    const res = await fetch(
      `${WEB_APP_URL}/api/cli/preferences?project=${encodeURIComponent(project)}`,
      { headers: { Authorization: `Bearer ${creds.token}` } },
    );
    if (!res.ok) {
      store.setSyncStatus('offline');
      return { version: 1, preferences: [] };
    }

    const data = (await res.json()) as { preferences?: LearnedPreference[] };
    store.setSyncStatus('synced');

    // Clean up legacy local file now that we're on cloud
    cleanupLocalPreferences(root);

    return {
      version: 1,
      preferences: data.preferences ?? [],
    };
  } catch {
    store.setSyncStatus('offline');
    return { version: 1, preferences: [] };
  }
}

export function savePreferences(root: string, prefsStore: PreferencesStore): void {
  const creds = loadCredentials();
  if (!creds) return;

  const project = projectName(root);

  store.setSyncStatus('syncing');
  fetch(`${WEB_APP_URL}/api/cli/preferences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ project, preferences: prefsStore.preferences }),
  })
    .then((res) => {
      store.setSyncStatus(res.ok ? 'synced' : 'offline');
    })
    .catch(() => {
      store.setSyncStatus('offline');
    });
}

// ── Mutations ────────────────────────────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.java': 'java', '.cs': 'csharp', '.go': 'go', '.rs': 'rust',
  '.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.kt': 'kotlin',
};

function inferRepoContext(filePath?: string): Pick<LearnedPreference, 'fileExtension' | 'language'> {
  if (!filePath) return {};
  const ext = path.extname(filePath).toLowerCase();
  return {
    fileExtension: ext || undefined,
    language: EXT_TO_LANG[ext] || undefined,
  };
}

export function addPreference(
  store: PreferencesStore,
  pref: Omit<LearnedPreference, 'id' | 'createdAt'>,
): PreferencesStore {
  const id = crypto.createHash('sha256')
    .update(`${pref.rule}:${pref.pattern}:${pref.file ?? ''}:${pref.directory ?? ''}:${pref.triggerEvent ?? ''}`)
    .digest('hex')
    .slice(0, 12);

  // Auto-populate repo context if not already set
  const ctx = inferRepoContext(pref.file);
  const enriched = {
    ...pref,
    fileExtension: pref.fileExtension ?? ctx.fileExtension,
    language: pref.language ?? ctx.language,
  };

  // Deduplicate — replace existing preference with same id
  const filtered = store.preferences.filter((p) => p.id !== id);

  return {
    ...store,
    preferences: [
      ...filtered,
      { ...enriched, id, createdAt: new Date().toISOString() },
    ],
  };
}

// ── Query ────────────────────────────────────────────────────

/**
 * Check if any preference matches this rule + file + directory combination.
 * Returns the disposition if matched, null if no preference applies.
 *
 * Matching priority: file-specific > directory-specific > rule-only.
 */
/**
 * Find the matching preference object for a rule + file + directory combination.
 * Returns the full preference if matched, null if no preference applies.
 */
export function findMatchingPreference(
  store: PreferencesStore,
  rule: string,
  file: string,
  directory: string,
): LearnedPreference | null {
  // File-specific match (most specific)
  const fileMatch = store.preferences.find(
    (p) => p.rule === rule && p.file === file,
  );
  if (fileMatch) return fileMatch;

  // Directory match
  const dirMatch = store.preferences.find(
    (p) => p.rule === rule && p.directory && directory.startsWith(p.directory),
  );
  if (dirMatch) return dirMatch;

  // Rule-only match (broadest — no file or directory)
  const ruleMatch = store.preferences.find(
    (p) => p.rule === rule && !p.file && !p.directory,
  );
  if (ruleMatch) return ruleMatch;

  return null;
}

/**
 * Increment hitCount and set lastHitAt on a preference (mutates in-place).
 */
export function bumpPreferenceHit(store: PreferencesStore, prefId: string): PreferencesStore {
  const pref = store.preferences.find((p) => p.id === prefId);
  if (pref) {
    pref.hitCount = (pref.hitCount ?? 0) + 1;
    pref.lastHitAt = new Date().toISOString();
  }
  return store;
}

// ── Formatting ──────────────────────────────────────────────

/**
 * Format confirmed (deny) preferences as natural language hints for the LLM.
 * Returns empty string if no deny preferences exist.
 */
const MAX_PREFERENCES_IN_PROMPT = 30;
const MAX_PREF_DESCRIPTION_CHARS = 200;
const MAX_PREFERENCES_BLOCK_CHARS = 3000;

export function formatPreferencesForPrompt(prefsStore: PreferencesStore): string {
  const denied = prefsStore.preferences.filter((p) => p.disposition === 'deny');
  if (denied.length === 0) return '';

  // Sort by hitCount descending — most-used preferences are most important
  const sorted = [...denied].sort((a, b) => (b.hitCount ?? 0) - (a.hitCount ?? 0));
  const capped = sorted.slice(0, MAX_PREFERENCES_IN_PROMPT);

  const lines = capped.map((p) => {
    const scope = p.file ? `in \`${p.file}\`` : p.directory ? `in \`${p.directory}\`` : 'project-wide';
    const pattern = p.pattern.length > MAX_PREF_DESCRIPTION_CHARS
      ? p.pattern.slice(0, MAX_PREF_DESCRIPTION_CHARS) + '...'
      : p.pattern;
    return `- "${p.rule}" enforced ${scope}: ${pattern}`;
  });

  let block = `## Previous preferences\n\nConfirmed rules from watch mode corrections:\n\n${lines.join('\n')}`;
  if (block.length > MAX_PREFERENCES_BLOCK_CHARS) {
    block = block.slice(0, MAX_PREFERENCES_BLOCK_CHARS) + '\n...';
  }
  return block;
}

// ── Community suggestions ───────────────────────────────────

export interface Suggestion {
  rule: string;
  disposition: string;
  directory: string | null;
  confidence: number;
  userCount: number;
  /** Actionable text from the most-used preference in this group. */
  suggestion: string;
}

export async function fetchSuggestions(
  language: string,
  framework?: string,
  opts?: { byok?: boolean },
): Promise<Suggestion[]> {
  // BYOK users don't get community suggestions
  if (opts?.byok) return [];

  const creds = loadCredentials();
  if (!creds) return [];

  try {
    const params = new URLSearchParams({ language });
    if (framework) params.set('framework', framework);

    const res = await fetch(
      `${WEB_APP_URL}/api/cli/suggestions?${params}`,
      { headers: { Authorization: `Bearer ${creds.token}` } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { suggestions?: Suggestion[] };
    return data.suggestions ?? [];
  } catch {
    return [];
  }
}
