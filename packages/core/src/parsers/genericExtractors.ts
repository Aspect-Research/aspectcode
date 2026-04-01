/**
 * Generic tree-sitter extractors for languages without custom extractors.
 *
 * Uses per-language node type configuration to extract imports and symbols
 * from any tree-sitter grammar. Gets ~80% accuracy without language-specific
 * AST knowledge.
 */

import Parser from 'web-tree-sitter';
import type { ExtractedSymbol } from '../model';
import { textFor } from './utils';

// ── Per-language AST node type configuration ─────────────────

interface LangConfig {
  /** AST node types that represent import statements. */
  importNodeTypes: string[];
  /** How to extract the module path from an import node. */
  importExtract: (code: string, node: Parser.SyntaxNode) => string | null;
  /** AST node types for function/method definitions. */
  functionNodeTypes: string[];
  /** AST node types for class/struct/trait/module definitions. */
  classNodeTypes: string[];
}

const LANG_CONFIGS: Record<string, LangConfig> = {
  go: {
    importNodeTypes: ['import_declaration', 'import_spec'],
    importExtract: (code, n) => {
      if (n.type === 'import_spec') {
        const pathNode = n.namedChildren.find((c) => c.type === 'interpreted_string_literal');
        if (pathNode) return textFor(code, pathNode).replace(/^"|"$/g, '');
      }
      // import_declaration may have import_spec_list children
      return null;
    },
    functionNodeTypes: ['function_declaration', 'method_declaration'],
    classNodeTypes: ['type_declaration'],
  },

  rust: {
    importNodeTypes: ['use_declaration'],
    importExtract: (code, n) => {
      // use crate::module::Item;
      const scopedId = n.namedChildren.find((c) =>
        c.type === 'scoped_identifier' || c.type === 'scoped_use_list' || c.type === 'use_wildcard' || c.type === 'identifier',
      );
      if (scopedId) return textFor(code, scopedId).split('::').slice(0, -1).join('::') || textFor(code, scopedId);
      return null;
    },
    functionNodeTypes: ['function_item'],
    classNodeTypes: ['struct_item', 'enum_item', 'impl_item', 'trait_item'],
  },

  ruby: {
    importNodeTypes: ['call'],
    importExtract: (code, n) => {
      // require 'module' or require_relative 'module'
      const methodNode = n.namedChildren.find((c) => c.type === 'identifier');
      if (!methodNode) return null;
      const method = textFor(code, methodNode);
      if (method !== 'require' && method !== 'require_relative') return null;
      const argNode = n.namedChildren.find((c) => c.type === 'argument_list');
      if (!argNode) return null;
      const strNode = argNode.namedChildren.find((c) => c.type === 'string');
      if (strNode) {
        const raw = textFor(code, strNode);
        return raw.replace(/^['"]|['"]$/g, '');
      }
      return null;
    },
    functionNodeTypes: ['method', 'singleton_method'],
    classNodeTypes: ['class', 'module'],
  },

  php: {
    importNodeTypes: ['namespace_use_declaration'],
    importExtract: (code, n) => {
      // use App\Models\User;
      const nameNode = n.namedChildren.find((c) =>
        c.type === 'namespace_use_clause' || c.type === 'qualified_name' || c.type === 'name',
      );
      if (nameNode) return textFor(code, nameNode).replace(/^\\/, '');
      return null;
    },
    functionNodeTypes: ['function_definition', 'method_declaration'],
    classNodeTypes: ['class_declaration', 'interface_declaration', 'trait_declaration'],
  },

  cpp: {
    importNodeTypes: ['preproc_include'],
    importExtract: (code, n) => {
      // #include <header> or #include "header"
      const pathNode = n.namedChildren.find((c) =>
        c.type === 'system_lib_string' || c.type === 'string_literal',
      );
      if (pathNode) return textFor(code, pathNode).replace(/^[<"]|[>"]$/g, '');
      return null;
    },
    functionNodeTypes: ['function_definition'],
    classNodeTypes: ['class_specifier', 'struct_specifier'],
  },
};

// ── Generic import extraction ────────────────────────────────

export function extractGenericImports(langId: string, lang: Parser.Language, code: string): string[] {
  const config = LANG_CONFIGS[langId];
  if (!config) return [];

  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  const out: string[] = [];

  const walk = (n: Parser.SyntaxNode) => {
    if (config.importNodeTypes.includes(n.type)) {
      const result = config.importExtract(code, n);
      if (result) out.push(result);
    }
    for (const ch of n.namedChildren) {
      walk(ch);
    }
  };

  walk(root);
  tree.delete();
  return out;
}

// ── Generic symbol extraction ────────────────────────────────

export function extractGenericSymbols(langId: string, lang: Parser.Language, code: string): ExtractedSymbol[] {
  const config = LANG_CONFIGS[langId];
  if (!config) return [];

  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  const symbols: ExtractedSymbol[] = [];

  const walk = (n: Parser.SyntaxNode, depth = 0) => {
    // Functions/methods
    if (config.functionNodeTypes.includes(n.type)) {
      const nameNode = n.namedChildren.find((c) => c.type === 'identifier' || c.type === 'name');
      if (nameNode) {
        const name = textFor(code, nameNode);
        // Skip private/internal names (leading underscore)
        if (!name.startsWith('_')) {
          const paramsNode = n.namedChildren.find((c) =>
            c.type === 'parameters' || c.type === 'parameter_list' || c.type === 'formal_parameters',
          );
          const paramStr = paramsNode ? extractParamNames(code, paramsNode).join(', ') : '';
          symbols.push({
            name,
            kind: depth > 0 ? 'method' : 'function',
            signature: `${name}(${paramStr})`,
            exported: true,
          });
        }
      }
    }

    // Classes/structs/traits/modules
    if (config.classNodeTypes.includes(n.type)) {
      const nameNode = n.namedChildren.find((c) =>
        c.type === 'identifier' || c.type === 'type_identifier' || c.type === 'name' || c.type === 'constant',
      );
      if (nameNode) {
        const name = textFor(code, nameNode);
        const kind = n.type.includes('trait') ? 'interface'
          : n.type.includes('enum') ? 'enum'
          : n.type.includes('struct') ? 'class'
          : n.type.includes('impl') ? 'class'
          : n.type.includes('module') ? 'module'
          : 'class';
        symbols.push({
          name,
          kind,
          signature: `${kind} ${name}`,
          exported: true,
        });
      }

      // Recurse into class body for methods
      for (const ch of n.namedChildren) {
        walk(ch, depth + 1);
      }
      return;
    }

    for (const ch of n.namedChildren) {
      walk(ch, depth);
    }
  };

  walk(root);
  tree.delete();
  return symbols;
}

// ── Helpers ──────────────────────────────────────────────────

function extractParamNames(code: string, paramsNode: Parser.SyntaxNode): string[] {
  const params: string[] = [];
  for (const ch of paramsNode.namedChildren) {
    const nameNode = ch.namedChildren.find((c) => c.type === 'identifier' || c.type === 'name');
    if (nameNode) {
      params.push(textFor(code, nameNode));
    }
  }
  return params.slice(0, 4); // Cap at 4 params for readability
}

/** Languages that have generic extractor configs. */
export const GENERIC_LANGUAGE_IDS = Object.keys(LANG_CONFIGS);
