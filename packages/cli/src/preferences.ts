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

// ── Types ────────────────────────────────────────────────────

export interface LearnedPreference {
  id: string;
  /** Which check produced this (e.g. 'hub-safety', 'naming-convention'). */
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

export function loadPreferences(root: string): PreferencesStore {
  const p = prefsPath(root);
  if (!fs.existsSync(p)) {
    return { version: 1, preferences: [] };
  }
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as PreferencesStore;
    if (parsed.version === 1 && Array.isArray(parsed.preferences)) {
      return parsed;
    }
    return { version: 1, preferences: [] };
  } catch {
    return { version: 1, preferences: [] };
  }
}

export function savePreferences(root: string, store: PreferencesStore): void {
  const dir = path.join(root, DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(prefsPath(root), JSON.stringify(store, null, 2) + '\n');
}

// ── Mutations ────────────────────────────────────────────────

export function addPreference(
  store: PreferencesStore,
  pref: Omit<LearnedPreference, 'id' | 'createdAt'>,
): PreferencesStore {
  const id = crypto.createHash('sha256')
    .update(`${pref.rule}:${pref.pattern}:${pref.file ?? ''}:${pref.directory ?? ''}`)
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
export function checkPreference(
  store: PreferencesStore,
  rule: string,
  file: string,
  directory: string,
): 'allow' | 'deny' | null {
  // File-specific match (most specific)
  const fileMatch = store.preferences.find(
    (p) => p.rule === rule && p.file === file,
  );
  if (fileMatch) return fileMatch.disposition;

  // Directory match
  const dirMatch = store.preferences.find(
    (p) => p.rule === rule && p.directory && directory.startsWith(p.directory),
  );
  if (dirMatch) return dirMatch.disposition;

  // Rule-only match (broadest — no file or directory)
  const ruleMatch = store.preferences.find(
    (p) => p.rule === rule && !p.file && !p.directory,
  );
  if (ruleMatch) return ruleMatch.disposition;

  return null;
}
