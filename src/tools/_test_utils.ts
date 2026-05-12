import { vi, type Mock } from 'vitest';
import { z, type ZodRawShape } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';

export const BUSINESS_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
export const BUSINESS_GLOBAL_ID = 'QnVzaW5lc3M6YWFhYWFhYWEtYmJiYi1jY2NjLWRkZGQtZWVlZWVlZWVlZWVl';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

/** Stub McpServer that captures the handler each registerTool() call passes in. */
export interface StubServer {
  server: Pick<McpServer, 'registerTool'>;
  handlers: Map<string, ToolHandler>;
  configs: Map<string, unknown>;
  invoke: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  parsed: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
}

export function createStubServer(): StubServer {
  const handlers = new Map<string, ToolHandler>();
  const configs = new Map<string, { inputSchema?: ZodRawShape }>();
  const registerTool = vi.fn(
    (name: string, config: { inputSchema?: ZodRawShape }, handler: ToolHandler) => {
      handlers.set(name, handler);
      configs.set(name, config);
      return undefined as unknown as never;
    },
  );
  const server = { registerTool } as unknown as Pick<McpServer, 'registerTool'>;
  const applyZodDefaults = (name: string, args: Record<string, unknown>): Record<string, unknown> => {
    // The MCP SDK validates/applies defaults on `inputSchema` before invoking the handler.
    // Our stub bypasses the SDK, so we re-do that step here.
    const cfg = configs.get(name);
    if (!cfg?.inputSchema) return args;
    return z.object(cfg.inputSchema).parse(args) as Record<string, unknown>;
  };
  return {
    server,
    handlers,
    configs,
    async invoke(name, args = {}) {
      const h = handlers.get(name);
      if (!h) throw new Error(`Tool not registered: ${name}`);
      return h(applyZodDefaults(name, args));
    },
    async parsed(name, args = {}) {
      const result = (await this.invoke(name, args)) as {
        content?: ReadonlyArray<{ type: string; text: string }>;
      };
      const text = result.content?.[0]?.text;
      if (!text) throw new Error(`Tool ${name} returned no text content`);
      return JSON.parse(text);
    },
  };
}

export interface MockWaveClient {
  client: WaveClient;
  rest: {
    get: Mock;
    getPaged: Mock;
    post: Mock;
    patch: Mock;
    put: Mock;
    delete: Mock;
  };
  gql: { execute: Mock };
  businessId: Mock;
  businessGlobalId: Mock;
}

export function createMockClient(opts: { defaultBusinessId?: string } = {}): MockWaveClient {
  const defaultId = opts.defaultBusinessId ?? BUSINESS_UUID;
  const rest = {
    get: vi.fn(),
    getPaged: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
  const gql = { execute: vi.fn() };
  const businessId = vi.fn((explicit?: string) => explicit ?? defaultId);
  const businessGlobalId = vi.fn((explicit?: string) => {
    const id = explicit ?? defaultId;
    return Buffer.from(`Business:${id}`, 'utf8').toString('base64');
  });
  const client = {
    rest,
    gql,
    businessId,
    businessGlobalId,
  } as unknown as WaveClient;
  return { client, rest, gql, businessId, businessGlobalId };
}
