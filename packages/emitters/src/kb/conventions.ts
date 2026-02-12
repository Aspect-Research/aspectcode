/**
 * Convention-analysis helpers — file-naming, function-naming, class-naming,
 * import patterns, test-naming, and framework detection.
 *
 * Functions that originally did I/O via vscode.workspace.fs now accept
 * a `fileContentCache` parameter.
 *
 * All functions are pure (no I/O, no vscode).
 */

import { toPosix } from '@aspectcode/core';
import { makeRelativePath } from './helpers';

// ── File naming ──────────────────────────────────────────────

export function analyzeFileNaming(
  files: string[],
  _workspaceRoot: string,
): {
  patterns: Array<{ style: string; example: string; count: number }>;
  dominant: string | null;
} {
  const styleCounts: Record<string, { count: number; examples: string[] }> = {
    'kebab-case': { count: 0, examples: [] },
    snake_case: { count: 0, examples: [] },
    camelCase: { count: 0, examples: [] },
    PascalCase: { count: 0, examples: [] },
  };

  for (const file of files) {
    const basename = getBasenameNoExt(file);
    if (basename === 'index' || basename.includes('test') || basename.includes('spec')) continue;

    const fileName = getFilename(file);

    if (basename.includes('-')) {
      styleCounts['kebab-case'].count++;
      if (styleCounts['kebab-case'].examples.length < 3) styleCounts['kebab-case'].examples.push(fileName);
    } else if (basename.includes('_')) {
      styleCounts['snake_case'].count++;
      if (styleCounts['snake_case'].examples.length < 3) styleCounts['snake_case'].examples.push(fileName);
    } else if (
      basename[0] === basename[0].toUpperCase() &&
      basename[0] !== basename[0].toLowerCase()
    ) {
      styleCounts['PascalCase'].count++;
      if (styleCounts['PascalCase'].examples.length < 3) styleCounts['PascalCase'].examples.push(fileName);
    } else if (/[a-z][A-Z]/.test(basename)) {
      styleCounts['camelCase'].count++;
      if (styleCounts['camelCase'].examples.length < 3) styleCounts['camelCase'].examples.push(fileName);
    }
  }

  const patterns = Object.entries(styleCounts)
    .filter(([_, data]) => data.count > 0)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([style, data]) => ({ style, example: data.examples[0] || '', count: data.count }));

  const dominant =
    patterns.length > 0 && patterns[0].count > files.length * 0.3 ? patterns[0].style : null;

  return { patterns, dominant };
}

// ── Function naming ──────────────────────────────────────────

