/**
 * Preferences store — persistent learned preferences from developer corrections.
 *
 * Stored in .aspectcode/preferences.json. When a developer dismisses a warning
 * ("this naming is fine for this directory"), the dismissal is recorded as a
 * preference so the same warning doesn't appear again.
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
}

export interface PreferencesStore {
  version: 1;
  preferences: LearnedPreference[];
}

// ── Constants ────────────────────────────────────────────────

const DIR_NAME = '.aspectcode';
const FILE_NAME = 'preferences.json';

// ── Load / Save ──────────────────────────────────────────────

function prefsPath(root: string): string {
  return path.join(root, DIR_NAME, FILE_NAME);
}

function loadPreferencesLocal(root: string): PreferencesStore {
  const p = prefsPath(root);
  if (!fs.existsSync(p)) {
    return { version: 1, preferences: [] };
  }
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as PreferencesStore;
    if (parsed.version === 1 && Array.isArray(parsed.preferences)) {
      // Migrate hub-safety → co-change
      for (const pref of parsed.preferences) {
        if (pref.rule === 'hub-safety') pref.rule = 'co-change';
      }
      return parsed;
    }
    return { version: 1, preferences: [] };
  } catch {
    return { version: 1, preferences: [] };
  }
}

function savePreferencesLocal(root: string, store: PreferencesStore): void {
  const dir = path.join(root, DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(prefsPath(root), JSON.stringify(store, null, 2) + '\n');
}

function projectName(root: string): string {
  return path.basename(root);
}

// ── Remote sync (best-effort, never blocks) ─────────────────

async function fetchPreferencesFromRemote(root: string): Promise<LearnedPreference[] | null> {
  const creds = loadCredentials();
  if (!creds) return null;

  try {
    const project = projectName(root);
    const res = await fetch(
      `${WEB_APP_URL}/api/cli/preferences?project=${encodeURIComponent(project)}`,
      { headers: { Authorization: `Bearer ${creds.token}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { preferences?: LearnedPreference[] };
    return data.preferences ?? null;
  } catch {
    return null;
  }
}

function syncPreferencesToRemote(root: string, prefsStore: PreferencesStore): void {
  const creds = loadCredentials();
  if (!creds) return;

  const project = projectName(root);

  // Fire and forget — don't block the pipeline
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

// ── Public load / save (local + remote) ─────────────────────

export async function loadPreferences(root: string): Promise<PreferencesStore> {
  const local = loadPreferencesLocal(root);

  // Try to fetch remote preferences and merge (remote wins on conflict)
  const remote = await fetchPreferencesFromRemote(root);
  if (remote && remote.length > 0) {
    store.setSyncStatus('synced');
  }
  if (!remote || remote.length === 0) return local;

  // Merge: build a map keyed by id, remote overwrites local
  const merged = new Map<string, LearnedPreference>();
  for (const p of local.preferences) merged.set(p.id, p);
  for (const p of remote) merged.set(p.id, p);

  const result: PreferencesStore = {
    version: 1,
    preferences: Array.from(merged.values()),
  };

  // Update local file with merged result
  savePreferencesLocal(root, result);

  return result;
}

export function savePreferences(root: string, prefsStore: PreferencesStore): void {
  savePreferencesLocal(root, prefsStore);
  syncPreferencesToRemote(root, prefsStore);
}

// ── Mutations ────────────────────────────────────────────────

export function addPreference(
  store: PreferencesStore,
  pref: Omit<LearnedPreference, 'id' | 'createdAt'>,
): PreferencesStore {
  const id = crypto.createHash('sha256')
    .update(`${pref.rule}:${pref.pattern}:${pref.file ?? ''}:${pref.directory ?? ''}:${pref.triggerEvent ?? ''}`)
    .digest('hex')
    .slice(0, 12);

  // Deduplicate — replace existing preference with same id
  const filtered = store.preferences.filter((p) => p.id !== id);

  return {
    ...store,
    preferences: [
      ...filtered,
      { ...pref, id, createdAt: new Date().toISOString() },
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
export function formatPreferencesForPrompt(store: PreferencesStore): string {
  const denied = store.preferences.filter((p) => p.disposition === 'deny');
  if (denied.length === 0) return '';

  const lines = denied.map((p) => {
    const scope = p.file ? `in \`${p.file}\`` : p.directory ? `in \`${p.directory}\`` : 'project-wide';
    return `- The developer confirmed that "${p.rule}" should be enforced ${scope}: ${p.pattern}`;
  });

  return `## Developer preferences\n\nThese rules were explicitly confirmed by the developer during watch mode:\n\n${lines.join('\n')}`;
}
