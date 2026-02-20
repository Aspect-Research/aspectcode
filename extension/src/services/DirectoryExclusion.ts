/**
 * DirectoryExclusion  types and discovery helpers.
 *
 * The actual exclusion logic lives in FileDiscoveryService.
 * This module provides:
 * - Type definitions (ExclusionSettings)
 * - Legacy-compatible discoverSourceFiles() wrapper
 */

import * as vscode from 'vscode';
import { getFileDiscoveryService } from './FileDiscoveryService';
import {
  PACKAGE_MANAGER_DIRS,
  BUILD_OUTPUT_DIRS,
  VENV_DIRS,
  CACHE_DIRS,
  VCS_IDE_DIRS,
  TEST_OUTPUT_DIRS,
  GENERATED_DIRS,
} from '@aspectcode/core';

// ============================================================================
// Types
// ============================================================================

export interface ExclusionSettings {
  /** Always exclude these directories (relative paths from workspace root) */
  always?: string[];
  /** Never exclude these directories, even if auto-detected (relative paths) */
  never?: string[];
  /** Computed exclusions (stored by FileDiscoveryService) */
  _computed?: {
    excludeGlob: string;
    excludedDirs: string[];
    computedAt: number;
  };
}

// ============================================================================
// Discovery
// ============================================================================

/**
 * Discover all source files in the workspace with proper exclusions.
 * Uses FileDiscoveryService if available (singleton), otherwise falls back
 * to direct discovery.
 *
 * @param workspaceRoot The workspace root URI
 * @param outputChannel Optional output channel for logging (only used in fallback)
 * @param onProgress Optional progress callback
 * @returns Sorted list of absolute file paths
 */
export async function discoverSourceFiles(
  workspaceRoot: vscode.Uri,
  outputChannel?: vscode.OutputChannel,
  onProgress?: (phase: string) => void,
): Promise<string[]> {
  // Use FileDiscoveryService singleton if available
  const service = getFileDiscoveryService();
  if (service) {
    return service.getFiles();
  }

  // Fallback: direct discovery (should only happen during early initialization)
  outputChannel?.appendLine(
    '[FileDiscovery] Warning: FileDiscoveryService not initialized, using fallback',
  );
  return discoverSourceFilesFallback(workspaceRoot, outputChannel, onProgress);
}

// ============================================================================
// Internal helpers
// ============================================================================

function getDefaultExcludeGlob(): string {
  const allDirs = [
    ...PACKAGE_MANAGER_DIRS,
    ...BUILD_OUTPUT_DIRS,
    ...VENV_DIRS,
    ...CACHE_DIRS,
    ...VCS_IDE_DIRS,
    ...TEST_OUTPUT_DIRS,
    ...GENERATED_DIRS,
  ];
  const unique = [...new Set(allDirs)];
  return `**/{${unique.join(',')}}/**`;
}

/**
 * Fallback file discovery when FileDiscoveryService is not yet initialized.
 * This mirrors the logic in FileDiscoveryService.
 */
async function discoverSourceFilesFallback(
  workspaceRoot: vscode.Uri,
  outputChannel?: vscode.OutputChannel,
  onProgress?: (phase: string) => void,
): Promise<string[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return [];
  }

  const allFiles = new Set<string>();

  const patterns = [
    '**/*.py',
    '**/*.ts',
    '**/*.tsx',
    '**/*.js',
    '**/*.jsx',
    '**/*.mjs',
    '**/*.cjs',
    '**/*.java',
    '**/*.cpp',
    '**/*.c',
    '**/*.hpp',
    '**/*.h',
    '**/*.cs',
    '**/*.go',
    '**/*.rs',
    '**/*.rb',
    '**/*.php',
  ];

  const explicitExclude = getDefaultExcludeGlob();
  outputChannel?.appendLine(`[FileDiscovery] Using default exclusion glob (fallback)`);

  const maxResultsPerPattern = 10000;
  let completedPatterns = 0;

  const patternPromises = patterns.map(async (pattern) => {
    try {
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceRoot, pattern),
        explicitExclude,
        maxResultsPerPattern,
      );
      completedPatterns++;
      onProgress?.(
        `Discovering files (${Math.round((completedPatterns / patterns.length) * 100)}%)...`,
      );
      return files;
    } catch {
      completedPatterns++;
      return [] as readonly vscode.Uri[];
    }
  });

  const results = await Promise.all(patternPromises);

  for (const fileList of results) {
    for (const file of fileList) {
      allFiles.add(file.fsPath);
    }
  }

  const sorted = Array.from(allFiles).sort();
  outputChannel?.appendLine(`[FileDiscovery] Found ${sorted.length} source files (fallback)`);
  return sorted;
}