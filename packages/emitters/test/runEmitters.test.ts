import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, it } from 'mocha';
import type { AnalysisModel } from '@aspectcode/core';
import { createNodeEmitterHost } from '../src/host';
import { runEmitters } from '../src';

const FIXED_TIMESTAMP = '2026-02-11T00:00:00.000Z';

function makeModel(
  workspaceRoot: string,
  keyMode: 'absolute' | 'relative' = 'absolute',
): { model: AnalysisModel; fileContents: Map<string, string> } {
  const fileContents = new Map<string, string>();

  const absApp = path.join(workspaceRoot, 'src', 'app.ts');
  const absUtil = path.join(workspaceRoot, 'src', 'utils.ts');

  const relApp = 'src/app.ts';
  const relUtil = 'src/utils.ts';
  const appKey = keyMode === 'absolute' ? absApp : relApp;
  const utilKey = keyMode === 'absolute' ? absUtil : relUtil;

  fileContents.set(appKey, `import { format } from './utils';\nexport function main(){ return format('x'); }\n`);
  fileContents.set(utilKey, `export function format(x: string){ return x.toUpperCase(); }\n`);

  const model: AnalysisModel = {
    schemaVersion: '0.1',
    generatedAt: FIXED_TIMESTAMP,
    repo: { root: workspaceRoot },
    files: [
      { relativePath: 'src/app.ts', language: 'typescript', lineCount: 2, exports: ['main'], imports: ['./utils'] },
      { relativePath: 'src/utils.ts', language: 'typescript', lineCount: 1, exports: ['format'], imports: [] },
    ],
    symbols: [],
    graph: {
      nodes: [],
      edges: [
        {
          source: 'src/app.ts',
          target: 'src/utils.ts',
          type: 'import',
          strength: 1,
          symbols: ['format'],
          lines: [1],
          bidirectional: false,
        },
      ],
    },
    metrics: { hubs: [] },
  };

  return { model, fileContents };
}

describe('runEmitters', () => {
  let workspaceDir: string;
  let outDir: string;

  afterEach(() => {
    if (workspaceDir) fs.rmSync(workspaceDir, { recursive: true, force: true });
    if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('supports outDir distinct from workspaceRoot', async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-ws-'));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-out-'));

    const host = createNodeEmitterHost();
    const { model, fileContents } = makeModel(workspaceDir);

    const report = await runEmitters(model, host, {
      workspaceRoot: workspaceDir,
      outDir,
      generatedAt: FIXED_TIMESTAMP,
      fileContents,
      generateKb: true,
      instructionsMode: 'safe',
    });

    assert.equal(report.schemaVersion, '0.1');
    assert.ok(report.wrote.length > 0);

    // KB should be written as a single kb.md under outDir
    assert.ok(fs.existsSync(path.join(outDir, 'kb.md')));

    // Instructions should also land under outDir
    assert.ok(fs.existsSync(path.join(outDir, 'AGENTS.md')));

    // Ensure we did not implicitly write into workspaceRoot
    assert.ok(!fs.existsSync(path.join(workspaceDir, 'kb.md')));
  });

  it('does not partially overwrite outputs when a staged write fails', async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-ws-'));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-out-'));

    const baseHost = createNodeEmitterHost();

    // Existing output that must remain intact on failure
    const kbPath = path.join(outDir, 'kb.md');
    await baseHost.writeFile(kbPath, 'OLD KB\n');

    const { model, fileContents } = makeModel(workspaceDir);

    // Fail when writing KB temp file (KB uses transaction with temp files)
    const failingHost = {
      ...baseHost,
      writeFile: async (filePath: string, content: string) => {
        if (filePath.includes('kb.md') && filePath.includes('__aspect_tmp__')) {
          throw new Error('Simulated write failure');
        }
        return baseHost.writeFile(filePath, content);
      },
    };

    let threw = false;
    try {
      await runEmitters(model, failingHost, {
        workspaceRoot: workspaceDir,
        outDir,
        generatedAt: FIXED_TIMESTAMP,
        fileContents,
        generateKb: true,
        instructionsMode: 'safe',
      });
    } catch {
      threw = true;
    }

    assert.ok(threw, 'Expected runEmitters to throw');
    assert.equal(fs.readFileSync(kbPath, 'utf8'), 'OLD KB\n', 'Existing output must not be overwritten');
  });

  it('supports relative fileContents keys (CLI-compatible)', async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-ws-'));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-out-'));

    const host = createNodeEmitterHost();
    const { model, fileContents } = makeModel(workspaceDir, 'relative');

    await runEmitters(model, host, {
      workspaceRoot: workspaceDir,
      outDir,
      generatedAt: FIXED_TIMESTAMP,
      fileContents,
      generateKb: true,
      instructionsMode: 'safe',
    });

    const kbPath = path.join(outDir, 'kb.md');
    const kbContent = fs.readFileSync(kbPath, 'utf8');

    assert.ok(kbContent.includes('`main`'), 'Expected symbol index to include main function');
    assert.ok(kbContent.includes('`format`'), 'Expected symbol index to include format function');
  });
});
