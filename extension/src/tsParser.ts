import * as vscode from 'vscode';
import * as path from 'path';
import {
  loadGrammars,
  createNodeHost,
  createEmptyGrammarSummary,
} from '@aspectcode/core';
import type { LoadedGrammars, GrammarSummary } from '@aspectcode/core';

export type { LoadedGrammars };

let initOnce: Promise<LoadedGrammars> | null = null;
let grammarSummary: GrammarSummary = createEmptyGrammarSummary();

/**
 * Load tree-sitter grammars once, caching the result.
 *
 * Delegates actual loading to @aspectcode/core's loadGrammars(),
 * providing vscode-derived WASM paths via CoreHost.
 */
export async function loadGrammarsOnce(
  context: vscode.ExtensionContext,
  outputChannel?: vscode.OutputChannel,
): Promise<LoadedGrammars> {
  if (initOnce) {
    outputChannel?.appendLine('Tree-sitter: returning cached grammars');
    return initOnce;
  }

  outputChannel?.appendLine('Tree-sitter: starting initialization...');

  const wasmDir = context.asAbsolutePath('parsers');
  const host = createNodeHost(wasmDir);

  // Override readFile to use vscode.workspace.fs for consistency
  host.readFile = async (absolutePath: string) => {
    const uri = vscode.Uri.file(absolutePath);
    const content = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(content).toString('utf-8');
  };

  // Override treeSitter path to use extension-resolved absolute path
  host.wasmPaths.treeSitter = context.asAbsolutePath(
    path.join('parsers', 'tree-sitter.wasm'),
  );

  const log = outputChannel
    ? (msg: string) => outputChannel.appendLine(msg)
    : undefined;

  initOnce = (async () => {
    const result = await loadGrammars(host, log);
    grammarSummary = result.summary;
    return result.grammars;
  })();

  return initOnce;
}

export function getLoadedGrammarsSummary(): GrammarSummary {
  return { ...grammarSummary };
}


