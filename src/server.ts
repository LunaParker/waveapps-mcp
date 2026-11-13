#!/usr/bin/env node
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startStdio } from './transports/stdio.js';
import { startHttp } from './transports/http.js';
import { log } from './util/log.js';
import { booleanEnv } from './util/env.js';
import { WaveClient } from './client/index.js';
import { registerAllTools } from './tools/index.js';
import { dispatchCli } from './cli/index.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

function buildServer(readOnly: boolean): McpServer {
  const server = new McpServer(
    { name: 'waveapps-mcp', version },
    { capabilities: { tools: {}, logging: {} } },
  );
  const client = WaveClient.fromEnv();
  registerAllTools(server, client, { readOnly });
  return server;
}

async function main(): Promise<void> {
  const cli = await dispatchCli(process.argv.slice(2));
  if (cli.handled) {
    process.exit(cli.exitCode);
  }
  const readOnly = booleanEnv('WAVE_MCP_READ_ONLY');
  if (readOnly) log.info('WAVE_MCP_READ_ONLY is on: tools that change Wave data are not registered');
  const transport = (process.env['WAVE_MCP_TRANSPORT'] ?? 'stdio').toLowerCase();
  switch (transport) {
    case 'stdio':
      await startStdio(buildServer(readOnly));
      return;
    case 'http':
      // startHttp builds a server per session, so it takes the factory itself.
      await startHttp(() => buildServer(readOnly));
      return;
    default:
      throw new Error(`Unknown WAVE_MCP_TRANSPORT="${transport}" (expected "stdio" or "http")`);
  }
}

main().catch((err: unknown) => {
  log.error('fatal', { err: String(err) });
  process.exit(1);
});
