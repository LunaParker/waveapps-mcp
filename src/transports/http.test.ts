import { request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { httpOptionsFromEnv, isAuthorized, isLoopback, startHttp } from './http.js';

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
});
const HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

describe('isLoopback', () => {
  it('accepts localhost, 127.x and ::1', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]']) expect(isLoopback(h)).toBe(true);
  });

  it('rejects everything else', () => {
    for (const h of ['0.0.0.0', '192.168.1.10', '10.0.0.1', 'example.com', '::', '']) expect(isLoopback(h)).toBe(false);
  });
});

describe('httpOptionsFromEnv', () => {
  it('defaults to 127.0.0.1:8765 with no token', () => {
    expect(httpOptionsFromEnv({})).toEqual({ port: 8765, bind: '127.0.0.1', token: undefined });
  });

  it('reads the variables', () => {
    expect(httpOptionsFromEnv({ WAVE_MCP_PORT: '9000', WAVE_MCP_BIND: '0.0.0.0', WAVE_MCP_HTTP_TOKEN: 'EXAMPLE_TOKEN_value' })).toEqual({
      port: 9000,
      bind: '0.0.0.0',
      token: 'EXAMPLE_TOKEN_value',
    });
  });

  it('refuses a non-loopback bind without a token', () => {
    expect(() => httpOptionsFromEnv({ WAVE_MCP_BIND: '0.0.0.0' })).toThrow(/WAVE_MCP_HTTP_TOKEN/);
  });

  it('refuses a bad port', () => {
    expect(() => httpOptionsFromEnv({ WAVE_MCP_PORT: 'eighty' })).toThrow(/WAVE_MCP_PORT/);
    expect(() => httpOptionsFromEnv({ WAVE_MCP_PORT: '70000' })).toThrow(/WAVE_MCP_PORT/);
  });
});

describe('isAuthorized', () => {
  it('passes everything when no token is configured', () => {
    expect(isAuthorized(undefined, undefined)).toBe(true);
    expect(isAuthorized('Bearer anything', undefined)).toBe(true);
  });

  it('requires the exact bearer token when one is configured', () => {
    expect(isAuthorized('Bearer EXAMPLE_TOKEN_value', 'EXAMPLE_TOKEN_value')).toBe(true);
    expect(isAuthorized('bearer EXAMPLE_TOKEN_value', 'EXAMPLE_TOKEN_value')).toBe(true);
    expect(isAuthorized('Bearer EXAMPLE_TOKEN_other', 'EXAMPLE_TOKEN_value')).toBe(false);
    expect(isAuthorized('Bearer EXAMPLE_TOKEN_valu', 'EXAMPLE_TOKEN_value')).toBe(false);
    expect(isAuthorized(undefined, 'EXAMPLE_TOKEN_value')).toBe(false);
    expect(isAuthorized('Basic abc', 'EXAMPLE_TOKEN_value')).toBe(false);
  });
});

describe('startHttp', () => {
  let server: Server;
  let base: string;
  let port: number;

  beforeAll(async () => {
    server = await startHttp(() => new McpServer({ name: 'test', version: '0' }), { port: 0, bind: '127.0.0.1', token: 'EXAMPLE_TOKEN_value' });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    port = addr.port;
    base = `http://127.0.0.1:${port}/mcp`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects requests without the bearer token', async () => {
    const res = await fetch(base, { method: 'POST', headers: HEADERS, body: INITIALIZE });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32001 } });
  });

  it('opens a session on initialize when the token matches', async () => {
    const res = await fetch(base, { method: 'POST', headers: { ...HEADERS, authorization: 'Bearer EXAMPLE_TOKEN_value' }, body: INITIALIZE });
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toMatch(/^[0-9a-f-]{36}$/);
    await res.body?.cancel();
  });

  it('rejects a non-initialize request with no session', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const res = await fetch(base, { method: 'POST', headers: { ...HEADERS, authorization: 'Bearer EXAMPLE_TOKEN_value' }, body });
    expect(res.status).toBe(400);
  });

  it('rejects a body over 1 MiB', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { pad: 'x'.repeat(1024 * 1024 + 10) } });
    const res = await fetch(base, { method: 'POST', headers: { ...HEADERS, authorization: 'Bearer EXAMPLE_TOKEN_value' }, body });
    expect(res.status).toBe(413);
  });

  it('rejects a foreign Host header (DNS rebinding)', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { ...HEADERS, authorization: 'Bearer EXAMPLE_TOKEN_value', host: 'evil.example:80' } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end(INITIALIZE);
    });
    expect(status).toBe(403);
  });
});
