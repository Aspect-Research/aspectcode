/**
 * Tests for content summary utility.
 */

import * as assert from 'node:assert/strict';
import { summarizeContent } from '../src/summary';

describe('summarizeContent', () => {
  it('counts H2 sections', () => {
    const content = [
      '# Top heading',
      '## Architecture',
      'Some text.',
      '## Map',
      'More text.',
      '## Context',
    ].join('\n');
    const result = summarizeContent(content);
    assert.equal(result.sections, 3);
  });

  it('counts bold numbered rules', () => {
    const content = [
      '## Rules',
      '1. **Never truncate code.** Provide complete implementations.',
      '2. **Read before you write.** Open the relevant KB sections.',
      'Some other text.',
    ].join('\n');
    const result = summarizeContent(content);
    assert.equal(result.rules, 2);
  });

  it('counts bold bulleted rules', () => {
    const content = [
      '## Guidelines',
      '- **Follow naming patterns.** Match the project style.',
      '* **Minimal changes.** Smallest fix that works.',
      '- This is not a bold rule so it should not count.',
    ].join('\n');
    const result = summarizeContent(content);
    assert.equal(result.rules, 2);
  });

  it('extracts unique file paths from backticks', () => {
    const content = [
      'Check `src/api/router.ts` for routes.',
      'Also see `src/api/router.ts` again and `lib/utils/format.ts`.',
      'And a non-path like `someWord` should be skipped.',
    ].join('\n');
    const result = summarizeContent(content);
    assert.deepEqual(result.filePaths, ['src/api/router.ts', 'lib/utils/format.ts']);
  });

  it('ignores backtick references without directory separators', () => {
    const content = 'Use `format.ts` and `config.json` but not a path.';
    const result = summarizeContent(content);
    assert.deepEqual(result.filePaths, []);
  });

  it('returns zeros for empty content', () => {
    const result = summarizeContent('');
    assert.equal(result.sections, 0);
    assert.equal(result.rules, 0);
    assert.deepEqual(result.filePaths, []);
  });

  it('handles all features together', () => {
    const content = [
      '## Architecture',
      '1. **Hub files** are critical. See `src/core/index.ts`.',
      '- **Entry points** in `src/api/handler.ts`.',
      '',
      '## Map',
      '1. **Models** in `src/models/user.ts` and `src/models/user.ts` (dup).',
      '',
      '## Context',
      'No rules here, just text.',
    ].join('\n');
    const result = summarizeContent(content);
    assert.equal(result.sections, 3);
    assert.equal(result.rules, 3);
    assert.deepEqual(result.filePaths, [
      'src/core/index.ts',
      'src/api/handler.ts',
      'src/models/user.ts',
    ]);
  });
});
