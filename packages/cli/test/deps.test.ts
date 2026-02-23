/**
 * Tests for `aspectcode deps list` and dependency collection.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectConnections } from '../src/connections';
import { runDepsList } from '../src/commands/deps';
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
  const flags = makeFlags(overrides);
  return {
    root,
    flags,
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

describe('deps command', () => {
  let tmpDir: string;
  const log = createLogger({ quiet: true });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-deps-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('collectConnections returns dependency rows for a small project', async () => {
    writeSourceFiles(tmpDir);

    const rows = await collectConnections(tmpDir, undefined, log);
    assert.ok(rows.length > 0);

    const hasIndexToUtils = rows.some((row: { source: string; target: string }) => {
      const forward = row.source.endsWith('index.ts') && row.target.endsWith('utils.ts');
      const reverse = row.source.endsWith('utils.ts') && row.target.endsWith('index.ts');
      return forward || reverse;
    });

    assert.ok(hasIndexToUtils, 'expected connection between index.ts and utils.ts');
  });

  it('runDepsList returns OK on empty workspace', async () => {
    const result = await runDepsList(makeCtx(tmpDir));
    assert.equal(result.exitCode, 0);
  });

  it('runDepsList returns OK when dependencies exist', async () => {
    writeSourceFiles(tmpDir);
    const result = await runDepsList(makeCtx(tmpDir));
    assert.equal(result.exitCode, 0);
  });

  it('runDepsList supports --file filter for matching file', async () => {
    writeSourceFiles(tmpDir);
    const result = await runDepsList(makeCtx(tmpDir, { file: 'index.ts' }));
    assert.equal(result.exitCode, 0);
  });

  it('runDepsList returns usage for --file outside workspace', async () => {
    writeSourceFiles(tmpDir);
    const result = await runDepsList(makeCtx(tmpDir, { file: '../outside.ts' }));
    assert.equal(result.exitCode, 2);
  });
});
