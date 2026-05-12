import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { TRANSACTIONS_QUERY } from './_queries.js';
import { flattenConnection, jsonResult } from './_helpers.js';

const TransactionSort = z.enum(['DATE_CREATED_DESC', 'DATE_CREATED_ASC']);

interface TransactionsResponse {
  business: {
    id: string;
    roles: ReadonlyArray<string>;
    transactions: { edges: ReadonlyArray<{ node: unknown }> };
  };
}

export function registerReceiptTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_list_receipts',
    {
      title: 'List Wave receipts',
      description:
        'Lists receipt-capture transactions for a Wave business. GraphQL-backed; receipts are modelled as transactions with `originType: "RECEIPT_CAPTURE"`. Returns id, amount, currency, dateCreated, description, attachment thumbnail, and any missingFields the server has flagged.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        first: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('Number of receipts to return (Relay-style limit).'),
        sort: TransactionSort.default('DATE_CREATED_DESC'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, first, sort }) => {
      const data = await client.gql.execute<TransactionsResponse>({
        operationName: 'GetTransactions',
        query: TRANSACTIONS_QUERY,
        variables: {
          businessId: client.businessGlobalId(businessId),
          first,
          sort: [sort],
          filters: { originType: 'RECEIPT_CAPTURE' },
        },
      });
      return jsonResult({
        receipts: flattenConnection(data.business.transactions),
        roles: data.business.roles,
      });
    },
  );
}
