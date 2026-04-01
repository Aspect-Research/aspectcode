/**
 * Tests for the Aspect Code hosted LLM provider.
 */

import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import { createAspectCodeProvider } from '../src/providers/aspectcode';

describe('AspectCodeProvider', () => {
  let server: http.Server;
  let serverPort: number;

  // Spin up a local mock server for each test
  function startMockServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<void> {
    return new Promise((resolve) => {
      server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        serverPort = (server.address() as { port: number }).port;
        process.env.ASPECTCODE_WEB_URL = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });
  }

  afterEach((done) => {
    delete process.env.ASPECTCODE_WEB_URL;
    if (server) server.close(done);
    else done();
  });

  it('sends messages and returns content from chat()', async () => {
    let receivedBody: any;

    await startMockServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        receivedBody = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          content: 'Hello from hosted provider',
          usage: { inputTokens: 10, outputTokens: 5 },
        }));
      });
    });

    const provider = createAspectCodeProvider('test-token');
    const result = await provider.chat([
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: 'Hi' },
    ]);

    assert.equal(result, 'Hello from hosted provider');
    assert.equal(receivedBody.messages.length, 2);
    assert.equal(receivedBody.messages[0].role, 'system');
    assert.equal(receivedBody.temperature, 0.4);
  });

  it('returns usage from chatWithUsage()', async () => {
    await startMockServer((_req, res) => {
      let body = '';
      _req.on('data', (chunk) => { body += chunk; });
      _req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          content: 'response',
          usage: { inputTokens: 100, outputTokens: 50 },
        }));
      });
    });

    const provider = createAspectCodeProvider('test-token');
    const result = await provider.chatWithUsage!([
      { role: 'user', content: 'test' },
    ]);

    assert.equal(result.content, 'response');
    assert.equal(result.usage?.inputTokens, 100);
    assert.equal(result.usage?.outputTokens, 50);
  });

  it('passes temperature override from chatWithOptions()', async () => {
    let receivedBody: any;

    await startMockServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        receivedBody = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: 'ok' }));
      });
    });

    const provider = createAspectCodeProvider('test-token');
    await provider.chatWithOptions!(
      [{ role: 'user', content: 'test' }],
      { temperature: 0.9, maxTokens: 2048 },
    );

    assert.equal(receivedBody.temperature, 0.9);
    assert.equal(receivedBody.maxTokens, 2048);
  });

  it('sends Authorization header with CLI token', async () => {
    let receivedAuth: string | undefined;

    await startMockServer((req, res) => {
      receivedAuth = req.headers.authorization;
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: 'ok' }));
      });
    });

    const provider = createAspectCodeProvider('my-secret-token');
    await provider.chat([{ role: 'user', content: 'test' }]);

    assert.equal(receivedAuth, 'Bearer my-secret-token');
  });

  it('throws on non-200 response (auth error, no retry)', async () => {
    await startMockServer((_req, res) => {
      let body = '';
      _req.on('data', (chunk) => { body += chunk; });
      _req.on('end', () => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
      });
    });

    const provider = createAspectCodeProvider('test-token');
    await assert.rejects(
      () => provider.chat([{ role: 'user', content: 'test' }]),
      /401/,
    );
  });

  it('uses custom model from options', async () => {
    let receivedBody: any;

    await startMockServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        receivedBody = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: 'ok' }));
      });
    });

    const provider = createAspectCodeProvider('test-token', { model: 'claude-sonnet-4-6' });
    await provider.chat([{ role: 'user', content: 'test' }]);

    assert.equal(receivedBody.model, 'claude-sonnet-4-6');
  });

  it('defaults model to "auto" when not specified', async () => {
    let receivedBody: any;

    await startMockServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        receivedBody = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: 'ok' }));
      });
    });

    const provider = createAspectCodeProvider('test-token');
    await provider.chat([{ role: 'user', content: 'test' }]);

    assert.equal(receivedBody.model, 'auto');
  });
});
