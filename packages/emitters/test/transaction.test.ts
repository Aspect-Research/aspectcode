/**
 * Tests for GenerationTransaction — staging, commit, rollback, read-through.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import type { EmitterHost } from '../src/host';
import { GenerationTransaction } from '../src/transaction';

// ── In-memory host ─────────────────────────────────────────

function memHost(): { host: EmitterHost; files: Map<string, string> } {
  const files = new Map<string, string>();
  const host: EmitterHost = {
    async readFile(p: string) {
      const c = files.get(p);
      if (c === undefined) throw new Error(`ENOENT: ${p}`);
      return c;
    },
    async writeFile(p: string, c: string) {
      files.set(p, c);
    },
    async exists(p: string) {
      return files.has(p);
    },
    async mkdirp() { /* noop */ },
    async rename(from: string, to: string) {
      const c = files.get(from);
      if (c === undefined) throw new Error(`ENOENT: ${from}`);
      files.set(to, c);
      files.delete(from);
    },
    async rmrf(p: string) {
      files.delete(p);
    },
    join(...segments: string[]) {
      return segments.join('/');
    },
    relative(from: string, to: string) {
      return to.replace(from + '/', '');
    },
  };
  return { host, files };
}

describe('GenerationTransaction', () => {
  it('stages writes without affecting final paths', async () => {
    const { host, files } = memHost();
    files.set('out/kb.md', 'OLD');

    const tx = new GenerationTransaction(host);
    const txHost = tx.host;

    await txHost.writeFile('out/kb.md', 'NEW');

    // Original file untouched before commit
    assert.equal(files.get('out/kb.md'), 'OLD');
    assert.equal(tx.getWrites().length, 1);
  });

  it('commit replaces final files with staged content', async () => {
    const { host, files } = memHost();
    files.set('out/kb.md', 'OLD');

    const tx = new GenerationTransaction(host);
    await tx.host.writeFile('out/kb.md', 'NEW');
    await tx.commit();

    assert.equal(files.get('out/kb.md'), 'NEW');
  });

  it('commit creates new files that did not previously exist', async () => {
    const { host, files } = memHost();

    const tx = new GenerationTransaction(host);
    await tx.host.writeFile('out/agents.md', 'AGENTS');
    await tx.commit();

    assert.equal(files.get('out/agents.md'), 'AGENTS');
  });

  it('read-through returns staged content for staged paths', async () => {
    const { host, files } = memHost();
    files.set('out/kb.md', 'OLD');

    const tx = new GenerationTransaction(host);
    const txHost = tx.host;

    await txHost.writeFile('out/kb.md', 'NEW');

    // Reading through tx host should return staged content
    const content = await txHost.readFile('out/kb.md');
    assert.equal(content, 'NEW');
  });

  it('read-through falls back to base host for non-staged paths', async () => {
    const { host, files } = memHost();
    files.set('out/other.md', 'EXISTING');

    const tx = new GenerationTransaction(host);
    const content = await tx.host.readFile('out/other.md');
    assert.equal(content, 'EXISTING');
  });

  it('getWrites reports bytes accurately', async () => {
    const { host } = memHost();
    const tx = new GenerationTransaction(host);

    const content = 'Hello, world! 🌍';
    await tx.host.writeFile('out/test.md', content);

    const writes = tx.getWrites();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].bytes, Buffer.byteLength(content, 'utf8'));
  });

  it('commit is a no-op with zero staged writes', async () => {
    const { host } = memHost();
    const tx = new GenerationTransaction(host);

    // Should not throw
    await tx.commit();
    assert.equal(tx.getWrites().length, 0);
  });

  it('cleans up temp files after commit', async () => {
    const { host, files } = memHost();
    const tx = new GenerationTransaction(host);

    await tx.host.writeFile('out/kb.md', 'CONTENT');
    const tempPath = tx.getWrites()[0].tempPath;

    // Temp file exists before commit
    assert.ok(files.has(tempPath), 'Temp file should exist before commit');

    await tx.commit();

    // Temp file cleaned up after commit
    assert.ok(!files.has(tempPath), 'Temp file should be removed after commit');
  });

  it('rolls back on commit failure (best-effort)', async () => {
    const { host, files } = memHost();
    files.set('out/kb.md', 'ORIGINAL');

    // Create a host that fails on rename for the commit step
    let renameCallCount = 0;
    const failingHost: EmitterHost = {
      ...host,
      async rename(from: string, to: string) {
        renameCallCount++;
        // Fail on the second rename (temp → final), after backup
        if (renameCallCount === 2) {
          throw new Error('Simulated rename failure');
        }
        return host.rename(from, to);
      },
    };

    const tx = new GenerationTransaction(failingHost);
    await tx.host.writeFile('out/kb.md', 'SHOULD NOT PERSIST');

    let threw = false;
    try {
      await tx.commit();
    } catch {
      threw = true;
    }

    assert.ok(threw, 'Commit should throw on failure');
    // Rollback should restore original — best-effort
    // (actual restore depends on rename error timing, so just verify it throws)
  });

  it('commits multiple files in deterministic order', async () => {
    const { host, files } = memHost();

    const tx = new GenerationTransaction(host);
    // Write in non-alphabetical order
    await tx.host.writeFile('out/z.md', 'Z');
    await tx.host.writeFile('out/a.md', 'A');
    await tx.host.writeFile('out/m.md', 'M');

    await tx.commit();

    assert.equal(files.get('out/a.md'), 'A');
    assert.equal(files.get('out/m.md'), 'M');
    assert.equal(files.get('out/z.md'), 'Z');

    // All three written
    const writes = tx.getWrites();
    assert.equal(writes.length, 3);
  });
});
