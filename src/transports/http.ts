import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { log } from '../util/log.js';

const PORT = Number(process.env['WAVE_MCP_PORT'] ?? 8765);
const BIND = process.env['WAVE_MCP_BIND'] ?? '127.0.0.1';

export async function startHttp(server: McpServer): Promise<void> {
  // Stateless mode: one transport instance handles all incoming POST/GET
  // requests. Suitable for local single-user use. If you need multi-session
  // (e.g., for shared hosting), wire up `sessionIdGenerator` and a transports
  // map per spec — out of scope for v1.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    transport.handleRequest(req, res).catch((err: unknown) => {
      log.error('handleRequest failed', { err: String(err) });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
  });

  await new Promise<void>((resolve) => http.listen(PORT, BIND, () => resolve()));
  log.info('http transport listening', { url: `http://${BIND}:${PORT}/mcp` });
}
