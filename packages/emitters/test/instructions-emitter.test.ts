import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, it } from 'mocha';
import type { AnalysisModel } from '@aspectcode/core';
import { createNodeEmitterHost } from '../src/host';
import { createInstructionsEmitter } from '../src/instructions/instructionsEmitter';
import { ASPECT_CODE_END, ASPECT_CODE_START } from '../src/instructions/constants';

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

  it('creates file when missing', async () => {
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
    assert.ok(fs.existsSync(filePath));
    const text = fs.readFileSync(filePath, 'utf8');
    assert.ok(text.includes(ASPECT_CODE_START));
    assert.ok(text.includes(ASPECT_CODE_END));
    assert.ok(text.includes('## Aspect Code'));
  });

  it('updates between markers only', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-instr-'));
    const host = createNodeEmitterHost();

    const filePath = path.join(tmpDir, 'AGENTS.md');

    const before = '# Header\n\nPreamble\n';
    const old = `${ASPECT_CODE_START}\nOLD CONTENT\n${ASPECT_CODE_END}\n`;
    const after = '\nTrailing note\n';
    fs.writeFileSync(filePath, before + old + after, 'utf8');

    const emitter = createInstructionsEmitter();
    await emitter.emit(makeModel(tmpDir), host, {
      workspaceRoot: tmpDir,
      outDir: tmpDir,
      generatedAt: FIXED_TIMESTAMP,
      instructionsMode: 'safe',
    });

    const updated = fs.readFileSync(filePath, 'utf8');
    assert.ok(updated.startsWith(before), 'Preamble should be unchanged');
    assert.ok(updated.endsWith(after), 'Trailing content should be unchanged');
    assert.ok(!updated.includes('OLD CONTENT'), 'Old marker content should be replaced');
    assert.ok(updated.includes('## Aspect Code'), 'New canonical content should be inserted');
  });

  it('leaves external edits untouched', async () => {
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

    // External edit outside markers (before the start marker)
    const markerIndex = text.indexOf(ASPECT_CODE_START);
    assert.ok(markerIndex >= 0, 'Expected start marker to exist');
    text = `${text.substring(0, markerIndex)}EXTERNAL NOTE\n${text.substring(markerIndex)}`;
    fs.writeFileSync(filePath, text, 'utf8');

    await emitter.emit(makeModel(tmpDir), host, {
      workspaceRoot: tmpDir,
      outDir: tmpDir,
      generatedAt: FIXED_TIMESTAMP,
      instructionsMode: 'safe',
    });

    const updated = fs.readFileSync(filePath, 'utf8');
    assert.ok(updated.includes('EXTERNAL NOTE'), 'External edits should remain');
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