export function analyzeFunctionNaming(
  files: string[],
  fileContentCache: Map<string, string>,
): {
  patterns: Array<{ pattern: string; example: string; usage: string }>;
} {
  const patternCounts: Record<string, { count: number; examples: string[] }> = {
    'get_*': { count: 0, examples: [] },
    'set_*': { count: 0, examples: [] },
    'create_*': { count: 0, examples: [] },
    'delete_*': { count: 0, examples: [] },
    'update_*': { count: 0, examples: [] },
    'is_*': { count: 0, examples: [] },
    'has_*': { count: 0, examples: [] },
    'handle_*': { count: 0, examples: [] },
    'process_*': { count: 0, examples: [] },
    'validate_*': { count: 0, examples: [] },
  };

  const sampleFiles = [...files].sort().slice(0, 50);

  for (const file of sampleFiles) {
    const text = fileContentCache.get(file);
    if (!text) continue;

    // Python
    for (const match of text.matchAll(/def\s+(\w+)\s*\(/g)) {
      categorizeFunction(match[1], patternCounts);
    }
    // TypeScript / JavaScript
    for (const match of text.matchAll(/function\s+(\w+)\s*\(|const\s+(\w+)\s*=\s*(?:async\s+)?\(/g)) {
      categorizeFunction(match[1] || match[2], patternCounts);
    }
    // Java
    for (const match of text.matchAll(/(?:public|protected|private)\s+(?:static\s+)?\w+\s+(\w+)\s*\(/g)) {
      categorizeFunction(match[1], patternCounts);
    }
    // C#
    for (const match of text.matchAll(/(?:public|protected|private|internal)\s+(?:static\s+)?(?:async\s+)?\w+\s+(\w+)\s*\(/g)) {
      categorizeFunction(match[1], patternCounts);
    }
  }

  const patterns = Object.entries(patternCounts)
    .filter(([_, data]) => data.count > 0)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([pattern, data]) => ({
      pattern,
      example: data.examples[0] || pattern.replace('*', 'example'),
      usage: `${data.count} occurrences`,
    }));

  return { patterns };
}

function categorizeFunction(
  name: string,
  counts: Record<string, { count: number; examples: string[] }>,
): void {
  const funPatterns: Array<[string, RegExp]> = [
    ['get_*', /^get[_A-Z]/],
    ['set_*', /^set[_A-Z]/],
    ['create_*', /^create[_A-Z]/],
    ['delete_*', /^delete[_A-Z]/],
    ['update_*', /^update[_A-Z]/],
    ['is_*', /^is[_A-Z]/],
    ['has_*', /^has[_A-Z]/],
    ['handle_*', /^handle[_A-Z]/],
    ['process_*', /^process[_A-Z]/],
    ['validate_*', /^validate[_A-Z]/],
  ];

  for (const [pattern, regex] of funPatterns) {
    if (regex.test(name)) {
      counts[pattern].count++;
      if (counts[pattern].examples.length < 3) counts[pattern].examples.push(name);
      break;
    }
  }
}

// ── Class naming ─────────────────────────────────────────────

export function analyzeClassNaming(
  files: string[],
  fileContentCache: Map<string, string>,
): {
  patterns: Array<{ pattern: string; example: string; usage: string }>;
} {
  const suffixCounts: Record<string, { count: number; examples: string[] }> = {
    '*Service': { count: 0, examples: [] },
    '*Controller': { count: 0, examples: [] },
    '*Handler': { count: 0, examples: [] },
    '*Model': { count: 0, examples: [] },
    '*Repository': { count: 0, examples: [] },
    '*Manager': { count: 0, examples: [] },
    '*Provider': { count: 0, examples: [] },
    '*Factory': { count: 0, examples: [] },
    '*Component': { count: 0, examples: [] },
    '*View': { count: 0, examples: [] },
  };

  const sampleFiles = [...files].sort().slice(0, 50);

  for (const file of sampleFiles) {
    const text = fileContentCache.get(file);
    if (!text) continue;

    for (const match of text.matchAll(/class\s+(\w+)/g)) {
      categorizeClass(match[1], suffixCounts);
    }
  }

  const patterns = Object.entries(suffixCounts)
    .filter(([_, data]) => data.count > 0)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([pattern, data]) => ({
      pattern,
      example: data.examples[0] || pattern.replace('*', 'User'),
      usage: `${data.count} classes`,
    }));

  return { patterns };
}

function categorizeClass(
  name: string,
  counts: Record<string, { count: number; examples: string[] }>,
): void {
  const suffixes = [
    'Service', 'Controller', 'Handler', 'Model', 'Repository',
    'Manager', 'Provider', 'Factory', 'Component', 'View',
  ];
  for (const suffix of suffixes) {
    if (name.endsWith(suffix)) {
      const key = `*${suffix}`;
      counts[key].count++;
      if (counts[key].examples.length < 3) counts[key].examples.push(name);
      break;
    }
  }
}

// ── Import patterns ──────────────────────────────────────────

export function analyzeImportPatterns(
  files: string[],
  fileContentCache: Map<string, string>,
): Array<{ language: string; example: string }> {
  const patterns: Array<{ language: string; example: string }> = [];

  const languageExtMap: Array<{
    lang: string;
    extensions: string[];
    lineFilter: (l: string) => boolean;
  }> = [
    { lang: 'Python', extensions: ['.py'], lineFilter: (l) => l.startsWith('import ') || l.startsWith('from ') },
    { lang: 'TypeScript', extensions: ['.ts', '.tsx'], lineFilter: (l) => l.startsWith('import ') },
    { lang: 'Java', extensions: ['.java'], lineFilter: (l) => l.trim().startsWith('import ') },
    { lang: 'C#', extensions: ['.cs'], lineFilter: (l) => l.trim().startsWith('using ') && l.includes(';') },
  ];

  for (const { lang, extensions, lineFilter } of languageExtMap) {
    if (patterns.some((p) => p.language === lang)) continue;

    const langFiles = files
      .filter((f) => extensions.some((e) => f.endsWith(e)))
      .sort()
      .slice(0, 3);

    for (const file of langFiles) {
      const text = fileContentCache.get(file);
      if (!text) continue;

      const lines = text.split('\n').slice(0, 30);
      const imports = lines.filter(lineFilter);
      if (imports.length >= 2) {
        patterns.push({ language: lang, example: imports.slice(0, 4).join('\n') });
        break;
      }
    }
  }

  return patterns;
}

// ── Test naming ──────────────────────────────────────────────

export function analyzeTestNaming(
  files: string[],
  _workspaceRoot: string,
): {
  patterns: Array<{ pattern: string; example: string }>;
} {
  const patterns: Array<{ pattern: string; example: string }> = [];
  const seenPatterns = new Set<string>();

  const testFiles = files.filter((f) => {
    const basename = getFilename(f).toLowerCase();
    return basename.includes('test') || basename.includes('spec');
  });

  for (const file of testFiles.sort().slice(0, 10)) {
    const basename = getFilename(file);

    if (basename.startsWith('test_') && !seenPatterns.has('test_*.py')) {
      patterns.push({ pattern: 'test_*.py', example: basename });
      seenPatterns.add('test_*.py');
    } else if (basename.endsWith('.test.ts') && !seenPatterns.has('*.test.ts')) {
      patterns.push({ pattern: '*.test.ts', example: basename });
      seenPatterns.add('*.test.ts');
    } else if (basename.endsWith('.spec.ts') && !seenPatterns.has('*.spec.ts')) {
      patterns.push({ pattern: '*.spec.ts', example: basename });
      seenPatterns.add('*.spec.ts');
    } else if (basename.endsWith('_test.py') && !seenPatterns.has('*_test.py')) {
      patterns.push({ pattern: '*_test.py', example: basename });
      seenPatterns.add('*_test.py');
    }
  }

  return { patterns };
}

// ── Framework detection ──────────────────────────────────────

export function detectFrameworkPatterns(
  files: string[],
  _workspaceRoot: string,
): Array<{ name: string; patterns: string[] }> {
  const frameworks: Array<{ name: string; patterns: string[] }> = [];
  const fileNames = files.map((f) => getFilename(f).toLowerCase());
  const dirNames = files.map((f) => f.toLowerCase());

  // FastAPI
  if (
    fileNames.some((f) => f.includes('fastapi')) ||
    dirNames.some((d) => d.includes('/api/') || d.includes('/routes/'))
  ) {
    frameworks.push({
      name: 'FastAPI',
      patterns: [
        'Use `@app.get()`, `@app.post()` decorators for routes',
        'Use Pydantic models for request/response schemas',
        'Use `Depends()` for dependency injection',
        'Place routes in `/routes` or `/api` directories',
      ],
    });
  }

  // React
  if (
    fileNames.some((f) => f.endsWith('.tsx') || f.endsWith('.jsx')) ||
    dirNames.some((d) => d.includes('/components/'))
  ) {
    frameworks.push({
      name: 'React',
      patterns: [
        'Components in `/components` directory',
        'Hooks start with `use` prefix (e.g., `useAuth`)',
        'State management with hooks or context',
        'PascalCase for component file names',
      ],
    });
  }

  // Next.js
  if (dirNames.some((d) => d.includes('/pages/') || d.includes('/app/'))) {
    frameworks.push({
      name: 'Next.js',
      patterns: [
        'Pages in `/pages` or `/app` for routing',
        'API routes in `/pages/api` or `/app/api`',
        'Use `getServerSideProps` or server components',
        'Static assets in `/public`',
      ],
    });
  }

  // Django (conservative — require multiple signals)
  const baseNames = new Set(fileNames);
  const strongProjectSignal =
    baseNames.has('manage.py') && (baseNames.has('settings.py') || baseNames.has('urls.py'));
  const strongAppSignal =
    baseNames.has('models.py') && (baseNames.has('views.py') || baseNames.has('urls.py'));

  if (strongProjectSignal || strongAppSignal) {
    frameworks.push({
      name: 'Django',
      patterns: [
        'Models in `models.py`, views in `views.py`',
        'URL patterns in `urls.py`',
        'Forms in `forms.py`',
        'Admin customization in `admin.py`',
      ],
    });
  }

  // Spring Boot
  const javaFiles = fileNames.filter((f) => f.endsWith('.java'));
  const hasSpringApp = javaFiles.some((f) => f.includes('application'));
  const hasController = dirNames.some((d) => d.includes('/controller/') || d.includes('/controllers/'));
  const hasService = dirNames.some((d) => d.includes('/service/') || d.includes('/services/'));

  if (javaFiles.length > 0 && (hasSpringApp || (hasController && hasService))) {
    frameworks.push({
      name: 'Spring Boot',
      patterns: [
        'Use `@RestController` or `@Controller` for HTTP endpoints',
        'Use `@Service` for business logic, `@Repository` for data access',
        'Use `@Autowired` or constructor injection for dependencies',
        'Use `@Entity` with JPA for ORM models',
        'Place controllers in `/controller`, services in `/service`',
      ],
    });
  }

  // ASP.NET Core
  const csFiles = fileNames.filter((f) => f.endsWith('.cs'));
  const hasProgramCs = csFiles.some((f) => f === 'program.cs');
  const hasStartupCs = csFiles.some((f) => f === 'startup.cs');
  const hasCsControllers = dirNames.some((d) => d.includes('/controllers/'));

  if (csFiles.length > 0 && (hasProgramCs || hasStartupCs || hasCsControllers)) {
    frameworks.push({
      name: 'ASP.NET Core',
      patterns: [
        'Use `[ApiController]` and `[Route]` attributes for HTTP endpoints',
        'Use `[HttpGet]`, `[HttpPost]` etc. for HTTP methods',
        'Register services in `Program.cs` or `Startup.cs`',
        'Use Entity Framework Core with `DbContext` for data access',
        'Place controllers in `/Controllers`, models in `/Models`',
      ],
    });
  }

  return frameworks;
}

// ── Fix templates (for awareness/context content) ────────────

export function getFixTemplate(rule: string): string | null {
  const templates: Record<string, string> = {
    'sec.sql_injection_concat': 'Use parameterized queries: `db.execute(sql, (param,))`',
    'sec.hardcoded_secret': 'Use environment variables: `os.environ.get("SECRET")`',
    'sec.path_traversal': 'Validate paths: `os.path.realpath(path).startswith(allowed_dir)`',
    'sec.open_redirect': 'Validate redirect URLs against allowlist',
    'sec.insecure_random': 'Use `secrets` module for security-sensitive randomness',
    'bug.float_equality': 'Use `math.isclose(a, b)` for float comparison',
    'bug.iteration_modification': 'Iterate over a copy: `for item in list(items):`',
    'errors.swallowed_exception': 'Log exceptions: `except Exception as e: logger.error(e)`',
    'errors.broad_catch': 'Catch specific exceptions: `except ValueError:`',
    'deadcode.unused_variable': 'Remove or prefix with `_`: `_unused = value`',
    'imports.unused': 'Remove unused imports',
    'complexity.high_cyclomatic': 'Extract helper functions to reduce branches',
    'complexity.long_function': 'Split into smaller, focused functions',
  };
  return templates[rule] || null;
}

// ── Test organization ────────────────────────────────────────

export function analyzeTestOrganization(
  files: string[],
  workspaceRoot: string,
): {
  testFiles: string[];
  testDirs: string[];
  testPatterns: string[];
} {
  const testFiles: string[] = [];
  const testDirs = new Set<string>();
  const testPatterns = new Set<string>();

  for (const file of files) {
    const basename = getFilename(file).toLowerCase();
    const relPath = makeRelativePath(file, workspaceRoot);
    const relDir = toPosix(relPath).split('/').slice(0, -1).join('/');

    if (basename.includes('test') || basename.includes('spec')) {
      testFiles.push(relPath);
      if (relDir.includes('test')) testDirs.add(relDir);

      if (basename.startsWith('test_')) testPatterns.add('test_*.py');
      else if (basename.endsWith('.test.ts')) testPatterns.add('*.test.ts');
      else if (basename.endsWith('.spec.ts')) testPatterns.add('*.spec.ts');
    }
  }

  // Sort for deterministic output
  return {
    testFiles: testFiles.sort(),
    testDirs: Array.from(testDirs).sort(),
    testPatterns: Array.from(testPatterns).sort(),
  };
}

// ── Internal ─────────────────────────────────────────────────

function getFilename(filePath: string): string {
  const p = toPosix(filePath);
  const lastSlash = p.lastIndexOf('/');
  return lastSlash >= 0 ? p.substring(lastSlash + 1) : p;
}

function getBasenameNoExt(filePath: string): string {
  const name = getFilename(filePath);
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.substring(0, lastDot) : name;
}
