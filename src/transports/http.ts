import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { log } from '../util/log.js';

const PORT = Number(process.env['WAVE_MCP_PORT'] ?? 8765);
const BIND = process.env['WAVE_MCP_BIND'] ?? '127.0.0.1';

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
export async function startHttp(buildServer: () => McpServer): Promise<void> {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    handleRequest(req, res, buildServer, transports).catch((err: unknown) => {
      log.error('http request failed', { err: String(err) });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(jsonRpcError(-32603, 'Internal server error'));
      }
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(PORT, BIND, () => resolve()));
  log.info('http transport listening', { url: `http://${BIND}:${PORT}/mcp` });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  buildServer: () => McpServer,
  transports: Map<string, StreamableHTTPServerTransport>,
): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // POST carries a JSON-RPC message; GET opens the server->client SSE stream;
  // DELETE ends the session. node:http has no body parser, so we read+parse the
  // POST body ourselves and hand it to the SDK as the pre-parsed body — both to
  // route on `initialize` and so the SDK doesn't re-read a consumed stream.
  let body: unknown;
  if (req.method === 'POST') {
    try {
      body = await readJsonBody(req);
    } catch {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(jsonRpcError(-32700, 'Parse error: request body is not valid JSON'));
      return;
    }
  }

  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    if (req.method !== 'POST' || !isInitializeRequest(body)) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(jsonRpcError(-32000, 'Bad Request: no valid session id, and not an initialize request'));
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

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw.length === 0 ? undefined : JSON.parse(raw);
}

function jsonRpcError(code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null });
}
