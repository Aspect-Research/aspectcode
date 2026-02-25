/**
 * Regression test — verify every `@aspectcode/*` require in CLI dist/ is
 * declared in dependencies, bundledDependencies, AND the prepack BUNDLED array.
 *
 * This catches the class of bug where someone compiles CLI code that imports a
 * new workspace package but forgets to add it to the bundling pipeline,
 * causing MODULE_NOT_FOUND at runtime after `npm pack`.
 */

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const cliDir = path.resolve(__dirname, '..');
const distDir = path.join(cliDir, 'dist');

/** Recursively collect all .js files under a directory. */
function collectJsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(full));
    } else if (entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

describe('bundledDependencies', () => {
  let pkgJson: {
    dependencies?: Record<string, string>;
    bundledDependencies?: string[];
  };

  let prepackSource: string;

  before(() => {
    pkgJson = JSON.parse(
      fs.readFileSync(path.join(cliDir, 'package.json'), 'utf-8'),
    );
    prepackSource = fs.readFileSync(
      path.join(cliDir, 'scripts', 'prepack.mjs'),
      'utf-8',
    );
  });

  it('every @aspectcode/* require in dist/ is in dependencies', () => {
    const jsFiles = collectJsFiles(distDir);
    assert.ok(jsFiles.length > 0, 'dist/ should contain .js files (run build first)');

    const requirePattern = /require\(["'](@aspectcode\/[^"']+)["']\)/g;
    const missing: string[] = [];

    for (const file of jsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      let m;
      while ((m = requirePattern.exec(content)) !== null) {
        const dep = m[1];
        if (!pkgJson.dependencies?.[dep]) {
          missing.push(`${path.relative(cliDir, file)}: ${dep}`);
        }
      }
    }

    assert.deepStrictEqual(
      missing,
      [],
      `These @aspectcode/* packages are required in dist/ but missing from dependencies:\n${missing.join('\n')}`,
    );
  });

  it('every @aspectcode/* require in dist/ is in bundledDependencies', () => {
    const jsFiles = collectJsFiles(distDir);
    const requirePattern = /require\(["'](@aspectcode\/[^"']+)["']\)/g;
    const missing: string[] = [];

    for (const file of jsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      let m;
      while ((m = requirePattern.exec(content)) !== null) {
        const dep = m[1];
        if (!pkgJson.bundledDependencies?.includes(dep)) {
          missing.push(`${path.relative(cliDir, file)}: ${dep}`);
        }
      }
    }

    assert.deepStrictEqual(
      missing,
      [],
      `These @aspectcode/* packages are required in dist/ but missing from bundledDependencies:\n${missing.join('\n')}`,
    );
  });

  it('every @aspectcode/* require in dist/ is in prepack BUNDLED array', () => {
    const jsFiles = collectJsFiles(distDir);
    const requirePattern = /require\(["']@aspectcode\/([^"']+)["']\)/g;
    const missing: string[] = [];

    // Extract BUNDLED array from prepack.mjs
    const bundledMatch = prepackSource.match(/BUNDLED\s*=\s*\[([^\]]+)\]/);
    assert.ok(bundledMatch, 'Could not find BUNDLED array in prepack.mjs');
    const bundledNames = bundledMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);

    for (const file of jsFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      let m;
      while ((m = requirePattern.exec(content)) !== null) {
        const shortName = m[1]; // e.g. "evaluator" from "@aspectcode/evaluator"
        if (!bundledNames.includes(shortName)) {
          missing.push(`${path.relative(cliDir, file)}: @aspectcode/${shortName}`);
        }
      }
    }

    assert.deepStrictEqual(
      missing,
      [],
      `These @aspectcode/* packages are required in dist/ but missing from prepack BUNDLED:\n${missing.join('\n')}`,
    );
  });

  it('bundledDependencies and dependencies are in sync', () => {
    const bundled = pkgJson.bundledDependencies ?? [];
    const deps = Object.keys(pkgJson.dependencies ?? {});
    const aspectDeps = deps.filter((d) => d.startsWith('@aspectcode/'));

    const notBundled = aspectDeps.filter((d) => !bundled.includes(d));
    const notInDeps = bundled
      .filter((d) => d.startsWith('@aspectcode/'))
      .filter((d) => !aspectDeps.includes(d));

    assert.deepStrictEqual(
      notBundled,
      [],
      `@aspectcode/* packages in dependencies but not in bundledDependencies: ${notBundled.join(', ')}`,
    );
    assert.deepStrictEqual(
      notInDeps,
      [],
      `@aspectcode/* packages in bundledDependencies but not in dependencies: ${notInDeps.join(', ')}`,
    );
  });
});
