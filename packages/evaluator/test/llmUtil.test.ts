/**
 * Tests for chatWithTemp — LLM call utility with temperature routing.
 */

import * as assert from 'node:assert/strict';
import { chatWithTemp } from '../src/llmUtil';
import { fakeProvider } from './helpers';
import type { ChatMessage } from '@aspectcode/optimizer';

describe('chatWithTemp', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello' },
  ];

  it('calls chatWithOptions when provider supports it', async () => {
    let usedOptions = false;
    const provider = {
      name: 'test',
      async chat() { return 'via chat'; },
      async chatWithOptions(_msgs: ChatMessage[], opts?: { temperature?: number }) {
        usedOptions = true;
        assert.equal(opts?.temperature, 0.5);
        return 'via options';
      },
    };
    const result = await chatWithTemp(provider, messages, 0.5);
    assert.equal(result, 'via options');
    assert.ok(usedOptions);
  });

  it('falls back to chat when chatWithOptions is absent', async () => {
    const provider = fakeProvider(['fallback response']);
    const result = await chatWithTemp(provider, messages, 0.5);
    assert.equal(result, 'fallback response');
  });

  it('passes temperature to chatWithOptions', async () => {
    let receivedTemp: number | undefined;
    const provider = {
      name: 'test',
      async chat() { return ''; },
      async chatWithOptions(_msgs: ChatMessage[], opts?: { temperature?: number }) {
        receivedTemp = opts?.temperature;
        return 'ok';
      },
    };
    await chatWithTemp(provider, messages, 0.9);
    assert.equal(receivedTemp, 0.9);
  });

  it('throws AbortError when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = fakeProvider(['should not be called']);
    await assert.rejects(
      () => chatWithTemp(provider, messages, 0.0, controller.signal),
      (err: any) => err.name === 'AbortError',
    );
  });

  it('rejects when signal fires during chat call', async () => {
    const controller = new AbortController();
    const provider = {
      name: 'slow',
      async chat() {
        // Simulate slow call
        return new Promise<string>((resolve) => {
          setTimeout(() => resolve('late'), 5000);
        });
      },
    };
    const promise = chatWithTemp(provider, messages, 0.0, controller.signal);
    // Abort shortly after
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(promise, (err: any) => err.name === 'AbortError');
  });

  it('resolves normally when no signal provided', async () => {
    const provider = fakeProvider(['normal response']);
    const result = await chatWithTemp(provider, messages, 0.0);
    assert.equal(result, 'normal response');
  });
});
