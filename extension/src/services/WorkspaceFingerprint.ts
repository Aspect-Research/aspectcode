/**
 * WorkspaceFingerprint - Simple KB staleness detection (in-memory)
 *
 * Computes a cheap fingerprint from workspace files (paths + mtime + size).
 * Keeps the fingerprint in memory — no files written to disk.
 * Provides simple isKbStale() / markKbFresh() API.
 *
 * Uses FileDiscoveryService for file discovery to avoid redundant scans.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { AutoRegenerateKbMode } from './aspectSettings';
import { getFileDiscoveryService } from './FileDiscoveryService';
import { discoverSourceFiles } from './DirectoryExclusion';

// ============================================================================
// WorkspaceFingerprint Service
// ============================================================================

export class WorkspaceFingerprint implements vscode.Disposable {
  // Idle detection
  private idleTimer: NodeJS.Timeout | null = null;
  private lastEditTime: number = 0;
  private readonly IDLE_DEBOUNCE_MS = 30000; // 30 seconds

  // onChange debounce (shorter than idle)
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly SAVE_DEBOUNCE_MS = 2000; // 2 seconds after last save

  private autoRegenMode: AutoRegenerateKbMode = 'onChange';

  // In-memory fingerprint (no file persistence)
  private lastKnownFingerprint: string | null = null;
  private lastKnownFileCount: number = 0;

  // Track whether we've already notified the UI that KB is stale.
  private staleNotified: boolean = false;
  private lastStaleLogAt: number = 0;
  private readonly STALE_LOG_DEBOUNCE_MS = 5000;

  // Track if regeneration is in progress to avoid overlapping runs
  private regenerationInProgress: boolean = false;

  // Event emitter for stale state changes
  private readonly _onStaleStateChanged = new vscode.EventEmitter<boolean>();
  readonly onStaleStateChanged = this._onStaleStateChanged.event;

  /**
   * Set the auto-regeneration mode.
   */
  setAutoRegenerateKbMode(mode: AutoRegenerateKbMode): void {
    this.autoRegenMode = mode;

    // If we moved away from idle mode, cancel any pending idle regeneration.
    if (mode !== 'idle' && this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // KB regeneration callback
  private kbRegenerateCallback: (() => Promise<void>) | null = null;

  constructor(
    private workspaceRoot: string,
    private extensionVersion: string,
    private outputChannel: vscode.OutputChannel,
  ) {}

  dispose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this._onStaleStateChanged.dispose();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Set callback for KB regeneration (used by idle auto-regenerate).
   */
  setKbRegenerateCallback(callback: () => Promise<void>): void {
    this.kbRegenerateCallback = callback;
  }

  /**
   * Check if KB is stale (fingerprint changed since last generation).
   * Returns false if no fingerprint is known (first run / extension restart).
   */
  async isKbStale(): Promise<boolean> {
    try {
      if (!this.lastKnownFingerprint) {
        // No fingerprint yet — first run or extension restarted.
        // Not stale; the next save/edit trigger will handle regen.
        return false;
      }

      const current = await this.computeFingerprint();

      if (current.fingerprint !== this.lastKnownFingerprint) {
        this.outputChannel.appendLine(
          `[WorkspaceFingerprint] Fingerprint changed: ${this.lastKnownFileCount} -> ${current.fileCount} files`,
        );
        return true;
      }

      return false;
    } catch (e) {
      this.outputChannel.appendLine(`[WorkspaceFingerprint] Error checking staleness: ${e}`);
      return false;
    }
  }

  /**
   * Get staleness info for UI display.
   */
  async getStalenessInfo(): Promise<{
    isStale: boolean;
    fileCount: number;
    lastGenerated: number | null;
  }> {
    try {
      const isStale = await this.isKbStale();
      const current = await this.computeFingerprint();

      return {
        isStale,
        fileCount: current.fileCount,
        lastGenerated: null,
      };
    } catch {
      return { isStale: false, fileCount: 0, lastGenerated: null };
    }
  }

  /**
   * Mark KB as fresh (call after successful KB regeneration).
   *
   * @param preDiscoveredFiles Optional - if KB generation already discovered files,
   *                           pass them here to avoid rediscovering.
   */
  async markKbFresh(preDiscoveredFiles?: string[]): Promise<void> {
    try {
      const fingerprint = await this.computeFingerprint(preDiscoveredFiles);

      this.lastKnownFingerprint = fingerprint.fingerprint;
      this.lastKnownFileCount = fingerprint.fileCount;

      this.outputChannel.appendLine(
        `[WorkspaceFingerprint] Marked KB fresh: ${fingerprint.fileCount} files`,
      );

      // Notify listeners that KB is no longer stale
      this.staleNotified = false;
      this._onStaleStateChanged.fire(false);
    } catch (e) {
      this.outputChannel.appendLine(`[WorkspaceFingerprint] Error marking KB fresh: ${e}`);
    }
  }

  /**
   * Notify that a file was edited (for idle detection).
   */
  onFileEdited(): void {
    this.lastEditTime = Date.now();

    // Reset idle timer
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    if (this.autoRegenMode === 'idle' && this.kbRegenerateCallback) {
      this.idleTimer = setTimeout(async () => {
        this.idleTimer = null;
        await this.onIdleTimeout();
      }, this.IDLE_DEBOUNCE_MS);
    }

    // Notify that KB may be stale (only on transition to avoid spam)
    if (!this.staleNotified) {
      this.staleNotified = true;

      const now = Date.now();
      if (now - this.lastStaleLogAt > this.STALE_LOG_DEBOUNCE_MS) {
        this.lastStaleLogAt = now;
        this.outputChannel.appendLine('[WorkspaceFingerprint] Workspace changed; KB may be stale');
      }

      this._onStaleStateChanged.fire(true);
    }
  }

  /**
   * Notify that a file was saved/changed.
   * This triggers debounced KB regeneration if updateRate === 'onChange'.
   */
  onFileSaved(filePath: string): void {
    this.lastEditTime = Date.now();

    if (this.autoRegenMode !== 'onChange' || !this.kbRegenerateCallback) {
      // Still mark stale if not auto-regenerating
      this.onFileEdited();
      return;
    }

    // Mark stale immediately
    if (!this.staleNotified) {
      this.staleNotified = true;
      this._onStaleStateChanged.fire(true);
    }

    // Reset save debounce timer
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      await this.onSaveTimeout(filePath);
    }, this.SAVE_DEBOUNCE_MS);
  }

  /**
   * Called after save debounce expires - triggers KB regeneration.
   */
  private async onSaveTimeout(lastSavedFile: string): Promise<void> {
    if (this.regenerationInProgress) {
      this.outputChannel.appendLine(
        '[WorkspaceFingerprint] Skipping onSave regen (already in progress)',
      );
      return;
    }

    try {
      this.regenerationInProgress = true;
      const startTime = Date.now();
      this.outputChannel.appendLine(
        `[WorkspaceFingerprint] Auto-regenerating KB (onChange trigger, file: ${path.basename(
          lastSavedFile,
        )})...`,
      );

      await this.kbRegenerateCallback!();

      const duration = Date.now() - startTime;
      this.outputChannel.appendLine(`[WorkspaceFingerprint] KB regenerated in ${duration}ms`);
    } catch (e) {
      this.outputChannel.appendLine(`[WorkspaceFingerprint] onChange regeneration failed: ${e}`);
    } finally {
      this.regenerationInProgress = false;
    }
  }

  /**
   * Get current fingerprint without comparing to stored.
   *
   * @param preDiscoveredFiles Optional - if files were already discovered, pass them
   *                           to avoid redundant file discovery.
   */
  async computeFingerprint(
    preDiscoveredFiles?: string[],
  ): Promise<{ fingerprint: string; fileCount: number }> {
    const files = preDiscoveredFiles ?? (await this.discoverWorkspaceSourceFiles());
    const metadata = await this.getFilesMetadata(files);

    // Sort for deterministic hash
    metadata.sort((a, b) => a.path.localeCompare(b.path));

    // Create fingerprint from metadata
    const hashInput = metadata.map((m) => `${m.path}:${m.mtime}:${m.size}`).join('\n');
    const hash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

    return { fingerprint: hash, fileCount: metadata.length };
  }

  // ==========================================================================
  // Internal: Idle Detection
  // ==========================================================================

  private async onIdleTimeout(): Promise<void> {
    try {
      if (this.regenerationInProgress) {
        this.outputChannel.appendLine(
          '[WorkspaceFingerprint] Skipping idle regen (already in progress)',
        );
        return;
      }

      if (this.staleNotified && this.kbRegenerateCallback) {
        this.regenerationInProgress = true;
        const startTime = Date.now();
        this.outputChannel.appendLine(
          `[WorkspaceFingerprint] Idle timeout reached, auto-regenerating KB...`,
        );
        await this.kbRegenerateCallback();
        const duration = Date.now() - startTime;
        this.outputChannel.appendLine(`[WorkspaceFingerprint] KB regenerated in ${duration}ms`);
      } else {
        this.outputChannel.appendLine(
          '[WorkspaceFingerprint] Idle timeout but no changes detected, skipping',
        );
      }
    } catch (e) {
      this.outputChannel.appendLine(`[WorkspaceFingerprint] Idle regeneration failed: ${e}`);
    } finally {
      this.regenerationInProgress = false;
    }
  }

  // ==========================================================================
  // Internal: File Discovery
  // ==========================================================================

  private async discoverWorkspaceSourceFiles(): Promise<string[]> {
    // Use FileDiscoveryService if available (preferred - uses cache)
    const service = getFileDiscoveryService();
    if (service) {
      try {
        return await service.getFiles();
      } catch (e) {
        this.outputChannel.appendLine(`[WorkspaceFingerprint] FileDiscoveryService error: ${e}`);
      }
    }

    // Fallback to direct discovery
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [];
    }

    try {
      return await discoverSourceFiles(workspaceFolders[0].uri, this.outputChannel);
    } catch (e) {
      this.outputChannel.appendLine(`[WorkspaceFingerprint] File discovery error: ${e}`);
      return [];
    }
  }

  private async getFilesMetadata(
    files: string[],
  ): Promise<Array<{ path: string; mtime: number; size: number }>> {
    const metadata: Array<{ path: string; mtime: number; size: number }> = [];

    for (const filePath of files) {
      try {
        const uri = vscode.Uri.file(filePath);
        const stat = await vscode.workspace.fs.stat(uri);

        // Use relative path for consistency across machines
        const relativePath = path.relative(this.workspaceRoot, filePath).replace(/\\/g, '/');

        metadata.push({
          path: relativePath,
          mtime: stat.mtime,
          size: stat.size,
        });
      } catch {
        // File may have been deleted between discovery and stat
      }
    }

    return metadata;
  }
}
