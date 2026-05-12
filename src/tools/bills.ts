import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { BILLS_QUERY } from './_queries.js';
import { flattenConnection, jsonResult } from './_helpers.js';

const BillSort = z.enum(['BILL_DATE_DESC', 'BILL_DATE_ASC', 'DUE_DATE_DESC', 'DUE_DATE_ASC']);

interface BillsResponse {
  business: {
    id: string;
    bills: {
      pageInfo: { totalCount: number };
      edges: ReadonlyArray<{ node: unknown }>;
      businessSupportsContractorPayments: boolean;
    };
  };
}

export function registerBillTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_list_bills',
    {
      title: 'List Wave bills',
      description:
        'Lists vendor bills (purchases) for a Wave business. GraphQL-backed; filter by vendor and date range.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(25),
        sort: BillSort.default('BILL_DATE_DESC'),
        vendorId: z
          .string()
          .optional()
          .describe('Relay global ID of the vendor (base64 `Vendor:UUID`). Omit for all vendors.'),
        billDateStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        billDateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const data = await client.gql.execute<BillsResponse>({
        operationName: 'ListBills',
        query: BILLS_QUERY,
        variables: {
          businessId: client.businessGlobalId(args.businessId),
          page: args.page,
          pageSize: args.pageSize,
          sort: args.sort,
          vendorId: args.vendorId,
          billDateStart: args.billDateStart,
          billDateEnd: args.billDateEnd,
        },
      });
      return jsonResult({
        bills: flattenConnection(data.business.bills),
        totalCount: data.business.bills.pageInfo.totalCount,
        businessSupportsContractorPayments: data.business.bills.businessSupportsContractorPayments,
      });
    },
  );
}
