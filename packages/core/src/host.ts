/**
 * CoreHost — abstraction layer for environment-specific I/O.
 *
 * The extension provides a vscode-backed host; tests and CLI callers
 * use the Node.js host created by `createNodeHost()`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getGrammarFileMap } from './parsers/languages';

/** I/O host that core delegates to for file reads and WASM paths. */
export interface CoreHost {
  /** Read a file by absolute path, returning its UTF-8 content. */
  readFile(absolutePath: string): Promise<string>;

  /** Absolute paths to the WASM runtime and per-language grammars. */
  wasmPaths: WasmPaths;
}

export interface WasmPaths {
  /** Path to the core tree-sitter.wasm runtime */
  treeSitter: string;
  /** Map of language id → absolute path to its .wasm grammar */
  grammars: Record<string, string>;
}

function hasTreeSitterRuntime(wasmDir: string): boolean {
  return fs.existsSync(path.join(wasmDir, 'tree-sitter.wasm'));
}

/**
 * Resolve a likely wasm directory for a workspace.
 *
 * Search order favors workspace-local parser bundles, then common
 * repo-relative paths used in this monorepo.
 */
export function resolveWasmDirForWorkspace(workspaceRoot: string): string | undefined {
  const candidates = [
    // Installed via npm — parsers bundled inside @aspectcode/core
    path.resolve(__dirname, '..', 'parsers'),
    // Workspace-local overrides
    path.join(workspaceRoot, 'parsers'),
    path.join(workspaceRoot, 'extension', 'parsers'),
    path.join(process.cwd(), 'parsers'),
    path.join(process.cwd(), 'extension', 'parsers'),
    // Monorepo dev layout
    path.resolve(__dirname, '../../../extension/parsers'),
    path.resolve(__dirname, '../../../../extension/parsers'),
  ];

  for (const candidate of candidates) {
    if (hasTreeSitterRuntime(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * Create a CoreHost backed by Node.js `fs` APIs.
 *
 * @param wasmDir  Directory containing tree-sitter.wasm and language grammars
 */
export function createNodeHost(wasmDir: string): CoreHost {
  const grammarFiles = getGrammarFileMap();
  const grammars: Record<string, string> = {};
  for (const [lang, filename] of Object.entries(grammarFiles)) {
    const p = path.join(wasmDir, filename);
    if (fs.existsSync(p)) {
      grammars[lang] = p;
    }
  }

  return {
    readFile: (absolutePath: string) => fs.promises.readFile(absolutePath, 'utf-8'),
    wasmPaths: {
      treeSitter: path.join(wasmDir, 'tree-sitter.wasm'),
      grammars,
    },
  };
}

/**
 * Create a Node host for a workspace by auto-resolving a wasm directory.
 * Returns undefined when no runtime bundle can be found.
 */
export function createNodeHostForWorkspace(
  workspaceRoot: string,
): CoreHost | undefined {
  const wasmDir = resolveWasmDirForWorkspace(workspaceRoot);
  if (!wasmDir) {
    return undefined;
  }
  return createNodeHost(wasmDir);
}
