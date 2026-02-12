/**
 * Symbol-extraction helpers for the KB emitter.
 *
 * - extractModelSignature  – one-line model signature from content
 * - extractFileSymbolsWithSignatures – all exported symbols in a file
 *
 * Regex-based fallback; tree-sitter support is injected via `grammars`
 * parameter following the existing kb.ts contract.
 *
 * All functions are pure (no I/O, no vscode).
 */

import { toPosix, DependencyLink, ExtractedSymbol } from '@aspectcode/core';
import { getSymbolCallers } from './analyzers';

// Re-export LoadedGrammars shape expected by the caller.
// Each property is either the grammar object or undefined/null.
export interface LoadedGrammars {
  python?: unknown;
  typescript?: unknown;
  tsx?: unknown;
  javascript?: unknown;
  java?: unknown;
  csharp?: unknown;
}

// Extractors per language (injected at call-site from @aspectcode/core)
export type SymbolExtractor = (grammar: unknown, text: string) => ExtractedSymbol[];

export interface SymbolExtractors {
  extractPythonSymbols?: SymbolExtractor;
  extractTSJSSymbols?: SymbolExtractor;
  extractJavaSymbols?: SymbolExtractor;
  extractCSharpSymbols?: SymbolExtractor;
}

// ── extractModelSignature ────────────────────────────────────

/**
 * Extract a one-line signature for a named model/class/interface
 * from the file content cache.
 */
export function extractModelSignature(
  filePath: string,
  modelName: string,
  fileContentCache: Map<string, string>,
): string | null {
  const text = fileContentCache.get(filePath);
  if (!text) return null;
  const lines = text.split('\n');
  const ext = getExtension(filePath);

  let cleanName = modelName;
  cleanName = cleanName.replace(
    /^(Data Class|Pydantic|ORM|Entity|BaseModel|SQLModel|Interface|Type Alias)\s*[:(]\s*/i,
    '',
  );
  cleanName = cleanName.replace(/\s*\([^)]+\)\s*-\s*\w+\s*$/, '');
  cleanName = cleanName.replace(/\s*-\s*(class|function|type|interface)\s*$/i, '');
  cleanName = cleanName.split(/[\s:,]/)[0].trim();

  if (!cleanName || cleanName.length < 2 || !/^[A-Za-z_]/.test(cleanName)) return null;

  if (ext === '.py') return extractPyModelSig(lines, cleanName);
  if (['.ts', '.tsx'].includes(ext)) return extractTSModelSig(lines, cleanName);
  if (ext === '.java') return extractJavaModelSig(lines, cleanName);
  if (ext === '.cs') return extractCSModelSig(lines, cleanName);
  if (ext === '.prisma') return extractPrismaModelSig(lines, cleanName);

  return null;
}

function extractPyModelSig(lines: string[], name: string): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(new RegExp(`^class\\s+${name}\\s*[:(]`))) {
      const classLine = lines[i].trim();
      const fields: string[] = [];
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const m = lines[j].match(/^\s+(\w+):\s*([^\s=]+)/);
        if (m && !m[1].startsWith('_')) { fields.push(`${m[1]}: ${m[2]}`); if (fields.length >= 3) break; }
      }
      return fields.length > 0 ? `${classLine} { ${fields.join(', ')}${fields.length >= 3 ? ', ...' : ''} }` : classLine;
    }
  }
  return null;
}

function extractTSModelSig(lines: string[], name: string): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(new RegExp(`(interface|type|class)\\s+${name}\\s*[{<]`))) {
      const typeLine = lines[i].trim();
      const fields: string[] = [];
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const m = lines[j].match(/^\s+(\w+)(\?)?\s*:\s*([^;]+)/);
        if (m) { fields.push(`${m[1]}${m[2] || ''}: ${m[3].trim()}`); if (fields.length >= 3) break; }
        if (lines[j].includes('}')) break;
      }
      return fields.length > 0
        ? `${typeLine.replace('{', '').trim()} { ${fields.join('; ')}${fields.length >= 3 ? '; ...' : ''} }`
        : typeLine;
    }
  }
  return null;
}

function extractJavaModelSig(lines: string[], name: string): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(new RegExp(`(class|record|interface)\\s+${name}\\s*`))) {
      const classLine = lines[i].trim();
      const recordMatch = lines[i].match(/record\s+\w+\s*\(([^)]+)\)/);
      if (recordMatch) {
        const params = recordMatch[1].split(',').slice(0, 3).map((p) => p.trim());
        return `record ${name}(${params.join(', ')}${params.length >= 3 ? ', ...' : ''})`;
      }
      const fields: string[] = [];
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        const m = lines[j].match(/^\s+(?:private|protected|public)\s+([\w<>\[\]]+)\s+(\w+)\s*[;=]/);
        if (m) { fields.push(`${m[2]}: ${m[1]}`); if (fields.length >= 3) break; }
        if (lines[j].match(/^\s*}/) || lines[j].match(/^\s*(?:public|private|protected).*\(/)) break;
      }
      return fields.length > 0
        ? `${classLine.replace('{', '').trim()} { ${fields.join(', ')}${fields.length >= 3 ? ', ...' : ''} }`
        : classLine.replace('{', '').trim();
    }
  }
  return null;
}

