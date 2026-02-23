/**
 * Tests for `aspectcode deps impact` command.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runDepsImpact } from '../src/commands/deps';
import type { CliFlags, CommandContext } from '../src/cli';
import { createLogger } from '../src/logger';

function makeFlags(overrides: Partial<CliFlags> = {}): CliFlags {
  return {
    help: false,
    version: false,
    verbose: false,
    quiet: true,
    listConnections: false,
    json: false,
    kbOnly: false,
    kb: false,
    noColor: false,
    ...overrides,
  };
}

function makeCtx(root: string, overrides: Partial<CliFlags> = {}): CommandContext {
  return {
    root,
    flags: makeFlags(overrides),
    config: undefined,
    log: createLogger({ quiet: true }),
    positionals: [],
  };
}

function writeSourceFiles(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'index.ts'),
    `import { helper } from './utils';\nexport function main() { helper(); }\n`,
  );
  fs.writeFileSync(path.join(dir, 'utils.ts'), `export function helper() { return 42; }\n`);
}

describe('impact command', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-impact-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns USAGE when --file is not provided', async () => {
    const result = await runDepsImpact(makeCtx(tmpDir));
    assert.equal(result.exitCode, 2);
  });

  it('returns ERROR when target file does not exist', async () => {
    const result = await runDepsImpact(makeCtx(tmpDir, { file: 'nonexistent.ts' }));
    assert.equal(result.exitCode, 1);
  });

  it('returns OK for a valid file', async () => {
    writeSourceFiles(tmpDir);
    const result = await runDepsImpact(makeCtx(tmpDir, { file: 'utils.ts' }));
    assert.equal(result.exitCode, 0);
  });

  it('outputs JSON when --json is set', async () => {
    writeSourceFiles(tmpDir);
    // Capture stdout
    const origWrite = process.stdout.write;
    let output = '';
    process.stdout.write = ((chunk: string) => {
      output += chunk;
      return true;
    }) as typeof process.stdout.write;

    try {
      const result = await runDepsImpact(makeCtx(tmpDir, { file: 'utils.ts', json: true }));
      assert.equal(result.exitCode, 0);
      const parsed = JSON.parse(output.trim());
      assert.ok(typeof parsed.file === 'string');
      assert.ok(typeof parsed.dependents_count === 'number');
      assert.ok(Array.isArray(parsed.top_dependents));
    } finally {
      process.stdout.write = origWrite;
    }
  });
});
