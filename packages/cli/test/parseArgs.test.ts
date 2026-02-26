/**
 * Tests for argv parser.
 */

import * as assert from 'node:assert/strict';
import { parseArgs } from '../src/main';

describe('parseArgs', () => {
  const base = ['node', 'aspectcode'];

  it('parses bare invocation with all defaults', () => {
    const r = parseArgs([...base]);
    assert.equal(r.help, false);
    assert.equal(r.version, false);
    assert.equal(r.verbose, false);
    assert.equal(r.quiet, false);
    assert.equal(r.kb, false);
    assert.equal(r.dryRun, false);
    assert.equal(r.once, false);
    assert.equal(r.noColor, false);
    assert.equal(r.compact, false);
    assert.equal(r.root, undefined);
    assert.equal(r.provider, undefined);
    assert.equal(r.model, undefined);
  });

  it('parses --compact flag', () => {
    const r = parseArgs([...base, '--compact']);
    assert.equal(r.compact, true);
  });

  it('parses --help flag', () => {
    const r = parseArgs([...base, '--help']);
    assert.equal(r.help, true);
  });

  it('parses -h short alias for help', () => {
    const r = parseArgs([...base, '-h']);
    assert.equal(r.help, true);
  });

  it('parses -V flag for version', () => {
    const r = parseArgs([...base, '-V']);
    assert.equal(r.version, true);
  });

  it('parses --root with space-separated value', () => {
    const r = parseArgs([...base, '--root', '/my/dir']);
    assert.equal(r.root, '/my/dir');
  });

  it('parses --root= with equals sign', () => {
    const r = parseArgs([...base, '--root=/my/dir']);
    assert.equal(r.root, '/my/dir');
  });

  it('parses -r short alias for root', () => {
    const r = parseArgs([...base, '-r', '/my/dir']);
    assert.equal(r.root, '/my/dir');
  });

  it('parses --kb flag', () => {
    const r = parseArgs([...base, '--kb']);
    assert.equal(r.kb, true);
  });

  it('parses --dry-run flag', () => {
    const r = parseArgs([...base, '--dry-run']);
    assert.equal(r.dryRun, true);
  });

  it('parses --once flag', () => {
    const r = parseArgs([...base, '--once']);
    assert.equal(r.once, true);
  });

  it('parses --no-color flag', () => {
    const r = parseArgs([...base, '--no-color']);
    assert.equal(r.noColor, true);
  });

  it('parses --verbose and --quiet', () => {
    const r = parseArgs([...base, '-v', '-q']);
    assert.equal(r.verbose, true);
    assert.equal(r.quiet, true);
  });

  it('parses --provider with value', () => {
    const r = parseArgs([...base, '--provider', 'anthropic']);
    assert.equal(r.provider, 'anthropic');
  });

  it('parses -p short alias for provider', () => {
    const r = parseArgs([...base, '-p', 'openai']);
    assert.equal(r.provider, 'openai');
  });

  it('parses --model with value', () => {
    const r = parseArgs([...base, '--model', 'gpt-4o']);
    assert.equal(r.model, 'gpt-4o');
  });

  it('parses -m short alias for model', () => {
    const r = parseArgs([...base, '-m', 'claude-3-opus']);
    assert.equal(r.model, 'claude-3-opus');
  });

  it('parses --temperature', () => {
    const r = parseArgs([...base, '--temperature', '0.7']);
    assert.equal(r.temperature, '0.7');
  });

  it('parses combined flags', () => {
    const r = parseArgs([...base, '--once', '--kb', '--dry-run', '-v']);
    assert.equal(r.once, true);
    assert.equal(r.kb, true);
    assert.equal(r.dryRun, true);
    assert.equal(r.verbose, true);
  });
});
