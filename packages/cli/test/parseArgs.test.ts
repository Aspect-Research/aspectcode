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

  it('ignores removed --assistants flag', () => {
    const r = parseArgs([...base, 'generate', '--assistants', 'copilot,cursor']);
    assert.equal(r.command, 'generate');
    assert.deepEqual(r.positionals, ['copilot,cursor']);
  });

  it('parses --list-connections', () => {
    const r = parseArgs([...base, 'generate', '--list-connections']);
    assert.equal(r.flags.listConnections, true);
  });

  it('parses --json', () => {
    const r = parseArgs([...base, 'generate', '--json']);
    assert.equal(r.flags.json, true);
  });

  it('parses --file with separate value', () => {
    const r = parseArgs([...base, 'deps', 'list', '--file', 'src/app.ts']);
    assert.equal(r.flags.file, 'src/app.ts');
  });

  it('parses --file= with equals syntax', () => {
    const r = parseArgs([...base, 'deps', 'list', '--file=src/app.ts']);
    assert.equal(r.flags.file, 'src/app.ts');
  });

  it('parses watch command', () => {
    const r = parseArgs([...base, 'watch']);
    assert.equal(r.command, 'watch');
  });

  it('parses --mode with separate value', () => {
    const r = parseArgs([...base, 'watch', '--mode', 'idle']);
    assert.equal(r.flags.mode, 'idle');
  });

  it('parses --mode= with equals syntax', () => {
    const r = parseArgs([...base, 'watch', '--mode=manual']);
    assert.equal(r.flags.mode, 'manual');
  });

  it('ignores invalid mode values', () => {
    const r = parseArgs([...base, 'watch', '--mode=invalid']);
    assert.equal(r.flags.mode, undefined);
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

  it('parses deps list subcommand as positional', () => {
    const r = parseArgs([...base, 'deps', 'list']);
    assert.equal(r.command, 'deps');
    assert.deepEqual(r.positionals, ['list']);
  });

  it('returns empty command when none given', () => {
    const r = parseArgs([...base]);
    assert.equal(r.command, '');
  });
});
