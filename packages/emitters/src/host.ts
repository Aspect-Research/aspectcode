/**
 * EmitterHost — abstraction for file I/O used by all emitters.
 *
 * The emitter layer MUST NOT depend on `vscode`. This interface lets
 * emitters read/write files and query paths through a host that can be
 * backed by Node.js `fs` (CLI) or VS Code workspace FS (extension).
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Interface ────────────────────────────────────────────────

export interface EmitterHost {
  /** Read a file as UTF-8 text. Throws if the file does not exist. */
  readFile(filePath: string): Promise<string>;

  /** Write UTF-8 text to a file, creating parent directories as needed. */
  writeFile(filePath: string, content: string): Promise<void>;

  /** Check whether a file or directory exists. */
  exists(filePath: string): Promise<boolean>;

  /** Recursively create directories (like `mkdir -p`). */
  mkdirp(dirPath: string): Promise<void>;

  /** Rename or move a file or directory. Must be same filesystem/drive. */
  rename(fromPath: string, toPath: string): Promise<void>;

  /** Remove a file or directory recursively (like `rm -rf`). */
  rmrf(targetPath: string): Promise<void>;

  /** Join path segments (platform-aware). */
  join(...segments: string[]): string;

  /** Return a relative path from `from` to `to` (forward-slash normalized). */
  relative(from: string, to: string): string;
}

// ── Node.js implementation ───────────────────────────────────

/**
 * Create an EmitterHost backed by the Node.js `fs` module.
 * Suitable for CLI usage and tests.
 */
export function createNodeEmitterHost(): EmitterHost {
  return {
    async readFile(filePath: string): Promise<string> {
      return fs.promises.readFile(filePath, 'utf-8');
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, content, 'utf-8');
    },

    async exists(filePath: string): Promise<boolean> {
      try {
        await fs.promises.access(filePath);
        return true;
      } catch {
        return false;
      }
    },

    async mkdirp(dirPath: string): Promise<void> {
      await fs.promises.mkdir(dirPath, { recursive: true });
    },

    async rename(fromPath: string, toPath: string): Promise<void> {
      await fs.promises.rename(fromPath, toPath);
    },

    async rmrf(targetPath: string): Promise<void> {
      await fs.promises.rm(targetPath, { recursive: true, force: true });
    },

    join(...segments: string[]): string {
      return path.join(...segments);
    },

    relative(from: string, to: string): string {
      return path.relative(from, to).replace(/\\/g, '/');
    },
  };
}
