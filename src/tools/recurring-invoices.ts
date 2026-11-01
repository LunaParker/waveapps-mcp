import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { jsonResult } from './_helpers.js';
import { shapeRecurringInvoice, shapeRecurringInvoiceDetail } from './_shape.js';

// Values from Wave's web app; the API ignores a state it doesn't know instead of rejecting it.
const RecurringState = z.enum(['draft', 'active', 'paused', 'errored', 'ended', 'completed']);
// The API rejects any other sort and lists these in its error.
const RecurringSort = z.enum(['next_invoice_date', '-next_invoice_date', 'previous_invoice_date', '-previous_invoice_date', 'date_added', '-date_added', 'state', '-state']);

export function registerRecurringInvoiceTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_list_recurring_invoices',
    {
      title: 'List Wave recurring invoices',
      description:
        "Lists recurring invoice schedules: state, customer, total, payment terms, the previous and next invoice dates and how many invoices each has generated. Read-only: Wave has no way to delete a recurring invoice, so this MCP doesn't create them.",
      inputSchema: {
        businessId: z.uuid().optional(),
        state: RecurringState.optional(),
        customerId: z.number().int().positive().optional().describe('Integer `internalId` from wave_list_customers.'),
        sort: RecurringSort.default('-date_added'),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(25),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const id = client.businessId(args.businessId);
      const paged = await client.rest.getPaged<unknown>(`/businesses/${id}/recurring-invoices/`, {
        page_index: args.page,
        page_size: args.pageSize,
        sort: args.sort,
        state: args.state,
        customer_id: args.customerId,
      });
      // getPaged reads `page`; this endpoint pages with page_index instead.
      return jsonResult({ items: paged.items.map(shapeRecurringInvoice), meta: { ...paged.meta, page: args.page } });
    },
  );

  server.registerTool(
    'wave_get_recurring_invoice',
    {
      title: 'Get one Wave recurring invoice',
      description:
        "Fetches one recurring invoice with its line items, notes and footer, and its schedule and delivery settings as Wave sends them (null until the schedule is set).",
      inputSchema: {
        businessId: z.uuid().optional(),
        recurringInvoiceId: z.string().min(1).describe('`id` from wave_list_recurring_invoices.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, recurringInvoiceId }) => {
      const id = client.businessId(businessId);
      const raw = await client.rest.get<unknown>(`/businesses/${id}/recurring-invoices/${encodeURIComponent(recurringInvoiceId)}/`);
      return jsonResult({ recurringInvoice: shapeRecurringInvoiceDetail(raw) });
    },
  );
}
