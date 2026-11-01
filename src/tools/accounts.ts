import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { jsonResult } from './_helpers.js';
import { shapeAccount } from './_shape.js';

const AccountType = z.enum(['income', 'expense', 'asset', 'liability', 'equity']);

export function registerAccountTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_list_accounts',
    {
      title: 'List Wave chart-of-accounts entries',
      description:
        'Lists the chart of accounts. Accounts with `is_payment: true` (bank accounts, "Cash on Hand", "Wave Payments") are what wave_record_invoice_payment takes as `paymentAccountId`; accounts with `account_type: "income"` are what products and invoice lines take as `incomeAccountId`.',
      inputSchema: {
        businessId: z.uuid().optional(),
        activeOnly: z.boolean().default(true).describe('Leave out archived accounts.'),
        accountType: AccountType.optional().describe('Only return accounts of this type.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, activeOnly, accountType }) => {
      const id = client.businessId(businessId);
      const raw = await client.rest.get<unknown>(`/businesses/${id}/accounts/`, { active_only: activeOnly });
      const accounts = (Array.isArray(raw) ? raw : [])
        .map(shapeAccount)
        .filter((a) => accountType === undefined || a.account_type === accountType);
      return jsonResult({ accounts });
    },
  );
}
