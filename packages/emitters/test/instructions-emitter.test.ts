import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, it } from 'mocha';
import type { AnalysisModel } from '@aspectcode/core';
import { createNodeEmitterHost } from '../src/host';
import { createInstructionsEmitter } from '../src/instructions/instructionsEmitter';

const FIXED_TIMESTAMP = '2026-02-11T00:00:00.000Z';

function makeModel(root: string): AnalysisModel {
  return {
    schemaVersion: '0.1',
    generatedAt: FIXED_TIMESTAMP,
    repo: { root },
    files: [],
    symbols: [],
    graph: { nodes: [], edges: [] },
    metrics: { hubs: [] },
  };
}

describe('InstructionsEmitter', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('creates AGENTS.md when missing', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-instr-'));
    const host = createNodeEmitterHost();
    const emitter = createInstructionsEmitter();

    await emitter.emit(makeModel(tmpDir), host, {
      workspaceRoot: tmpDir,
      outDir: tmpDir,
      generatedAt: FIXED_TIMESTAMP,
      instructionsMode: 'safe',
    });

    const filePath = path.join(tmpDir, 'AGENTS.md');
    assert.ok(fs.existsSync(filePath), 'AGENTS.md should be created');
    const text = fs.readFileSync(filePath, 'utf8');
    assert.ok(text.includes('## Aspect Code'), 'Should contain Aspect Code heading');
    assert.ok(text.length > 0, 'Content should not be empty');
  });

  it('overwrites entire file on re-emit (full-file ownership)', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-instr-'));
    const host = createNodeEmitterHost();

    const filePath = path.join(tmpDir, 'AGENTS.md');

    // Pre-populate with arbitrary content
    fs.writeFileSync(filePath, '# Header\n\nPreamble\nOLD CONTENT\nTrailing note\n', 'utf8');

    const emitter = createInstructionsEmitter();
    await emitter.emit(makeModel(tmpDir), host, {
      workspaceRoot: tmpDir,
      outDir: tmpDir,
      generatedAt: FIXED_TIMESTAMP,
      instructionsMode: 'safe',
    });

    const updated = fs.readFileSync(filePath, 'utf8');
    assert.ok(!updated.includes('OLD CONTENT'), 'Previous content should be replaced');
    assert.ok(!updated.includes('Preamble'), 'Previous preamble should be replaced');
    assert.ok(!updated.includes('Trailing note'), 'Previous trailing content should be replaced');
    assert.ok(updated.includes('## Aspect Code'), 'New canonical content should be present');
  });

  it('replaces external edits on re-emit', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-instr-'));
    const host = createNodeEmitterHost();
    const emitter = createInstructionsEmitter();

    await emitter.emit(makeModel(tmpDir), host, {
      workspaceRoot: tmpDir,
      outDir: tmpDir,
      generatedAt: FIXED_TIMESTAMP,
      instructionsMode: 'safe',
    });

    const filePath = path.join(tmpDir, 'AGENTS.md');
    let text = fs.readFileSync(filePath, 'utf8');

    // Simulate an external edit
    text = 'EXTERNAL NOTE\n' + text;
    fs.writeFileSync(filePath, text, 'utf8');

    // Re-emit — full-file ownership replaces everything
    await emitter.emit(makeModel(tmpDir), host, {
      workspaceRoot: tmpDir,
      outDir: tmpDir,
      generatedAt: FIXED_TIMESTAMP,
      instructionsMode: 'safe',
    });

    const updated = fs.readFileSync(filePath, 'utf8');
    assert.ok(!updated.includes('EXTERNAL NOTE'), 'External edits should be overwritten');
    assert.ok(updated.includes('## Aspect Code'), 'Canonical content should be present');
  });

  it('skips emit when mode is off', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-instr-'));
    const host = createNodeEmitterHost();
    const emitter = createInstructionsEmitter();

    const result = await emitter.emit(makeModel(tmpDir), host, {
      workspaceRoot: tmpDir,
      outDir: tmpDir,
      generatedAt: FIXED_TIMESTAMP,
      instructionsMode: 'off',
    });

    const filePath = path.join(tmpDir, 'AGENTS.md');
    assert.ok(!fs.existsSync(filePath), 'AGENTS.md should not be created when mode is off');
    assert.equal(result.filesWritten.length, 0, 'No files should be written');
  });

  it('is deterministic formatting', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-instr-'));
    const host = createNodeEmitterHost();
    const emitter = createInstructionsEmitter();

    const opts = {
      workspaceRoot: tmpDir,
      outDir: tmpDir,
      generatedAt: FIXED_TIMESTAMP,
      instructionsMode: 'safe' as const,
    };

    await emitter.emit(makeModel(tmpDir), host, opts);
    const filePath = path.join(tmpDir, 'AGENTS.md');
    const a = fs.readFileSync(filePath, 'utf8');

    await emitter.emit(makeModel(tmpDir), host, opts);
    const b = fs.readFileSync(filePath, 'utf8');

    assert.equal(a, b);
  });
});
