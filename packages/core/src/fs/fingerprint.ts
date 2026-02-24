/**
 * Workspace fingerprint — shared staleness detection for KB artifacts.
 *
 * Computes a SHA-256 hash from file paths, sizes, and modification times.
 * Used by both the CLI watch command and the VS Code extension to determine
 * whether the KB needs regeneration.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Stored fingerprint data, persisted to `.aspect/.fingerprint.json`. */
export interface FingerprintData {
  /** SHA-256 hash of all tracked file metadata. */
  hash: string;
  /** Generator version that produced the last KB. */
  version: string;
  /** ISO-8601 timestamp of last generation. */
  generatedAt: string;
}

const FINGERPRINT_FILE = '.fingerprint.json';

/**
 * Compute a fingerprint hash from a list of file paths.
 * Uses `path:mtime:size` for each file, sorted for determinism.
 */
export function computeFingerprint(filePaths: string[]): string {
  const entries: string[] = [];

  for (const filePath of filePaths) {
    try {
      const stat = fs.statSync(filePath);
      const normalized = filePath.replace(/\\/g, '/');
      entries.push(`${normalized}:${stat.mtimeMs}:${stat.size}`);
    } catch {
      // File may have been deleted between discovery and fingerprinting
    }
  }

  entries.sort();
  const hash = crypto.createHash('sha256');
  for (const entry of entries) {
    hash.update(entry);
    hash.update('\n');
  }
  return hash.digest('hex');
}

/**
 * Read the stored fingerprint from `.aspect/.fingerprint.json`.
 * Returns `null` if the file doesn't exist or is invalid.
 */
export function readFingerprint(aspectDir: string): FingerprintData | null {
  const filePath = path.join(aspectDir, FINGERPRINT_FILE);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as FingerprintData;
    if (typeof data.hash === 'string' && typeof data.version === 'string') {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write a fingerprint to `.aspect/.fingerprint.json`.
 * Creates the `.aspect/` directory if it doesn't exist.
 */
export function writeFingerprint(
  aspectDir: string,
  hash: string,
  version: string,
): void {
  const data: FingerprintData = {
    hash,
    version,
    generatedAt: new Date().toISOString(),
  };

  fs.mkdirSync(aspectDir, { recursive: true });
  const filePath = path.join(aspectDir, FINGERPRINT_FILE);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Check whether the KB is stale by comparing the current file fingerprint
 * against the stored one.
 *
 * Returns `true` if:
 * - No stored fingerprint exists
 * - The hash doesn't match
 * - The version doesn't match (generator was updated)
 */
export function isKbStale(
  aspectDir: string,
  currentFilePaths: string[],
  currentVersion: string,
): boolean {
  const stored = readFingerprint(aspectDir);
  if (!stored) return true;

  if (stored.version !== currentVersion) return true;

  const currentHash = computeFingerprint(currentFilePaths);
  return currentHash !== stored.hash;
}
