import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Wrap an object as the standard MCP "text content with JSON body" tool result. */
export function jsonResult(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

/** Flatten a Relay-style `{ edges: [{ node }] }` connection into a plain array. */
export function flattenConnection<T>(conn: { edges?: ReadonlyArray<{ node: T }> } | null | undefined): T[] {
  return (conn?.edges ?? []).map((e) => e.node);
}
