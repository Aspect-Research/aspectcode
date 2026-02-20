/**
 * Thin adapter  delegates to @aspectcode/core's DependencyAnalyzer.
 *
 * Keeps the extension-facing API unchanged (no CoreHost parameter)
 * by auto-injecting a vscode-backed host for file reads.
 */

import * as vscode from 'vscode';
import {
  DependencyAnalyzer as CoreAnalyzer,
  type DependencyProgressCallback as CoreProgressCallback,
  type DependencyLink,
  type CoreHost,
  createNodeHost,
} from '@aspectcode/core';

//  Re-exports (backward compat) 

export type { DependencyLink } from '@aspectcode/core';
export type { ImportStatement, CallSite } from '@aspectcode/core';
export type DependencyProgressCallback = CoreProgressCallback;

//  vscode-backed CoreHost 

function createVscodeHost(): CoreHost {
  const base = createNodeHost('');
  return {
    ...base,
    async readFile(absolutePath: string): Promise<string> {
      const uri = vscode.Uri.file(absolutePath);
      const raw = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(raw).toString('utf-8');
    },
  };
}

//  Wrapped class 

export class DependencyAnalyzer {
  private inner = new CoreAnalyzer();

  setFileContentsCache(cache: Map<string, string>): void {
    this.inner.setFileContentsCache(cache);
  }

  async analyzeDependencies(
    files: string[],
    onProgress?: DependencyProgressCallback,
  ): Promise<DependencyLink[]> {
    return this.inner.analyzeDependencies(
      files,
      createVscodeHost(),
      onProgress,
    );
  }
}
