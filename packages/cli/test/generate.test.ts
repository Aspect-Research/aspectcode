/**
 * Tests for `aspectcode generate` command.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runGenerate } from '../src/commands/generate';
import type { CliFlags } from '../src/cli';
import { createLogger } from '../src/logger';

function makeFlags(overrides: Partial<CliFlags> = {}): CliFlags {
  return {
    help: false,
    version: false,
    verbose: false,
    quiet: true,
    force: false,
    ...overrides,
  };
}

function writeSourceFiles(dir: string): void {
  // Create a small TypeScript project for analysis
  fs.writeFileSync(
    path.join(dir, 'index.ts'),
    `import { helper } from './utils';\nexport function main() { helper(); }\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'utils.ts'),
    `export function helper() { return 42; }\n`,
  );
}

describe('generate command', () => {
  let tmpDir: string;
  const log = createLogger({ quiet: true });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-gen-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates KB artifacts for a small project', async () => {
    writeSourceFiles(tmpDir);

    const result = await runGenerate(tmpDir, makeFlags(), undefined, log);
    assert.equal(result.exitCode, 0);
    assert.ok(result.report);
    assert.ok(result.report.wrote.length > 0);

    // .aspect directory should exist
    const aspectDir = path.join(tmpDir, '.aspect');
    assert.ok(fs.existsSync(aspectDir), '.aspect directory was created');

    // manifest.json should exist
    const manifest = path.join(aspectDir, 'manifest.json');
    assert.ok(fs.existsSync(manifest), 'manifest.json was created');
  });

  it('returns error for empty project', async () => {
    // No files in tmpDir
    const result = await runGenerate(tmpDir, makeFlags(), undefined, log);
    assert.equal(result.exitCode, 1);
  });

  it('respects --out flag for output directory', async () => {
    writeSourceFiles(tmpDir);
    const outDir = path.join(tmpDir, 'output');

    const result = await runGenerate(
      tmpDir,
      makeFlags({ out: outDir }),
      undefined,
      log,
    );
    assert.equal(result.exitCode, 0);

    // KB artifacts under output/.aspect
    const aspectDir = path.join(outDir, '.aspect');
    assert.ok(fs.existsSync(aspectDir), '.aspect under outDir');
  });

  it('respects config assistants', async () => {
    writeSourceFiles(tmpDir);

    const config = {
      assistants: { copilot: true, cursor: false, claude: false, other: false },
      instructionsMode: 'safe' as const,
    };

    const result = await runGenerate(tmpDir, makeFlags(), config, log);
    assert.equal(result.exitCode, 0);
    assert.ok(result.report);

    // Should have written copilot instructions
    const copilotWritten = result.report.wrote.some((w) =>
      w.path.includes('copilot-instructions'),
    );
    assert.ok(copilotWritten, 'copilot instructions written');
  });

  it('respects --assistants flag override', async () => {
    writeSourceFiles(tmpDir);

    const result = await runGenerate(
      tmpDir,
      makeFlags({ assistants: 'copilot,cursor' }),
      undefined,
      log,
    );
    assert.equal(result.exitCode, 0);
    assert.ok(result.report);

    const hasInstructions = result.report.wrote.some(
      (w) => w.path.includes('copilot') || w.path.includes('cursor'),
    );
    assert.ok(hasInstructions, 'assistant instructions written');
  });

  it('report contains stats', async () => {
    writeSourceFiles(tmpDir);

    const result = await runGenerate(tmpDir, makeFlags(), undefined, log);
    assert.ok(result.report);
    assert.equal(typeof result.report.stats.files, 'number');
    assert.ok(result.report.stats.files >= 2);
  });
});
