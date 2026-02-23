import type { EmitterHost } from './host';

export type TransactionWrite = {
  finalPath: string;
  tempPath: string;
  bytes: number;
};

/**
 * Transaction wrapper around an EmitterHost.
 *
 * It stages writes to temp files and only replaces target files on commit.
 * This reduces the chance of partially-written outputs on crashes.
 */
export class GenerationTransaction {
  private readonly id: string;
  private readonly staged = new Map<string, TransactionWrite>();

  constructor(private readonly baseHost: EmitterHost) {
    this.id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  /** Host view used by emitters to stage writes. */
  get host(): EmitterHost {
    const tx = this;
    return {
      readFile: async (filePath: string) => {
        const staged = tx.staged.get(filePath);
        if (staged) return tx.baseHost.readFile(staged.tempPath);
        return tx.baseHost.readFile(filePath);
      },

      writeFile: async (filePath: string, content: string) => {
        const tempPath = `${filePath}.__aspect_tmp__${tx.id}`;
        const bytes = Buffer.byteLength(content, 'utf8');
        await tx.baseHost.writeFile(tempPath, content);
        tx.staged.set(filePath, { finalPath: filePath, tempPath, bytes });
      },

      exists: (filePath: string) => tx.baseHost.exists(filePath),
      mkdirp: (dirPath: string) => tx.baseHost.mkdirp(dirPath),
      rename: (fromPath: string, toPath: string) => tx.baseHost.rename(fromPath, toPath),
      rmrf: (targetPath: string) => tx.baseHost.rmrf(targetPath),
      join: (...segments: string[]) => tx.baseHost.join(...segments),
      relative: (from: string, to: string) => tx.baseHost.relative(from, to),
    };
  }

  /** All staged writes (final paths + bytes). */
  getWrites(): TransactionWrite[] {
    return Array.from(this.staged.values());
  }

  /**
   * Commit staged files into place.
   *
   * Writes are committed in deterministic (sorted) order.
   */
  async commit(): Promise<void> {
    const writes = this.getWrites();
    if (writes.length === 0) return;

    const commitOrder = [...writes].sort((a, b) => a.finalPath.localeCompare(b.finalPath));

    const backups: Array<{ finalPath: string; backupPath: string }> = [];
    const committedFinals: string[] = [];

    try {
      for (const w of commitOrder) {
        const finalPath = w.finalPath;
        const backupPath = `${finalPath}.__aspect_bak__${this.id}`;

        if (await this.baseHost.exists(finalPath)) {
          await this.baseHost.rename(finalPath, backupPath);
          backups.push({ finalPath, backupPath });
        }

        await this.baseHost.rename(w.tempPath, finalPath);
        committedFinals.push(finalPath);
      }

      // Clean backups
      await Promise.all(backups.map((b) => this.baseHost.rmrf(b.backupPath)));
    } catch (err) {
      // Best-effort rollback
      for (const finalPath of committedFinals.reverse()) {
        const b = backups.find((x) => x.finalPath === finalPath);
        if (!b) continue;

        try {
          if (await this.baseHost.exists(finalPath)) {
            await this.baseHost.rmrf(finalPath);
          }
          await this.baseHost.rename(b.backupPath, finalPath);
        } catch {
          // Ignore rollback failures
        }
      }
      throw err;
    } finally {
      // Best-effort cleanup of any remaining temp files
      await Promise.all(
        writes.map(async (w) => {
          try {
            if (await this.baseHost.exists(w.tempPath)) {
              await this.baseHost.rmrf(w.tempPath);
            }
          } catch {
            // Ignore
          }
        }),
      );
    }
  }
}
