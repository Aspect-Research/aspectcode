/**
 * Entry-point detection — content-aware analysis of source files for
 * runtime entry points, tooling scripts, and barrel/index exports.
 *
 * All functions are pure (no I/O, no vscode).
 */

import { toPosix } from '@aspectcode/core';
import { makeRelativePath } from './helpers';
import { isConfigOrToolingFile } from './classifiers';

// ── Types ────────────────────────────────────────────────────

/** Entry point detection result with category and confidence. */
export interface DetectedEntryPoint {
  path: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  category: 'runtime' | 'tooling' | 'barrel';
  routeCount?: number;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Detect entry points with language-aware content analysis.
 *
 * Categories:
 * - **runtime** — FastAPI / Flask / Express route handlers, main(), lambda
 * - **tooling** — CLI scripts, `if __name__`, config/build tools
 * - **barrel**  — index/mod/__init__ files that primarily re-export
 */
export function detectEntryPointsWithContent(
  files: string[],
  workspaceRoot: string,
  fileContentCache: Map<string, string>,
): DetectedEntryPoint[] {
  const entryPoints: DetectedEntryPoint[] = [];
  const processedPaths = new Set<string>();

  for (const file of files) {
    const relPath = makeRelativePath(file, workspaceRoot);
    if (processedPaths.has(relPath)) continue;
    processedPaths.add(relPath);

    const ext = getExtension(file);
    const basename = getBasename(file, ext);

    const content = fileContentCache.get(file) || '';
    if (!content) continue;

    const result = analyzeFileForEntryPoint(relPath, basename, ext, content);
    if (result) {
      entryPoints.push(result);
    }
  }

  // Sort: runtime first (by route count desc), then tooling, then barrel
  const categoryOrder = { runtime: 0, tooling: 1, barrel: 2 };
  const confidenceOrder = { high: 0, medium: 1, low: 2 };

  entryPoints.sort((a, b) => {
    const catDiff = categoryOrder[a.category] - categoryOrder[b.category];
    if (catDiff !== 0) return catDiff;

    if (a.category === 'runtime' && b.category === 'runtime') {
      const routeDiff = (b.routeCount || 0) - (a.routeCount || 0);
      if (routeDiff !== 0) return routeDiff;
    }

    const confDiff = confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
    if (confDiff !== 0) return confDiff;

    return a.path.localeCompare(b.path);
  });

  return entryPoints;
}

/**
 * Legacy sync entry-point detection (filename-based only).
 * Used as fallback when content cache is empty.
 */
export function detectEntryPointsByName(
  files: string[],
  workspaceRoot: string,
): Array<{ path: string; reason: string; confidence: 'high' | 'medium' | 'low' }> {
  const entryPoints: Array<{
    path: string;
    reason: string;
    confidence: 'high' | 'medium' | 'low';
  }> = [];

  const highConfidence = ['main', '__main__', 'server', 'app'];
  const mediumConfidence = ['index', 'start', 'cli', 'run'];
  const lowConfidence = ['bootstrap', 'init', 'setup'];

  for (const file of files) {
    const ext = getExtension(file);
    const basename = getBasename(file, ext);
    const relPath = makeRelativePath(file, workspaceRoot);

    if (basename === '__main__' && ext === '.py') {
      entryPoints.push({ path: relPath, reason: 'Python main module', confidence: 'high' });
    } else if (highConfidence.includes(basename)) {
      entryPoints.push({ path: relPath, reason: `Entry point (${basename})`, confidence: 'high' });
    } else if (mediumConfidence.includes(basename)) {
      entryPoints.push({
        path: relPath,
        reason: `Entry point (${basename})`,
        confidence: 'medium',
      });
    } else if (lowConfidence.includes(basename)) {
      entryPoints.push({
        path: relPath,
        reason: `Possible entry (${basename})`,
        confidence: 'low',
      });
    }
  }

  return entryPoints;
}

// ── Dispatcher ───────────────────────────────────────────────

function analyzeFileForEntryPoint(
  relPath: string,
  basename: string,
  ext: string,
  content: string,
): DetectedEntryPoint | null {
  const pathLower = relPath.toLowerCase();

  // ── Barrel / Index exports ─────────────────────────────────
  if (basename === 'index' || basename === 'mod' || basename === '__init__') {
    const exportLines = (content.match(/^export\s+/gm) || []).length;
    const fromLines = (content.match(/from\s+['"]/gm) || []).length;
    const totalLines = content.split('\n').filter((l) => l.trim()).length;

    if (totalLines > 0 && (exportLines + fromLines) / totalLines > 0.4) {
      return { path: relPath, reason: 'Re-export barrel', confidence: 'medium', category: 'barrel' };
    }

    if (ext === '.py') {
      const pyReexports = (content.match(/^from\s+\./gm) || []).length;
      if (pyReexports > 2 && pyReexports / Math.max(1, totalLines) > 0.3) {
        return { path: relPath, reason: 'Package re-exports', confidence: 'medium', category: 'barrel' };
      }
    }
  }

  // ── Config / Tooling ───────────────────────────────────────
  if (isConfigOrToolingFile(relPath)) {
    if (
      content.includes('module.exports') ||
      content.includes('export default') ||
      content.includes('defineConfig') ||
      content.includes('createConfig')
    ) {
      return { path: relPath, reason: 'Config/Build tool', confidence: 'high', category: 'tooling' };
    }
    return null;
  }

  // ── Language-specific ──────────────────────────────────────
  if (ext === '.py') return analyzePythonEntryPoint(relPath, basename, content);
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext))
    return analyzeTSJSEntryPoint(relPath, basename, pathLower, content);
  if (ext === '.cs') return analyzeCSharpEntryPoint(relPath, basename, content);
  if (ext === '.java') return analyzeJavaEntryPoint(relPath, basename, content);

  return null;
}

// ── Python ───────────────────────────────────────────────────

function analyzePythonEntryPoint(
  relPath: string,
  basename: string,
  content: string,
): DetectedEntryPoint | null {
  // FastAPI
  const hasFastAPI = content.includes('FastAPI(') || content.includes('from fastapi');
  const fastAPIRoutes = (content.match(/@(app|router)\.(get|post|put|delete|patch|options|head)\s*\(/gi) || []).length;
  if (hasFastAPI && fastAPIRoutes > 0) {
    return { path: relPath, reason: `FastAPI (${fastAPIRoutes} routes)`, confidence: 'high', category: 'runtime', routeCount: fastAPIRoutes };
  }

  // Flask
  const hasFlask = content.includes('Flask(__name__)') || content.includes('from flask import Flask');
  const flaskRoutes = (content.match(/@(app|blueprint|bp)\.(route|get|post|put|delete|patch)\s*\(/gi) || []).length;
  if (hasFlask && flaskRoutes > 0) {
    return { path: relPath, reason: `Flask (${flaskRoutes} routes)`, confidence: 'high', category: 'runtime', routeCount: flaskRoutes };
  }

  // Django URLs
  if (basename === 'urls' && content.includes('urlpatterns')) {
    const urlPatterns = (content.match(/path\s*\(|re_path\s*\(|url\s*\(/g) || []).length;
    return { path: relPath, reason: `Django URLs (${urlPatterns} patterns)`, confidence: 'high', category: 'runtime', routeCount: urlPatterns };
  }

  // Django views
  if (
    basename === 'views' &&
    (content.includes('def get(') || content.includes('def post(') || content.includes('@api_view'))
  ) {
    return { path: relPath, reason: 'Django views', confidence: 'medium', category: 'runtime', routeCount: 1 };
  }

  // Django WSGI/ASGI
  if ((basename === 'wsgi' || basename === 'asgi') && content.includes('application')) {
    return { path: relPath, reason: `Django ${basename.toUpperCase()} entry`, confidence: 'high', category: 'runtime', routeCount: 1 };
  }

  // __main__.py
  if (basename === '__main__') {
    return { path: relPath, reason: 'Python main module', confidence: 'high', category: 'runtime', routeCount: 1 };
  }

  // CLI via click/typer
  if (
    content.includes('@click.command') ||
    content.includes('@click.group') ||
    (content.includes('@app.command') && content.includes('import typer'))
  ) {
    return { path: relPath, reason: 'CLI tool (click/typer)', confidence: 'high', category: 'tooling' };
  }

  // if __name__ == "__main__"
  if (content.includes('if __name__') && content.includes('__main__')) {
    if (content.includes('uvicorn.run') || content.includes('app.run(') || content.includes('.serve(')) {
      return { path: relPath, reason: 'Server entry', confidence: 'high', category: 'runtime', routeCount: 1 };
    }
    return { path: relPath, reason: 'Script entry (__main__)', confidence: 'medium', category: 'tooling' };
  }

  // Generic name-based
  if (['main', 'app', 'server', 'application'].includes(basename)) {
    return { path: relPath, reason: `Entry point (${basename})`, confidence: 'medium', category: 'runtime', routeCount: 0 };
  }

  return null;
}

// ── TypeScript / JavaScript ──────────────────────────────────

function analyzeTSJSEntryPoint(
  relPath: string,
  basename: string,
  pathLower: string,
  content: string,
): DetectedEntryPoint | null {
  // Next.js API routes
  if (pathLower.includes('pages/api/') || pathLower.includes('app/api/')) {
    if (content.includes('export default') || content.includes('export async function')) {
      return { path: relPath, reason: 'Next.js API route', confidence: 'high', category: 'runtime', routeCount: 1 };
    }
  }

  // Next.js middleware
  if (basename === 'middleware' && (pathLower.endsWith('.ts') || pathLower.endsWith('.js'))) {
    if (content.includes('NextRequest') || content.includes('NextResponse')) {
      return { path: relPath, reason: 'Next.js middleware', confidence: 'high', category: 'runtime', routeCount: 1 };
    }
  }

  // Express / Fastify / Koa
  const expressRoutes = (content.match(/\.(get|post|put|delete|patch|use)\s*\(\s*['"]/g) || []).length;
  const hasExpressApp = content.includes('express()') || content.includes('fastify(') || content.includes('new Koa(');
  if (hasExpressApp || expressRoutes > 2) {
    return { path: relPath, reason: `Express/HTTP server (${expressRoutes} routes)`, confidence: expressRoutes > 0 ? 'high' : 'medium', category: 'runtime', routeCount: expressRoutes };
  }

  // NestJS
  if (content.includes('@Controller') || content.includes('@Injectable')) {
    const nestRoutes = (content.match(/@(Get|Post|Put|Delete|Patch|All)\s*\(/g) || []).length;
    if (nestRoutes > 0) {
      return { path: relPath, reason: `NestJS controller (${nestRoutes} routes)`, confidence: 'high', category: 'runtime', routeCount: nestRoutes };
    }
  }

  // Hono
  if (content.includes('new Hono(') || content.includes('Hono.get') || content.includes('app.get(')) {
    const honoRoutes = (content.match(/\.(get|post|put|delete|patch)\s*\(/g) || []).length;
    if (honoRoutes > 0) {
      return { path: relPath, reason: `Hono server (${honoRoutes} routes)`, confidence: 'high', category: 'runtime', routeCount: honoRoutes };
    }
  }

  // require.main === module
  if (content.includes('require.main === module')) {
    return { path: relPath, reason: 'Node.js script entry', confidence: 'medium', category: 'tooling' };
  }

  // bin / CLI
  if (pathLower.includes('/bin/') || pathLower.includes('/cli/')) {
    if (content.includes('#!/') || content.includes('commander') || content.includes('yargs')) {
      return { path: relPath, reason: 'CLI script', confidence: 'medium', category: 'tooling' };
    }
  }

  // Server files by name
  if (['server', 'main', 'app', 'index'].includes(basename)) {
    if (
      content.includes('.listen(') ||
      content.includes('createServer') ||
      content.includes('http.createServer') ||
      content.includes('https.createServer')
    ) {
      return { path: relPath, reason: 'Server entry', confidence: 'high', category: 'runtime', routeCount: 1 };
    }

    if (basename === 'main' || basename === 'server') {
      return { path: relPath, reason: `Entry point (${basename})`, confidence: 'medium', category: 'runtime', routeCount: 0 };
    }
  }

  return null;
}

// ── C# ───────────────────────────────────────────────────────

function analyzeCSharpEntryPoint(
  relPath: string,
  basename: string,
  content: string,
): DetectedEntryPoint | null {
  if (basename === 'program') {
    if (
      content.includes('WebApplication.CreateBuilder') ||
      content.includes('CreateHostBuilder') ||
      content.includes('UseStartup') ||
      content.includes('app.Run()')
    ) {
      const mapRoutes = (content.match(/\.Map(Get|Post|Put|Delete|Patch)\s*\(/g) || []).length;
      return {
        path: relPath,
        reason: `ASP.NET entry${mapRoutes > 0 ? ` (${mapRoutes} routes)` : ''}`,
        confidence: 'high',
        category: 'runtime',
        routeCount: mapRoutes || 1,
      };
    }

    if (content.includes('static void Main') || content.includes('static async Task Main')) {
      return { path: relPath, reason: 'Console app entry', confidence: 'medium', category: 'tooling' };
    }
  }

  if (content.includes('[ApiController]') || content.includes('[Controller]')) {
    const routes = (content.match(/\[(Http(Get|Post|Put|Delete|Patch)|Route)\]/g) || []).length;
    return {
      path: relPath,
      reason: `ASP.NET controller (${routes} routes)`,
      confidence: routes > 0 ? 'high' : 'medium',
      category: 'runtime',
      routeCount: routes,
    };
  }

  if (basename === 'startup' && content.includes('ConfigureServices')) {
    return { path: relPath, reason: 'ASP.NET Startup config', confidence: 'high', category: 'runtime', routeCount: 1 };
  }

  return null;
}

// ── Java ─────────────────────────────────────────────────────

function analyzeJavaEntryPoint(
  relPath: string,
  _basename: string,
  content: string,
): DetectedEntryPoint | null {
  if (content.includes('@SpringBootApplication')) {
    return { path: relPath, reason: 'Spring Boot entry', confidence: 'high', category: 'runtime', routeCount: 1 };
  }

  if (content.includes('@RestController') || content.includes('@Controller')) {
    const mappings = (content.match(/@(Get|Post|Put|Delete|Patch|Request)Mapping/g) || []).length;
    return {
      path: relPath,
      reason: `Spring controller (${mappings} endpoints)`,
      confidence: mappings > 0 ? 'high' : 'medium',
      category: 'runtime',
      routeCount: mappings,
    };
  }

  if (content.includes('@Path(') && (content.includes('@GET') || content.includes('@POST'))) {
    const jaxRoutes = (content.match(/@(GET|POST|PUT|DELETE|PATCH)/g) || []).length;
    return {
      path: relPath,
      reason: `JAX-RS resource (${jaxRoutes} endpoints)`,
      confidence: 'high',
      category: 'runtime',
      routeCount: jaxRoutes,
    };
  }

  if (content.includes('public static void main(String')) {
    if (!content.includes('@SpringBootApplication')) {
      return { path: relPath, reason: 'Java main class', confidence: 'medium', category: 'tooling' };
    }
  }

  return null;
}

// ── Internal ─────────────────────────────────────────────────

function getExtension(filePath: string): string {
  const p = toPosix(filePath);
  const lastDot = p.lastIndexOf('.');
  return lastDot >= 0 ? p.substring(lastDot).toLowerCase() : '';
}

function getBasename(filePath: string, ext: string): string {
  const p = toPosix(filePath);
  const lastSlash = p.lastIndexOf('/');
  const name = lastSlash >= 0 ? p.substring(lastSlash + 1) : p;
  return ext && name.endsWith(ext) ? name.slice(0, -ext.length).toLowerCase() : name.toLowerCase();
}
