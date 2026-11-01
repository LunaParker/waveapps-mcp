import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { todayIso } from '../util/dates.js';
import { jsonResult } from './_helpers.js';
import { shapeInvoicePayment } from './_shape.js';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function registerPaymentTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_record_invoice_payment',
    {
      title: 'Record a payment against a Wave invoice',
      description:
        'Records a manual payment (bank transfer, cash, cheque, card, PayPal or other) against an approved invoice, moving it toward `paid`. The invoice must be approved first (wave_approve_invoice). Returns the recorded payment; its `id` is what wave_delete_invoice_payment takes.',
      inputSchema: {
        businessId: z.uuid().optional(),
        invoiceId: z.string().min(1).describe('Invoice `id` from wave_list_invoices or wave_get_invoice.'),
        amount: z.number().positive().describe('Amount in the invoice currency, e.g. 1429.13.'),
        paymentDate: IsoDate.optional().describe('YYYY-MM-DD. Defaults to today.'),
        paymentMethod: z
          .enum(['bank_transfer', 'cash', 'cheque', 'credit_card', 'paypal', 'other'])
          .default('bank_transfer')
          .describe('Wave labels: Bank payment = bank_transfer, Cash, Cheque, Credit card = credit_card, PayPal, Other.'),
        paymentAccountId: z
          .number()
          .int()
          .positive()
          .describe('Integer account id with `is_payment: true` from wave_list_accounts (a bank account, "Cash on Hand" or "Wave Payments").'),
        exchangeRate: z.number().default(1),
        memo: z.string().nullish(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const id = client.businessId(args.businessId);
      const payment = await client.rest.post<unknown>(
        `/businesses/${id}/invoices/${encodeURIComponent(args.invoiceId)}/payments/`,
        {
          amount: args.amount,
          exchange_rate: args.exchangeRate,
          memo: args.memo ?? null,
          payment_account: { id: args.paymentAccountId },
          payment_date: args.paymentDate ?? todayIso(),
          payment_method: args.paymentMethod,
        },
      );
      return jsonResult({ payment: shapeInvoicePayment(payment) });
    },
  );

  server.registerTool(
    'wave_delete_invoice_payment',
    {
      title: 'Remove a payment from a Wave invoice',
      description:
        'Removes a recorded payment from an invoice; Wave recomputes the invoice status (`paid` back to `unpaid` or `partial`). `paymentId` comes from wave_get_invoice `payments[].id` or from wave_record_invoice_payment.',
      inputSchema: {
        businessId: z.uuid().optional(),
        invoiceId: z.string().min(1),
        paymentId: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ businessId, invoiceId, paymentId }) => {
      const id = client.businessId(businessId);
      await client.rest.delete(
        `/businesses/${id}/invoices/${encodeURIComponent(invoiceId)}/payments/${encodeURIComponent(paymentId)}/`,
      );
      return jsonResult({ ok: true, invoiceId, paymentId });
    },
  );
}
