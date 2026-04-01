/**
 * TypeScript/JavaScript import and symbol extraction using tree-sitter AST.
 *
 * Pure functions — no vscode dependency, only web-tree-sitter.
 */

import Parser from 'web-tree-sitter';
import type { ExtractedSymbol } from '../model';
import { textFor } from './utils';

// ── Import extraction ────────────────────────────────────────

/**
 * Extract TS/JS import module specifiers from source code.
 *
 * Handles ES `import … from "…"`, CommonJS `require("…")`,
 * and dynamic `import("…")`.
 */
export function extractTSJSImports(lang: Parser.Language, code: string): string[] {
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  const out: string[] = [];

  const walk = (n: Parser.SyntaxNode) => {
    if (n.type === 'import_statement' || n.type === 'import_declaration') {
      const source = n.namedChildren.find(
        (ch) => ch.type === 'string' || ch.type === 'string_literal',
      );
      if (source) {
        const txt = textFor(code, source).trim();
        const m = txt.match(/^['"](.+?)['"]$/);
        if (m) out.push(m[1]);
      }
    }

    if (n.type === 'call_expression') {
      const callee = n.child(0);
      if (callee && callee.type === 'identifier' && textFor(code, callee) === 'require') {
        // The string argument is inside the `arguments` node, not a direct child
        const argsNode = n.namedChildren.find((ch) => ch.type === 'arguments');
        const searchIn = argsNode ? argsNode.namedChildren : n.namedChildren;
        const arg = searchIn.find(
          (ch) => ch.type === 'string' || ch.type === 'string_literal',
        );
        if (arg) {
          const m = textFor(code, arg)
            .trim()
            .match(/^['"](.+?)['"]$/);
          if (m) out.push(m[1]);
        }
      }
    }

    for (const ch of n.namedChildren) {
      walk(ch);
    }
  };

  walk(root);
  tree.delete();
  return out;
}

// ── Symbol extraction ────────────────────────────────────────

/**
 * Extract symbols from TypeScript/JavaScript code.
 *
 * Covers: functions, classes, interfaces, type aliases, const
 * declarations (including arrow functions), and abstract classes.
 */
export function extractTSJSSymbols(lang: Parser.Language, code: string): ExtractedSymbol[] {
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(code);
  const root = tree.rootNode;
  const symbols: ExtractedSymbol[] = [];

  const walk = (n: Parser.SyntaxNode) => {
    if (n.type === 'export_statement') {
      const declaration = n.namedChildren.find(
        (ch) =>
          ch.type === 'function_declaration' ||
          ch.type === 'class_declaration' ||
          ch.type === 'interface_declaration' ||
          ch.type === 'type_alias_declaration' ||
          ch.type === 'lexical_declaration' ||
          ch.type === 'abstract_class_declaration',
      );

      if (declaration) {
        extractDeclaration(declaration, true);
      }
    }

    if (
      [
        'function_declaration',
        'class_declaration',
        'interface_declaration',
        'abstract_class_declaration',
      ].includes(n.type)
    ) {
      if (n.parent?.type !== 'export_statement') {
        extractDeclaration(n, false);
      }
    }

    for (const ch of n.namedChildren) {
      walk(ch);
    }
  };

  const extractDeclaration = (n: Parser.SyntaxNode, exported: boolean) => {
    if (n.type === 'function_declaration') {
      const nameNode = n.namedChildren.find((ch) => ch.type === 'identifier');
      const paramsNode = n.namedChildren.find((ch) => ch.type === 'formal_parameters');

      if (nameNode) {
        const name = textFor(code, nameNode);
        const params = paramsNode ? extractTSJSParams(code, paramsNode) : [];
        symbols.push({
          name,
          kind: 'function',
          signature: `function ${name}(${params.join(', ')})`,
          exported,
        });
      }
    }

    if (n.type === 'class_declaration' || n.type === 'abstract_class_declaration') {
      const nameNode = n.namedChildren.find((ch) => ch.type === 'type_identifier');
      const heritageNode = n.namedChildren.find((ch) => ch.type === 'class_heritage');

      if (nameNode) {
        const name = textFor(code, nameNode);
        let inherits: string | undefined;

        if (heritageNode) {
          const extendsClause = heritageNode.namedChildren.find(
            (ch) => ch.type === 'extends_clause',
          );
          if (extendsClause) {
            const typeId = extendsClause.namedChildren.find(
              (ch) => ch.type === 'type_identifier' || ch.type === 'identifier',
            );
            if (typeId) {
              inherits = textFor(code, typeId);
            }
          }
        }

        symbols.push({
          name,
          kind: 'class',
          signature: inherits ? `class ${name} extends ${inherits}` : `class ${name}`,
          inherits,
          exported,
        });
      }
    }

    if (n.type === 'interface_declaration') {
      const nameNode = n.namedChildren.find((ch) => ch.type === 'type_identifier');
      const extendsClause = n.namedChildren.find((ch) => ch.type === 'extends_type_clause');

      if (nameNode) {
        const name = textFor(code, nameNode);
        let inherits: string | undefined;

        if (extendsClause) {
          const typeId = extendsClause.namedChildren.find(
            (ch) => ch.type === 'type_identifier' || ch.type === 'generic_type',
          );
          if (typeId) {
            inherits = textFor(code, typeId);
          }
        }

        symbols.push({
          name,
          kind: 'interface',
          signature: inherits ? `interface ${name} extends ${inherits}` : `interface ${name}`,
          inherits,
          exported,
        });
      }
    }

    if (n.type === 'type_alias_declaration') {
      const nameNode = n.namedChildren.find((ch) => ch.type === 'type_identifier');
      if (nameNode) {
        const name = textFor(code, nameNode);
        symbols.push({
          name,
          kind: 'type',
          signature: `type ${name}`,
          exported,
        });
      }
    }

    if (n.type === 'lexical_declaration') {
      for (const declarator of n.namedChildren) {
        if (declarator.type === 'variable_declarator') {
          const nameNode = declarator.namedChildren.find((ch) => ch.type === 'identifier');
          if (nameNode) {
            const name = textFor(code, nameNode);

            const arrowFn = declarator.namedChildren.find((ch) => ch.type === 'arrow_function');
            if (arrowFn) {
              const paramsNode = arrowFn.namedChildren.find(
                (ch) => ch.type === 'formal_parameters' || ch.type === 'identifier',
              );
              let params: string[] = [];
              if (paramsNode) {
                if (paramsNode.type === 'formal_parameters') {
                  params = extractTSJSParams(code, paramsNode);
                } else if (paramsNode.type === 'identifier') {
                  params = [textFor(code, paramsNode)];
                }
              }
              const paramStr = params.length > 0 ? params.join(', ') : '';
              symbols.push({
                name,
                kind: 'const',
                signature: `const ${name} = (${paramStr}) =>`,
                exported,
              });
            } else {
              symbols.push({
                name,
                kind: 'const',
                signature: `const ${name}`,
                exported,
              });
            }
          }
        }
      }
    }
  };

  walk(root);
  tree.delete();
  return symbols;
}

// ── Helpers ──────────────────────────────────────────────────

function extractTSJSParams(code: string, paramsNode: Parser.SyntaxNode): string[] {
  const params: string[] = [];
  for (const ch of paramsNode.namedChildren) {
    if (ch.type === 'identifier') {
      params.push(textFor(code, ch));
    } else if (ch.type === 'required_parameter' || ch.type === 'optional_parameter') {
      const pattern = ch.namedChildren.find(
        (c) => c.type === 'identifier' || c.type === 'object_pattern' || c.type === 'array_pattern',
      );
      if (pattern) {
        if (pattern.type === 'identifier') {
          params.push(textFor(code, pattern));
        } else {
          params.push('...');
        }
      }
    } else if (ch.type === 'rest_pattern') {
      const idNode = ch.namedChildren.find((c) => c.type === 'identifier');
      if (idNode) {
        params.push('...' + textFor(code, idNode));
      }
    }
  }
  return params.slice(0, 4);
}
