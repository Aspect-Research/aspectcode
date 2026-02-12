/**
 * Tests for argv parser.
 */

import * as assert from 'node:assert/strict';
import { parseArgs } from '../src/main';

describe('parseArgs', () => {
  const base = ['node', 'aspectcode'];

  it('parses bare command', () => {
    const r = parseArgs([...base, 'generate']);
    assert.equal(r.command, 'generate');
    assert.equal(r.flags.help, false);
    assert.equal(r.flags.verbose, false);
  });

  it('parses --help flag', () => {
    const r = parseArgs([...base, '--help']);
    assert.equal(r.flags.help, true);
    assert.equal(r.command, '');
  });

  it('parses -V flag', () => {
    const r = parseArgs([...base, '-V']);
    assert.equal(r.flags.version, true);
  });

  it('parses --root with space-separated value', () => {
    const r = parseArgs([...base, 'generate', '--root', '/my/dir']);
    assert.equal(r.command, 'generate');
    assert.equal(r.flags.root, '/my/dir');
  });

  it('parses --root= with equals sign', () => {
    const r = parseArgs([...base, 'generate', '--root=/my/dir']);
    assert.equal(r.flags.root, '/my/dir');
  });

  it('parses -r short alias', () => {
    const r = parseArgs([...base, 'generate', '-r', '/my/dir']);
    assert.equal(r.flags.root, '/my/dir');
  });

  it('parses --out / -o', () => {
    const r = parseArgs([...base, 'generate', '-o', 'build/kb']);
    assert.equal(r.flags.out, 'build/kb');
  });

  it('parses --assistants', () => {
    const r = parseArgs([...base, 'generate', '--assistants', 'copilot,cursor']);
    assert.equal(r.flags.assistants, 'copilot,cursor');
  });

  it('parses --assistants= with equals', () => {
    const r = parseArgs([...base, 'generate', '--assistants=claude,other']);
    assert.equal(r.flags.assistants, 'claude,other');
  });

  it('parses --force / -f', () => {
    const r = parseArgs([...base, 'init', '--force']);
    assert.equal(r.command, 'init');
    assert.equal(r.flags.force, true);
  });

  it('parses --verbose and --quiet', () => {
    const r = parseArgs([...base, 'generate', '-v', '-q']);
    assert.equal(r.flags.verbose, true);
    assert.equal(r.flags.quiet, true);
  });

  it('ignores unknown flags', () => {
    const r = parseArgs([...base, 'generate', '--future-flag']);
    assert.equal(r.command, 'generate');
  });

  it('collects positionals after command', () => {
    const r = parseArgs([...base, 'generate', 'extra1', 'extra2']);
    assert.deepEqual(r.positionals, ['extra1', 'extra2']);
  });

  it('returns empty command when none given', () => {
    const r = parseArgs([...base]);
    assert.equal(r.command, '');
  });
});
