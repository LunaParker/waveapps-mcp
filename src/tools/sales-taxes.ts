import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { SALES_TAXES_QUERY } from './_queries.js';
import { flattenConnection, jsonResult } from './_helpers.js';
import { shapeSalesTaxSummary } from './_shape.js';

interface SalesTaxesResponse {
  business: {
    id: string;
    salesTaxes: {
      pageInfo: { currentPage: number; totalPages: number; totalCount: number };
      edges: ReadonlyArray<{ node: unknown }>;
    };
  };
}

export function registerSalesTaxTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_list_sales_taxes',
    {
      title: 'List Wave sales taxes',
      description:
        'Lists the sales taxes set up in the business (e.g. HST, GST, PST). `id` is the integer that wave_create_invoice and wave_update_invoice take in `items[].taxes`, and wave_create_estimate and wave_update_estimate in `items[].taxIds`. `rate` is a fraction (0.13 is 13%); `rates` lists past and current rates with the date each took effect. Archived taxes are left out unless `includeArchived` is true.',
      inputSchema: {
        businessId: z.uuid().optional(),
        includeArchived: z.boolean().default(false),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(500).default(100),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, includeArchived, page, pageSize }) => {
      const data = await client.gql.execute<SalesTaxesResponse>({
        operationName: 'ListSalesTaxes',
        query: SALES_TAXES_QUERY,
        variables: {
          businessId: client.businessGlobalId(businessId),
          page,
          pageSize,
          // null asks for every tax; false leaves the archived ones out.
          isArchived: includeArchived ? null : false,
        },
      });
      return jsonResult({
        salesTaxes: flattenConnection(data.business.salesTaxes).map(shapeSalesTaxSummary),
        pageInfo: data.business.salesTaxes.pageInfo,
      });
    },
  );
}