function extractCSModelSig(lines: string[], name: string): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(new RegExp(`(class|record|struct|interface)\\s+${name}\\s*`))) {
      const classLine = lines[i].trim();
      const recordMatch = lines[i].match(/record\s+\w+\s*\(([^)]+)\)/);
      if (recordMatch) {
        const params = recordMatch[1].split(',').slice(0, 3).map((p) => p.trim());
        return `record ${name}(${params.join(', ')}${params.length >= 3 ? ', ...' : ''})`;
      }
      const fields: string[] = [];
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
        const m = lines[j].match(/^\s+(?:public|protected|internal)\s+(?:required\s+)?([\w<>\[\]?]+)\s+(\w+)\s*{/);
        if (m) { fields.push(`${m[2]}: ${m[1]}`); if (fields.length >= 3) break; }
        if (lines[j].match(/^\s*}/) || lines[j].match(/^\s*(?:public|private|protected).*\(/)) break;
      }
      return fields.length > 0
        ? `${classLine.replace('{', '').trim()} { ${fields.join('; ')}${fields.length >= 3 ? '; ...' : ''} }`
        : classLine.replace('{', '').trim();
    }
  }
  return null;
}

function extractPrismaModelSig(lines: string[], name: string): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(new RegExp(`model\\s+${name}\\s*{`))) {
      const fields: string[] = [];
      for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
        const m = lines[j].match(/^\s+(\w+)\s+(String|Int|Float|Boolean|DateTime|Json|Bytes|BigInt|\w+)(\?)?(\[\])?/);
        if (m) {
          fields.push(`${m[1]}: ${m[2]}${m[3] || ''}${m[4] || ''}`);
          if (fields.length >= 4) break;
        }
        if (lines[j].trim() === '}') break;
      }
      return fields.length > 0
        ? `model ${name} { ${fields.join(', ')}${fields.length >= 4 ? ', ...' : ''} }`
        : `model ${name}`;
    }
  }
  return null;
}

// ── extractFileSymbolsWithSignatures ─────────────────────────

/**
 * Extract all exported symbols from a file with optional tree-sitter support.
 * Falls back to regex-based extraction when grammars are not available.
 */
export function extractFileSymbolsWithSignatures(
  filePath: string,
  allLinks: DependencyLink[],
  workspaceRoot: string,
  grammars: LoadedGrammars | null | undefined,
  fileContentCache: Map<string, string>,
  extractors?: SymbolExtractors,
): Array<{ name: string; kind: string; signature: string | null; calledBy: string[] }> {
  const symbols: Array<{ name: string; kind: string; signature: string | null; calledBy: string[] }> = [];

  const text = fileContentCache.get(filePath);
  if (!text) return symbols;

  const ext = getExtension(filePath);

  // Try tree-sitter
  let extracted: ExtractedSymbol[] | null = null;
  if (grammars && extractors) {
    try {
      if (ext === '.py' && grammars.python && extractors.extractPythonSymbols) {
        extracted = extractors.extractPythonSymbols(grammars.python, text);
      } else if (ext === '.ts' && grammars.typescript && extractors.extractTSJSSymbols) {
        extracted = extractors.extractTSJSSymbols(grammars.typescript, text);
      } else if (ext === '.tsx' && grammars.tsx && extractors.extractTSJSSymbols) {
        extracted = extractors.extractTSJSSymbols(grammars.tsx, text);
      } else if ((ext === '.js' || ext === '.jsx') && grammars.javascript && extractors.extractTSJSSymbols) {
        extracted = extractors.extractTSJSSymbols(grammars.javascript, text);
      } else if (ext === '.java' && grammars.java && extractors.extractJavaSymbols) {
        extracted = extractors.extractJavaSymbols(grammars.java, text);
      } else if (ext === '.cs' && grammars.csharp && extractors.extractCSharpSymbols) {
        extracted = extractors.extractCSharpSymbols(grammars.csharp, text);
      }
    } catch {
      extracted = null;
    }
  }

  if (extracted && extracted.length > 0) {
    for (const sym of extracted) {
      if (sym.exported || ext === '.py' || ext === '.java' || ext === '.cs') {
        symbols.push({
          name: sym.name,
          kind: sym.kind,
          signature: sym.signature,
          calledBy: getSymbolCallers(sym.name, filePath, allLinks, workspaceRoot),
        });
      }
    }
    return symbols;
  }

  // Regex fallback
  const lines = text.split('\n');

  if (ext === '.py') extractPySymbols(lines, filePath, allLinks, workspaceRoot, symbols);
  else if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) extractTSJSSymbolsFallback(lines, filePath, allLinks, workspaceRoot, symbols);
  else if (ext === '.java') extractJavaSymbolsFallback(lines, filePath, allLinks, workspaceRoot, symbols);
  else if (ext === '.cs') extractCSSymbolsFallback(lines, filePath, allLinks, workspaceRoot, symbols);

  return symbols;
}

