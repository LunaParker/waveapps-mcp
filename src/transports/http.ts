import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { log } from '../util/log.js';

export interface HttpOptions {
  port: number;
  bind: string;
  /** Required bearer token. Mandatory when `bind` is not a loopback address. */
  token: string | undefined;
}

export const MAX_BODY_BYTES = 1024 * 1024;

export function httpOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): HttpOptions {
  const rawPort = env['WAVE_MCP_PORT'];
  const port = rawPort === undefined || rawPort === '' ? 8765 : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`WAVE_MCP_PORT must be a port number, got: ${rawPort}`);
  }
  const bind = env['WAVE_MCP_BIND'] || '127.0.0.1';
  const token = tokenFromEnv(env);
  if (!isLoopback(bind) && !token) {
    throw new Error(
      'WAVE_MCP_BIND is not a loopback address; set WAVE_MCP_HTTP_TOKEN or WAVE_MCP_HTTP_TOKEN_FILE so only clients with the token can drive your Wave account.',
    );
  }
  return { port, bind, token };
}

/** The bearer token from WAVE_MCP_HTTP_TOKEN, or read once from the file WAVE_MCP_HTTP_TOKEN_FILE names. */
function tokenFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const inline = env['WAVE_MCP_HTTP_TOKEN'] || undefined;
  const file = env['WAVE_MCP_HTTP_TOKEN_FILE'] || undefined;
  if (inline && file) throw new Error('Set WAVE_MCP_HTTP_TOKEN or WAVE_MCP_HTTP_TOKEN_FILE, not both.');
  if (!file) return inline;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`Could not read WAVE_MCP_HTTP_TOKEN_FILE (${file}): ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
  }
  const token = text.trim();
  if (token.length === 0) throw new Error(`WAVE_MCP_HTTP_TOKEN_FILE (${file}) is empty.`);
  return token;
}

export function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** The host part of a Host header without the port; IPv6 keeps its brackets so isLoopback can read it. */
export function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h : h.slice(0, end + 1);
  }
  const colon = h.lastIndexOf(':');
  // A bare IPv6 address has several colons; leave it whole.
  return colon === -1 || h.indexOf(':') !== colon ? h : h.slice(0, colon);
}

export function isAuthorized(authorization: string | undefined, token: string | undefined): boolean {
  if (!token) return true;
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  if (!match) return false;
  const given = Buffer.from(match[1] as string, 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

class BodyTooLargeError extends Error {}

/**
 * Streamable HTTP transport with one MCP session per `mcp-session-id`.
 *
 * The SDK forbids reusing a single `StreamableHTTPServerTransport` across
 * requests ("Stateless transport cannot be reused across requests"), and a
 * fresh-transport-per-request (stateless) setup breaks clients that send
 * `initialize` and follow-up calls as separate POSTs — e.g. a FastMCP proxy in
 * front of us — because the follow-ups land on an uninitialized server. So we
 * key a transport+server pair by the session id the SDK mints on initialize,
 * and route later requests (and the SSE GET / teardown DELETE) back to it.
 *
 * `buildServer` is a factory: each new session gets its own McpServer (and thus
 * its own Wave client), which keeps sessions isolated.
 */
export async function startHttp(buildServer: () => McpServer, opts: HttpOptions = httpOptionsFromEnv()): Promise<Server> {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  let listeningPort = opts.port;

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    handleRequest(req, res, buildServer, transports, opts).catch((err: unknown) => {
      log.error('http request failed', { err: String(err) });
      if (!res.headersSent) reply(res, 500, -32603, 'Internal server error');
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(opts.port, opts.bind, () => resolve()));
  const addr = httpServer.address();
  if (addr && typeof addr === 'object') listeningPort = addr.port;
  log.info('http transport listening', {
    url: `http://${opts.bind}:${listeningPort}/mcp`,
    auth: opts.token ? 'bearer token' : 'none (loopback only)',
  });
  return httpServer;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  buildServer: () => McpServer,
  transports: Map<string, StreamableHTTPServerTransport>,
  opts: HttpOptions,
): Promise<void> {
  if (!isAuthorized(req.headers.authorization, opts.token)) {
    reply(res, 401, -32001, 'Unauthorized: send the WAVE_MCP_HTTP_TOKEN as a bearer token');
    return;
  }
  // A web page can reach a loopback listener through DNS rebinding; its Host header gives it away.
  if (isLoopback(opts.bind) && !isLoopback(hostnameOf(req.headers.host ?? ''))) {
    reply(res, 403, -32000, 'Forbidden: Host header is not a loopback address');
    return;
  }

  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // POST carries a JSON-RPC message; GET opens the server->client SSE stream;
  // DELETE ends the session. node:http has no body parser, so we read+parse the
  // POST body ourselves and hand it to the SDK as the pre-parsed body — both to
  // route on `initialize` and so the SDK doesn't re-read a consumed stream.
  let body: unknown;
  if (req.method === 'POST') {
    try {
      body = await readJsonBody(req);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        reply(res, 413, -32600, `Request body exceeds ${MAX_BODY_BYTES} bytes`);
      } else {
        reply(res, 400, -32700, 'Parse error: request body is not valid JSON');
      }
      return;
    }
  }

  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    if (req.method !== 'POST' || !isInitializeRequest(body)) {
      reply(res, 400, -32000, 'Bad Request: no valid session id, and not an initialize request');
      return;
    }
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport!);
      },
    });
    transport.onclose = () => {
      const sid = transport!.sessionId;
      if (sid) transports.delete(sid);
    };
    const server = buildServer();
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, body);
}

const DRAIN_LIMIT_BYTES = 8 * MAX_BODY_BYTES;

async function readJsonBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) {
      // Keep reading so the client sees the 413 instead of a reset, up to a hard cap.
      tooLarge = true;
      if (total > DRAIN_LIMIT_BYTES) {
        req.destroy();
        break;
      }
      continue;
    }
    chunks.push(chunk as Buffer);
  }
  if (tooLarge) throw new BodyTooLargeError();
  if (total === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function reply(res: ServerResponse, status: number, code: number, message: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}
