import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import type { CliFlags } from '../src/cli';
import type { AspectCodeConfig } from '../src/config';
import { resolveWatchMode } from '../src/commands/watch';

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

describe('watch command', () => {
  it('defaults to onChange when no config and no flag override', () => {
    const mode = resolveWatchMode(makeFlags(), undefined);
    assert.equal(mode, 'onChange');
  });

  it('uses config updateRate when mode flag is absent', () => {
    const config: AspectCodeConfig = { updateRate: 'idle' };
    const mode = resolveWatchMode(makeFlags(), config);
    assert.equal(mode, 'idle');
  });

  it('mode flag overrides config updateRate', () => {
    const config: AspectCodeConfig = { updateRate: 'onChange' };
    const mode = resolveWatchMode(makeFlags({ mode: 'manual' }), config);
    assert.equal(mode, 'manual');
  });

  it('does not run on startup, regenerates for source changes, and ignores excluded paths', async function () {
    this.timeout(30000);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-watch-'));
    const sourceFile = path.join(tmpDir, 'index.ts');
    const kbPath = path.join(tmpDir, 'kb.md');
    fs.writeFileSync(sourceFile, `export const value = 1;\n`, 'utf-8');

    const pkgRoot = path.resolve(__dirname, '..');
    const proc = spawn(
      process.execPath,
      [
        '-r',
        'ts-node/register',
        '-e',
        "process.argv.splice(1,0,'aspectcode');require('./src/main').run()",
        'watch',
        '--root',
        tmpDir,
        '--mode',
        'onChange',
        '--kb',
      ],
      {
        cwd: pkgRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    try {
      await waitForOutput(proc, /No initial run\. Waiting for file changes/i, 10000);
      await waitForOutput(proc, /Watcher ready\./i, 10000);

      await sleep(1200);
      assert.equal(fs.existsSync(kbPath), false, 'watch should not generate on startup');

      const newFile = path.join(tmpDir, 'new-change.ts');
      fs.writeFileSync(newFile, `export const changed = 2;\n`, 'utf-8');

      await waitForOutput(proc, /watch\s+trigger:/i, 15000);
      await waitForCondition(() => fs.existsSync(kbPath), 15000, 100);
      assert.equal(fs.existsSync(kbPath), true, 'watch should regenerate after file change');

      await sleep(2500);
      const manifestMtimeAfterSource = fs.statSync(kbPath).mtimeMs;

      const ignoredNodeModulesDir = path.join(tmpDir, 'node_modules', 'pkg');
      fs.mkdirSync(ignoredNodeModulesDir, { recursive: true });
      fs.writeFileSync(
        path.join(ignoredNodeModulesDir, 'ignored.ts'),
        `export const ignored = true;\n`,
        'utf-8',
      );

      await sleep(3000);
      const manifestMtimeAfterIgnored = fs.statSync(kbPath).mtimeMs;
      assert.equal(
        manifestMtimeAfterIgnored,
        manifestMtimeAfterSource,
        'watch should ignore changes under node_modules/',
      );
    } finally {
      await stopProcess(proc);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(
  condition: () => boolean,
  timeoutMs: number,
  intervalMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

async function waitForOutput(
  proc: ChildProcess,
  pattern: RegExp,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      if (pattern.test(buffer)) {
        cleanup();
        resolve();
      }
    };

    const onErrData = (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
    };

    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`watch process exited early with code ${String(code)}\n${buffer}`));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for output: ${pattern.toString()}\n${buffer}`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout?.off('data', onData);
      proc.stderr?.off('data', onErrData);
      proc.off('exit', onExit);
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onErrData);
    proc.on('exit', onExit);
  });
}

async function stopProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.killed) return;

  proc.kill('SIGINT');

  const exited = await waitForExit(proc, 3000);
  if (exited) return;

  proc.kill('SIGTERM');
  await waitForExit(proc, 3000);
}

async function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (proc.exitCode !== null) return true;

  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    const onExit = () => {
      cleanup();
      resolve(true);
    };

    const cleanup = () => {
      clearTimeout(timer);
      proc.off('exit', onExit);
    };

    proc.on('exit', onExit);
  });
}
