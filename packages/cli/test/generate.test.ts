/**
 * Tests for `aspectcode generate` command.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runGenerate } from '../src/commands/generate';
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

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-gen-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates KB artifacts for a small project', async () => {
    writeSourceFiles(tmpDir);

    const result = await runGenerate(makeCtx(tmpDir, { kb: true }));
    assert.equal(result.exitCode, 0);
    assert.ok(result.report);
    assert.ok(result.report.wrote.length > 0);

    // kb.md should exist at workspace root
    const kbPath = path.join(tmpDir, 'kb.md');
    assert.ok(fs.existsSync(kbPath), 'kb.md was created');
  });

  it('returns error for empty project', async () => {
    // No files in tmpDir
    const result = await runGenerate(makeCtx(tmpDir));
    assert.equal(result.exitCode, 1);
  });

  it('respects --out flag for output directory', async () => {
    writeSourceFiles(tmpDir);
    const outDir = path.join(tmpDir, 'output');

    const result = await runGenerate(makeCtx(tmpDir, { out: outDir, kb: true }));
    assert.equal(result.exitCode, 0);

    // KB artifacts under output/kb.md
    const kbPath = path.join(outDir, 'kb.md');
    assert.ok(fs.existsSync(kbPath), 'kb.md under outDir');
  });

  it('writes AGENTS.md instructions by default', async () => {
    writeSourceFiles(tmpDir);

    const result = await runGenerate(makeCtx(tmpDir));
    assert.equal(result.exitCode, 0);
    assert.ok(result.report);

    const agentsWritten = result.report.wrote.some((w) => w.path.endsWith('AGENTS.md'));
    assert.ok(agentsWritten, 'AGENTS.md instructions written');
  });

  it('report contains stats', async () => {
    writeSourceFiles(tmpDir);

    const result = await runGenerate(makeCtx(tmpDir));
    assert.ok(result.report);
    assert.equal(typeof result.report.stats.files, 'number');
    assert.ok(result.report.stats.files >= 2);
    assert.equal(typeof result.report.stats.edges, 'number');
    assert.ok(Number.isFinite(result.report.stats.edges));
    assert.ok(result.report.stats.edges >= 0);
    assert.ok(Array.isArray(result.report.stats.hubsTop));
  });

  it('supports --list-connections', async () => {
    writeSourceFiles(tmpDir);
    const result = await runGenerate(makeCtx(tmpDir, { listConnections: true }));
    assert.equal(result.exitCode, 0);
    assert.ok(result.report);
  });

  it('supports --json output payload', async () => {
    writeSourceFiles(tmpDir);

    const originalLog = console.log;
    const captured: string[] = [];
    console.log = (...args: unknown[]) => {
      captured.push(args.map(String).join(' '));
    };

    try {
      const result = await runGenerate(makeCtx(tmpDir, { json: true }));
      assert.equal(result.exitCode, 0);
      assert.ok(result.report);
    } finally {
      console.log = originalLog;
    }

    assert.ok(captured.length > 0, 'json output was printed');
    const payload = JSON.parse(captured.join('\n')) as {
      schemaVersion: string;
      wrote: Array<{ path: string; bytes: number }>;
      skipped: unknown[];
      stats: { files: number };
      connections: unknown[];
    };

    assert.equal(typeof payload.schemaVersion, 'string');
    assert.ok(Array.isArray(payload.wrote));
    assert.ok(Array.isArray(payload.connections));
    assert.ok(payload.stats.files >= 2);
  });

  it('supports --json with --file filter for connections', async () => {
    writeSourceFiles(tmpDir);

    const originalLog = console.log;
    const captured: string[] = [];
    console.log = (...args: unknown[]) => {
      captured.push(args.map(String).join(' '));
    };

    try {
      const result = await runGenerate(makeCtx(tmpDir, { json: true, file: 'index.ts' }));
      assert.equal(result.exitCode, 0);
    } finally {
      console.log = originalLog;
    }

    const payload = JSON.parse(captured.join('\n')) as {
      connections: Array<{ source: string; target: string }>;
    };

    assert.ok(payload.connections.length > 0);
    assert.ok(
      payload.connections.every(
        (row) => row.source === 'index.ts' || row.target === 'index.ts',
      ),
      'expected all connections to be filtered to index.ts',
    );
  });

  it('returns usage for --file outside workspace when listing connections', async () => {
    writeSourceFiles(tmpDir);
    const result = await runGenerate(makeCtx(tmpDir, { listConnections: true, file: '../outside.ts' }));
    assert.equal(result.exitCode, 2);
  });
});
