import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { jsonResult } from './_helpers.js';

export function registerBusinessTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_list_businesses',
    {
      title: 'List Wave businesses',
      description:
        'Returns every business (workspace) the current user has access to. Useful for picking a `businessId` to pass to the other tools.',
      inputSchema: {
        includePersonal: z
          .boolean()
          .default(true)
          .describe('Include personal/sandbox business records. Defaults to true.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ includePersonal }) => {
      const businesses = await client.rest.get<unknown>('/businesses/', {
        include_personal: includePersonal,
      });
      return jsonResult({ businesses });
    },
  );

  server.registerTool(
    'wave_get_business',
    {
      title: 'Get one Wave business',
      description: 'Fetches a single business by UUID, including profile/address/currency.',
      inputSchema: {
        businessId: z
          .string()
          .uuid()
          .optional()
          .describe('Plain UUID. Omit to use the configured default business.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId }) => {
      const id = client.businessId(businessId);
      const business = await client.rest.get<unknown>(`/businesses/${id}/`);
      return jsonResult({ business });
    },
  );
}
