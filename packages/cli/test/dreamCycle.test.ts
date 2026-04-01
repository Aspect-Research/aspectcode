/**
 * Tests for dream cycle — correction tracking, learned rules, and LLM integration.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  addCorrection,
  getCorrections,
  getUnprocessedCount,
  shouldDream,
  markProcessed,
  resetCorrections,
  loadDreamState,
  saveDreamState,
  deriveLearnedRule,
  appendLearnedRule,
  getLearnedRules,
  stripLearnedBlock,
  runDreamCycle,
  parseDreamResponse,
  LEARNED_START,
  LEARNED_END,
} from '../src/dreamCycle';
import { makeAssessment } from './helpers';

// ── Correction tracker ───────────────────────────────────────

describe('correction tracker', () => {
  beforeEach(() => resetCorrections());

  it('starts empty', () => {
    assert.equal(getUnprocessedCount(), 0);
    assert.equal(shouldDream(), false);
  });

  it('addCorrection increments count', () => {
    addCorrection('confirm', makeAssessment());
    assert.equal(getUnprocessedCount(), 1);
    addCorrection('dismiss', makeAssessment());
    assert.equal(getUnprocessedCount(), 2);
  });

  it('getCorrections returns copies', () => {
    addCorrection('confirm', makeAssessment());
    const corrs = getCorrections();
    assert.equal(corrs.length, 1);
    assert.equal(corrs[0].action, 'confirm');
    // Mutating the copy doesn't affect internal state
    corrs.length = 0;
    assert.equal(getUnprocessedCount(), 1);
  });

  it('shouldDream returns true at threshold (10)', () => {
    for (let i = 0; i < 9; i++) addCorrection('confirm', makeAssessment());
    assert.equal(shouldDream(), false);
    addCorrection('dismiss', makeAssessment());
    assert.equal(shouldDream(), true);
  });

  it('markProcessed clears all corrections', () => {
    for (let i = 0; i < 5; i++) addCorrection('confirm', makeAssessment());
    assert.equal(getUnprocessedCount(), 5);
    markProcessed();
    assert.equal(getUnprocessedCount(), 0);
    assert.equal(shouldDream(), false);
  });

  it('stores timestamp on each correction', () => {
    const before = Date.now();
    addCorrection('confirm', makeAssessment());
    const after = Date.now();
    const corrs = getCorrections();
    assert.ok(corrs[0].timestamp >= before);
    assert.ok(corrs[0].timestamp <= after);
  });

  it('preserves assessment on correction', () => {
    const a = makeAssessment({ file: 'src/special.ts', rule: 'export-contract' });
    addCorrection('dismiss', a);
    const corrs = getCorrections();
    assert.equal(corrs[0].assessment.file, 'src/special.ts');
    assert.equal(corrs[0].assessment.rule, 'export-contract');
  });
});

// ── Dream state persistence ─────────────────────────────────

describe('dream state persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-dream-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadDreamState returns defaults when no file exists', () => {
    const state = loadDreamState(tmpDir);
    assert.equal(state.lastDreamAt, '');
  });

  it('saveDreamState creates file and loadDreamState reads it', () => {
    const now = new Date().toISOString();
    saveDreamState(tmpDir, { lastDreamAt: now });
    const loaded = loadDreamState(tmpDir);
    assert.equal(loaded.lastDreamAt, now);
  });

  it('saveDreamState creates .aspectcode directory if missing', () => {
    saveDreamState(tmpDir, { lastDreamAt: '2026-01-01T00:00:00Z' });
    assert.ok(fs.existsSync(path.join(tmpDir, '.aspectcode', 'dream-state.json')));
  });

  it('loadDreamState returns defaults for malformed JSON', () => {
    const dir = path.join(tmpDir, '.aspectcode');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'dream-state.json'), '{broken!!!');
    const state = loadDreamState(tmpDir);
    assert.equal(state.lastDreamAt, '');
  });
});

// ── Learned rule derivation ──────────────────────────────────

describe('deriveLearnedRule', () => {
  it('co-change: extracts dependents from context', () => {
    const rule = deriveLearnedRule(makeAssessment({
      rule: 'co-change',
      file: 'src/types.ts',
      dependencyContext: '2 strong dependents, 0 updated, 2 missing: [src/app.ts, src/bar.ts]',
    }));
    assert.ok(rule.includes('src/types.ts'));
    assert.ok(rule.includes('src/app.ts'));
  });

  it('export-contract: includes consumers', () => {
    const rule = deriveLearnedRule(makeAssessment({
      rule: 'export-contract',
      file: 'src/utils.ts',
      details: 'src/app.ts, src/bar.ts',
    }));
    assert.ok(rule.includes('src/utils.ts'));
    assert.ok(rule.includes('consumers'));
  });

  it('circular-dependency: includes cycle info', () => {
    const rule = deriveLearnedRule(makeAssessment({
      rule: 'circular-dependency',
      file: 'src/a.ts',
      details: 'src/a.ts → src/b.ts → src/a.ts',
    }));
    assert.ok(rule.includes('circular'));
    assert.ok(rule.includes('src/a.ts'));
  });

  it('test-coverage-gap: includes test file', () => {
    const rule = deriveLearnedRule(makeAssessment({
      rule: 'test-coverage-gap',
      file: 'src/utils.ts',
      details: 'src/utils.test.ts may need updates',
    }));
    assert.ok(rule.includes('src/utils.ts'));
    assert.ok(rule.includes('src/utils.test.ts'));
  });

  it('co-change: falls back to details when no missing match in context', () => {
    const rule = deriveLearnedRule(makeAssessment({
      rule: 'co-change',
      file: 'src/types.ts',
      details: 'Not yet updated: src/foo.ts',
      dependencyContext: '2 strong dependents, 0 updated',
    }));
    assert.ok(rule.includes('src/types.ts'));
    assert.ok(rule.includes('Not yet updated'));
  });

  it('unknown rules: falls back to rule + message', () => {
    const rule = deriveLearnedRule(makeAssessment({
      rule: 'custom-rule',
      message: 'Something happened',
    }));
    assert.ok(rule.includes('custom-rule'));
    assert.ok(rule.includes('Something happened'));
  });
});

// ── Learned rule markers ─────────────────────────────────────

describe('appendLearnedRule', () => {
  it('appends new block when no markers exist', () => {
    const md = '## Operating Mode\n- Rule 1\n';
    const result = appendLearnedRule(md, 'New learned rule');
    assert.ok(result.includes(LEARNED_START));
    assert.ok(result.includes(LEARNED_END));
    assert.ok(result.includes('- New learned rule'));
  });

  it('uses double newline separator when content does not end with newline', () => {
    const md = '## Operating Mode\n- Rule 1';  // no trailing newline
    const result = appendLearnedRule(md, 'New rule');
    assert.ok(result.includes(LEARNED_START));
    assert.ok(result.includes('- New rule'));
    // Should have \n\n before the learned block
    const startIdx = result.indexOf(LEARNED_START);
    assert.equal(result.slice(startIdx - 2, startIdx), '\n\n');
  });

  it('inserts before end marker when markers exist', () => {
    const md = `## Rules\n- Rule 1\n\n${LEARNED_START}\n- Existing rule\n${LEARNED_END}\n`;
    const result = appendLearnedRule(md, 'Another rule');
    assert.ok(result.includes('- Existing rule'));
    assert.ok(result.includes('- Another rule'));
    // Both should be between markers
    const startIdx = result.indexOf(LEARNED_START);
    const endIdx = result.indexOf(LEARNED_END);
    const between = result.slice(startIdx, endIdx);
    assert.ok(between.includes('Existing rule'));
    assert.ok(between.includes('Another rule'));
  });
});

describe('getLearnedRules', () => {
  it('extracts bullet lines between markers', () => {
    const md = `before\n${LEARNED_START}\n- Rule A\n- Rule B\n${LEARNED_END}\nafter`;
    const rules = getLearnedRules(md);
    assert.deepEqual(rules, ['Rule A', 'Rule B']);
  });

  it('returns empty array when no markers', () => {
    assert.deepEqual(getLearnedRules('## No markers here\n- Rule'), []);
  });

  it('ignores non-bullet lines between markers', () => {
    const md = `${LEARNED_START}\nsome text\n- Bullet\n\n${LEARNED_END}`;
    assert.deepEqual(getLearnedRules(md), ['Bullet']);
  });
});

describe('stripLearnedBlock', () => {
  it('removes entire learned block', () => {
    const md = `## Rules\n- Rule 1\n\n${LEARNED_START}\n- Learned\n${LEARNED_END}\n`;
    const result = stripLearnedBlock(md);
    assert.ok(!result.includes(LEARNED_START));
    assert.ok(!result.includes(LEARNED_END));
    assert.ok(!result.includes('Learned'));
    assert.ok(result.includes('Rule 1'));
  });

  it('returns unchanged when no markers', () => {
    const md = '## Rules\n- Rule 1\n';
    assert.equal(stripLearnedBlock(md), md);
  });

  it('handles block at end of file', () => {
    const md = `## Rules\n- Rule 1\n\n${LEARNED_START}\n- Learned\n${LEARNED_END}`;
    const result = stripLearnedBlock(md);
    assert.ok(result.includes('Rule 1'));
    assert.ok(!result.includes('Learned'));
  });

  it('returns empty string when block is entire content', () => {
    const md = `${LEARNED_START}\n- Only learned\n${LEARNED_END}`;
    const result = stripLearnedBlock(md);
    assert.equal(result, '');
  });
});

// ── Response parsing ─────────────────────────────────────────

describe('parseDreamResponse', () => {
  it('parses response with only AGENTS.md content', () => {
    const result = parseDreamResponse('## Rules\n- Rule 1\n');
    assert.equal(result.agentsMd, '## Rules\n- Rule 1\n');
    assert.deepEqual(result.scopedRules, []);
  });

  it('parses response with AGENTS.md and scoped rules', () => {
    const response = [
      '## Rules',
      '- Broad rule',
      '',
      '---SCOPED_RULES---',
      '[{"slug":"hub-src-core","description":"Hub safety","globs":["src/core/**"],"content":"- Check dependents"}]',
    ].join('\n');
    const result = parseDreamResponse(response);
    assert.ok(result.agentsMd.includes('Broad rule'));
    assert.ok(!result.agentsMd.includes('SCOPED_RULES'));
    assert.equal(result.scopedRules.length, 1);
    assert.equal(result.scopedRules[0].slug, 'hub-src-core');
    assert.deepEqual(result.scopedRules[0].globs, ['src/core/**']);
    assert.equal(result.scopedRules[0].source, 'dream');
  });

  it('strips code fences from AGENTS.md part', () => {
    const response = '```markdown\n## Rules\n- Rule 1\n```';
    const result = parseDreamResponse(response);
    assert.ok(!result.agentsMd.includes('```'));
    assert.ok(result.agentsMd.includes('Rule 1'));
  });

  it('handles malformed scoped rules JSON gracefully', () => {
    const response = '## Rules\n---SCOPED_RULES---\n{not valid json}';
    const result = parseDreamResponse(response);
    assert.ok(result.agentsMd.includes('Rules'));
    assert.deepEqual(result.scopedRules, []);
  });

  it('filters scoped rules with missing required fields', () => {
    const response = [
      '## Rules',
      '---SCOPED_RULES---',
      '[{"slug":"good","description":"d","globs":["**"],"content":"c"},{"slug":"bad"}]',
    ].join('\n');
    const result = parseDreamResponse(response);
    assert.equal(result.scopedRules.length, 1);
    assert.equal(result.scopedRules[0].slug, 'good');
  });

  it('handles code-fenced JSON in scoped rules section', () => {
    const response = [
      '## Rules',
      '---SCOPED_RULES---',
      '```json',
      '[{"slug":"x","description":"d","globs":["a/**"],"content":"c"}]',
      '```',
    ].join('\n');
    const result = parseDreamResponse(response);
    assert.equal(result.scopedRules.length, 1);
  });

  it('ensures AGENTS.md ends with newline', () => {
    const result = parseDreamResponse('## Rules');
    assert.ok(result.agentsMd.endsWith('\n'));
  });
});

// ── Dream cycle LLM call ─────────────────────────────────────

describe('runDreamCycle', () => {
  const quietLog = {
    info(_msg: string) { /* noop */ },
    warn(_msg: string) { /* noop */ },
    error(_msg: string) { /* noop */ },
    debug(_msg: string) { /* noop */ },
  };

  it('returns unchanged when no corrections', async () => {
    const provider = { name: 'fake', async chat() { return 'should not be called'; } };
    const result = await runDreamCycle({
      currentAgentsMd: '## Rules\n- Rule 1\n',
      corrections: [],
      provider,
      log: quietLog,
    });
    assert.equal(result.updatedAgentsMd, '## Rules\n- Rule 1\n');
    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.scopedRules, []);
  });

  it('calls LLM and returns updated content', async () => {
    const provider = {
      name: 'fake',
      async chat() {
        return '## Rules\n- Rule 1\n- New strengthened rule\n';
      },
    };
    const result = await runDreamCycle({
      currentAgentsMd: '## Rules\n- Rule 1\n',
      corrections: [
        { timestamp: Date.now(), action: 'confirm', assessment: makeAssessment() },
      ],
      provider,
      log: quietLog,
    });
    assert.ok(result.updatedAgentsMd.includes('New strengthened rule'));
    assert.ok(result.changes.some((c) => c.includes('confirmed')));
  });

  it('strips code fences from LLM response', async () => {
    const provider = {
      name: 'fake',
      async chat() {
        return '```markdown\n## Rules\n- Rule 1\n```';
      },
    };
    const result = await runDreamCycle({
      currentAgentsMd: '## Rules\n',
      corrections: [
        { timestamp: Date.now(), action: 'dismiss', assessment: makeAssessment() },
      ],
      provider,
      log: quietLog,
    });
    assert.ok(!result.updatedAgentsMd.includes('```'));
    assert.ok(result.changes.some((c) => c.includes('dismissed')));
  });

  it('counts confirmed and dismissed separately', async () => {
    const provider = {
      name: 'fake',
      async chat() { return '## Updated\n'; },
    };
    const result = await runDreamCycle({
      currentAgentsMd: '## Rules\n',
      corrections: [
        { timestamp: Date.now(), action: 'confirm', assessment: makeAssessment() },
        { timestamp: Date.now(), action: 'confirm', assessment: makeAssessment() },
        { timestamp: Date.now(), action: 'dismiss', assessment: makeAssessment() },
      ],
      provider,
      log: quietLog,
    });
    assert.ok(result.changes.includes('2 confirmed'));
    assert.ok(result.changes.includes('1 dismissed'));
  });

  it('returns scoped rules when LLM includes them', async () => {
    const response = [
      '## Rules\n- Updated rule',
      '---SCOPED_RULES---',
      '[{"slug":"hub-src","description":"Hub safety","globs":["src/**"],"content":"- Check deps"}]',
    ].join('\n');
    const provider = { name: 'fake', async chat() { return response; } };
    const result = await runDreamCycle({
      currentAgentsMd: '## Rules\n',
      corrections: [
        { timestamp: Date.now(), action: 'confirm', assessment: makeAssessment() },
      ],
      provider,
      log: quietLog,
    });
    assert.equal(result.scopedRules.length, 1);
    assert.equal(result.scopedRules[0].slug, 'hub-src');
    assert.ok(result.changes.some((c) => c.includes('scoped')));
  });

  it('returns empty scopedRules when LLM omits them', async () => {
    const provider = { name: 'fake', async chat() { return '## Rules\n- Just broad\n'; } };
    const result = await runDreamCycle({
      currentAgentsMd: '## Rules\n',
      corrections: [
        { timestamp: Date.now(), action: 'dismiss', assessment: makeAssessment() },
      ],
      provider,
      log: quietLog,
    });
    assert.deepEqual(result.scopedRules, []);
  });

  it('includes assessment details in LLM prompt', async () => {
    let capturedMessages: any[] = [];
    const provider = {
      name: 'recording',
      async chat(msgs: any[]) {
        capturedMessages = msgs;
        return '## Updated\n';
      },
    };
    await runDreamCycle({
      currentAgentsMd: '## Rules\n',
      corrections: [
        {
          timestamp: Date.now(),
          action: 'confirm',
          assessment: makeAssessment({
            file: 'src/hub.ts',
            details: 'src/a.ts, src/b.ts',
            dependencyContext: '3 strong dependents',
          }),
        },
      ],
      provider,
      log: quietLog,
    });
    const userMsg = capturedMessages.find((m: any) => m.role === 'user');
    assert.ok(userMsg);
    assert.ok(userMsg.content.includes('CONFIRMED'));
    assert.ok(userMsg.content.includes('src/hub.ts'));
    assert.ok(userMsg.content.includes('src/a.ts, src/b.ts'));
    assert.ok(userMsg.content.includes('3 strong dependents'));
  });

  it('includes current AGENTS.md in LLM prompt', async () => {
    let capturedMessages: any[] = [];
    const provider = {
      name: 'recording',
      async chat(msgs: any[]) {
        capturedMessages = msgs;
        return '## Updated\n';
      },
    };
    await runDreamCycle({
      currentAgentsMd: '## Special Section\n- Unique rule xyz\n',
      corrections: [
        { timestamp: Date.now(), action: 'dismiss', assessment: makeAssessment() },
      ],
      provider,
      log: quietLog,
    });
    const userMsg = capturedMessages.find((m: any) => m.role === 'user');
    assert.ok(userMsg.content.includes('Special Section'));
    assert.ok(userMsg.content.includes('Unique rule xyz'));
  });

  it('propagates errors from provider', async () => {
    const provider = {
      name: 'failing',
      async chat(): Promise<string> { throw Object.assign(new Error('HTTP 401 unauthorized'), { status: 401 }); },
    };
    await assert.rejects(
      () => runDreamCycle({
        currentAgentsMd: '## Rules\n',
        corrections: [
          { timestamp: Date.now(), action: 'confirm', assessment: makeAssessment() },
        ],
        provider,
        log: quietLog,
      }),
      /401/,
    );
  });
});