// ── Regex extractors ─────────────────────────────────────────

type SymbolResult = Array<{ name: string; kind: string; signature: string | null; calledBy: string[] }>;

function extractPySymbols(lines: string[], filePath: string, allLinks: DependencyLink[], workspaceRoot: string, symbols: SymbolResult): void {
  for (const line of lines) {
    const funcMatch = line.match(/^def\s+(\w+)\s*\(([^)]*)\)/);
    if (funcMatch && !funcMatch[1].startsWith('_')) {
      const params = funcMatch[2].split(',').slice(0, 3).map((p) => p.trim().split(':')[0].split('=')[0].trim()).filter((p) => p && p !== 'self');
      symbols.push({
        name: funcMatch[1],
        kind: 'function',
        signature: `def ${funcMatch[1]}(${params.join(', ')})`,
        calledBy: getSymbolCallers(funcMatch[1], filePath, allLinks, workspaceRoot),
      });
    }
    const classMatch = line.match(/^class\s+(\w+)(?:\(([^)]*)\))?/);
    if (classMatch) {
      const bases = classMatch[2] ? classMatch[2].split(',')[0].trim() : '';
      symbols.push({
        name: classMatch[1],
        kind: 'class',
        signature: bases ? `class ${classMatch[1]}(${bases})` : `class ${classMatch[1]}`,
        calledBy: getSymbolCallers(classMatch[1], filePath, allLinks, workspaceRoot),
      });
    }
  }
}

function extractTSJSSymbolsFallback(lines: string[], filePath: string, allLinks: DependencyLink[], workspaceRoot: string, symbols: SymbolResult): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const funcMatch = line.match(/export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/);
    if (funcMatch) {
      const params = funcMatch[2].split(',').slice(0, 3).map((p) => p.trim().split(':')[0].split('=')[0].trim()).filter((p) => p);
      symbols.push({ name: funcMatch[1], kind: 'function', signature: `function ${funcMatch[1]}(${params.join(', ')})`, calledBy: getSymbolCallers(funcMatch[1], filePath, allLinks, workspaceRoot) });
      continue;
    }

    const classMatch = line.match(/export\s+(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (classMatch) {
      const ext = classMatch[2] ? ` extends ${classMatch[2]}` : '';
      symbols.push({ name: classMatch[1], kind: 'class', signature: `class ${classMatch[1]}${ext}`, calledBy: getSymbolCallers(classMatch[1], filePath, allLinks, workspaceRoot) });
      continue;
    }

    const ifMatch = line.match(/export\s+interface\s+(\w+)/);
    if (ifMatch) {
      symbols.push({ name: ifMatch[1], kind: 'interface', signature: `interface ${ifMatch[1]}`, calledBy: getSymbolCallers(ifMatch[1], filePath, allLinks, workspaceRoot) });
      continue;
    }

    const typeMatch = line.match(/export\s+type\s+(\w+)\s*=/);
    if (typeMatch) {
      symbols.push({ name: typeMatch[1], kind: 'type', signature: `type ${typeMatch[1]}`, calledBy: getSymbolCallers(typeMatch[1], filePath, allLinks, workspaceRoot) });
      continue;
    }

    const arrowFnMatch = line.match(/export\s+const\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*\S+)?\s*=>/);
    if (arrowFnMatch) {
      const params = arrowFnMatch[2].split(',').slice(0, 3).map((p) => p.trim().split(':')[0].split('=')[0].trim()).filter((p) => p);
      symbols.push({ name: arrowFnMatch[1], kind: 'const', signature: `const ${arrowFnMatch[1]} = (${params.join(', ')}) =>`, calledBy: getSymbolCallers(arrowFnMatch[1], filePath, allLinks, workspaceRoot) });
      continue;
    }

    const arrowSingle = line.match(/export\s+const\s+(\w+)\s*=\s*(?:async\s+)?(\w+)\s*=>/);
    if (arrowSingle) {
      symbols.push({ name: arrowSingle[1], kind: 'const', signature: `const ${arrowSingle[1]} = (${arrowSingle[2]}) =>`, calledBy: getSymbolCallers(arrowSingle[1], filePath, allLinks, workspaceRoot) });
      continue;
    }

    const constMatch = line.match(/export\s+const\s+(\w+)\s*[:=]/);
    if (constMatch) {
      let sig: string | null = null;
      if (i + 1 < lines.length) {
        const nextArrow = lines[i + 1].match(/^\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*\S+)?\s*=>/);
        if (nextArrow) {
          const params = nextArrow[1].split(',').slice(0, 3).map((p) => p.trim().split(':')[0].split('=')[0].trim()).filter((p) => p);
          sig = `const ${constMatch[1]} = (${params.join(', ')}) =>`;
        }
      }
      symbols.push({ name: constMatch[1], kind: 'const', signature: sig, calledBy: getSymbolCallers(constMatch[1], filePath, allLinks, workspaceRoot) });
    }
  }
}

