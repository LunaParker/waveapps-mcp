import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { jsonResult } from './_helpers.js';
import { shapeBusiness } from './_shape.js';

export function registerBusinessTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_list_businesses',
    {
      title: 'List Wave businesses',
      description:
        'Lists the Wave businesses (workspaces) the signed-in user can access, with each one\'s currency, country and verified invoice-sending email addresses. Pass a business `id` as `businessId` to the other tools when the user has more than one.',
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
      return jsonResult({ businesses: (Array.isArray(businesses) ? businesses : []).map(shapeBusiness) });
    },
  );

  server.registerTool(
    'wave_get_business',
    {
      title: 'Get one Wave business',
      description:
        'Fetches one business: name, currency, country, time zone and `invoice_sending_emails`, whose verified entries are the only valid `fromAddress` values for wave_send_invoice.',
      inputSchema: {
        businessId: z
          .uuid()
          .optional()
          .describe('Plain UUID. Omit to use the configured default business.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId }) => {
      const id = client.businessId(businessId);
      const business = await client.rest.get<unknown>(`/businesses/${id}/`);
      return jsonResult({ business: shapeBusiness(business) });
    },
  );
}