function extractJavaSymbolsFallback(lines: string[], filePath: string, allLinks: DependencyLink[], workspaceRoot: string, symbols: SymbolResult): void {
  for (const line of lines) {
    const methodMatch = line.match(/^\s*(?:public|protected)\s+(?:static\s+)?(?:async\s+)?([\w<>\[\],\s]+)\s+(\w+)\s*\(([^)]*)\)/);
    if (methodMatch && !methodMatch[2].startsWith('_')) {
      const retType = methodMatch[1].trim();
      const params = methodMatch[3].split(',').slice(0, 3).map((p) => p.trim().split(/\s+/).pop() || '').filter((p) => p);
      symbols.push({ name: methodMatch[2], kind: 'method', signature: `${retType} ${methodMatch[2]}(${params.join(', ')})`, calledBy: getSymbolCallers(methodMatch[2], filePath, allLinks, workspaceRoot) });
    }
    const classMatch = line.match(/^\s*(?:public|protected)?\s*(?:abstract\s+)?(?:class|interface|record)\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/);
    if (classMatch) {
      const ext = classMatch[2] ? ` extends ${classMatch[2]}` : '';
      const impl = classMatch[3] ? ` implements ${classMatch[3].split(',')[0].trim()}` : '';
      const kind = line.includes('interface') ? 'interface' : line.includes('record') ? 'record' : 'class';
      symbols.push({ name: classMatch[1], kind, signature: `class ${classMatch[1]}${ext}${impl}`, calledBy: getSymbolCallers(classMatch[1], filePath, allLinks, workspaceRoot) });
    }
  }
}

function extractCSSymbolsFallback(lines: string[], filePath: string, allLinks: DependencyLink[], workspaceRoot: string, symbols: SymbolResult): void {
  for (const line of lines) {
    const methodMatch = line.match(/^\s*(?:public|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:virtual\s+)?(?:override\s+)?([\w<>\[\],\s?]+)\s+(\w+)\s*\(([^)]*)\)/);
    if (methodMatch && !methodMatch[2].startsWith('_')) {
      const retType = methodMatch[1].trim();
      const params = methodMatch[3].split(',').slice(0, 3).map((p) => p.trim().split(/\s+/).pop() || '').filter((p) => p);
      symbols.push({ name: methodMatch[2], kind: 'method', signature: `${retType} ${methodMatch[2]}(${params.join(', ')})`, calledBy: getSymbolCallers(methodMatch[2], filePath, allLinks, workspaceRoot) });
    }
    const classMatch = line.match(/^\s*(?:public|protected|internal)?\s*(?:abstract\s+)?(?:partial\s+)?(?:class|interface|record|struct)\s+(\w+)(?:\s*:\s*([\w,\s]+))?/);
    if (classMatch) {
      const baseClause = classMatch[2] ? ` : ${classMatch[2].split(',')[0].trim()}` : '';
      const kind = line.includes('interface') ? 'interface' : line.includes('record') ? 'record' : line.includes('struct') ? 'struct' : 'class';
      symbols.push({ name: classMatch[1], kind, signature: `${kind} ${classMatch[1]}${baseClause}`, calledBy: getSymbolCallers(classMatch[1], filePath, allLinks, workspaceRoot) });
    }
    const propMatch = line.match(/^\s*(?:public|protected|internal)\s+(?:static\s+)?(?:virtual\s+)?(?:override\s+)?([\w<>\[\],\s?]+)\s+(\w+)\s*{\s*get/);
    if (propMatch) {
      symbols.push({ name: propMatch[2], kind: 'property', signature: `${propMatch[1].trim()} ${propMatch[2]}`, calledBy: getSymbolCallers(propMatch[2], filePath, allLinks, workspaceRoot) });
    }
  }
}

// ── Internal ─────────────────────────────────────────────────

function getExtension(filePath: string): string {
  const p = toPosix(filePath);
  const lastDot = p.lastIndexOf('.');
  return lastDot >= 0 ? p.substring(lastDot).toLowerCase() : '';
}
