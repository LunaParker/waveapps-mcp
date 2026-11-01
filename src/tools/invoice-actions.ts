import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { requireDidSucceed, type WaveInputError } from '../client/errors.js';
import { fromCompositeGlobalId, toCompositeGlobalId } from '../client/ids.js';
import {
  DUPLICATE_INVOICE_MUTATION,
  INVOICE_PDF_MUTATION,
  INVOICE_REMINDER_MUTATION,
  PAYMENT_RECEIPT_MUTATION,
} from './_mutations.js';
import { jsonResult } from './_helpers.js';
import { downloadPdf, pdfResult } from './_pdf.js';

const invoiceId = z
  .string()
  .regex(/^\d+$/)
  .describe('Integer invoice id (as a string) from wave_list_invoices or wave_get_invoice.');

interface Payload {
  didSucceed: boolean;
  inputErrors?: ReadonlyArray<WaveInputError> | null;
  invoice?: { id?: string | null; invoiceNumber?: string | null; status?: string | null } | null;
  pdfUrl?: string | null;
}

/** Email fields Wave's reminder and receipt inputs share; only the ones given are sent. */
const emailFields = {
  to: z.array(z.email()).min(1).max(10).describe("Recipients, usually the customer's email."),
  subject: z.string().min(1).optional().describe("Defaults to Wave's email template."),
  message: z.string().optional(),
  fromAddress: z.email().optional().describe('A verified `invoice_sending_emails` address from wave_get_business; Wave picks its default when left out.'),
  ccMyself: z.boolean().default(false),
};

function emailInput(args: { to: string[]; subject?: string | undefined; message?: string | undefined; fromAddress?: string | undefined; ccMyself: boolean }): Record<string, unknown> {
  const input: Record<string, unknown> = { to: args.to, ccMyself: args.ccMyself };
  if (args.subject !== undefined) input['subject'] = args.subject;
  if (args.message !== undefined) input['message'] = args.message;
  if (args.fromAddress !== undefined) input['fromAddress'] = args.fromAddress;
  return input;
}

export function registerInvoiceActionTools(server: McpServer, client: WaveClient): void {
  const mutate = async (operationName: string, query: string, field: string, input: Record<string, unknown>): Promise<Payload> => {
    const data = await client.gql.execute<Record<string, Payload>>({ operationName, query, variables: { input } });
    return requireDidSucceed(operationName, data[field]);
  };
  const relay = (businessId: string | undefined, id: string): string => toCompositeGlobalId(client.businessId(businessId), 'Invoice', id);

  server.registerTool(
    'wave_get_invoice_pdf',
    {
      title: "Get a Wave invoice's PDF",
      description:
        "Renders the invoice as Wave's PDF and returns the file itself as an embedded application/pdf resource, plus a download link that expires after a short while. Files over 10 MB come back as the link only.",
      inputSchema: { businessId: z.uuid().optional(), invoiceId },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const payload = await mutate('GenerateInvoicePdf', INVOICE_PDF_MUTATION, 'invoiceGeneratePdf', { invoiceId: relay(args.businessId, args.invoiceId) });
      if (!payload.pdfUrl) throw new Error('Wave generated no PDF link for this invoice.');
      const file = await downloadPdf(payload.pdfUrl, `invoice-${args.invoiceId}.pdf`);
      return pdfResult(file, { invoiceId: args.invoiceId });
    },
  );

  server.registerTool(
    'wave_duplicate_invoice',
    {
      title: 'Duplicate a Wave invoice',
      description: 'Copies an invoice, with its customer and line items, into a new draft with the next invoice number. Returns the new `invoiceId`.',
      inputSchema: { businessId: z.uuid().optional(), invoiceId },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const payload = await mutate('DuplicateInvoice', DUPLICATE_INVOICE_MUTATION, 'invoiceClone', { invoiceId: relay(args.businessId, args.invoiceId) });
      const copyId = payload.invoice?.id ?? null;
      let newId: string | null = null;
      if (copyId) {
        try {
          newId = fromCompositeGlobalId(copyId).internalId;
        } catch {
          newId = null;
        }
      }
      return jsonResult({ invoiceId: newId, invoiceNumber: payload.invoice?.invoiceNumber ?? null, status: payload.invoice?.status ?? null, copiedFrom: args.invoiceId });
    },
  );

  server.registerTool(
    'wave_send_invoice_reminder',
    {
      title: 'Send a Wave invoice reminder',
      description:
        'Emails a payment reminder for an approved, unpaid invoice. This cannot be undone; confirm the recipients with the user first.',
      inputSchema: { businessId: z.uuid().optional(), invoiceId, ...emailFields },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      await mutate('SendInvoiceReminder', INVOICE_REMINDER_MUTATION, 'invoiceReminderCreate', {
        invoiceId: relay(args.businessId, args.invoiceId),
        ...emailInput(args),
      });
      return jsonResult({ ok: true, invoiceId: args.invoiceId, to: args.to });
    },
  );

  server.registerTool(
    'wave_send_payment_receipt',
    {
      title: 'Send a Wave payment receipt',
      description:
        "Emails the receipt for one payment on an invoice. `paymentId` is `payments[].id` on wave_get_invoice. This cannot be undone; confirm the recipients with the user first.",
      inputSchema: {
        businessId: z.uuid().optional(),
        invoiceId,
        paymentId: z.string().regex(/^\d+$/).describe('Integer payment id (as a string): `payments[].id` on wave_get_invoice.'),
        ...emailFields,
        attachPdf: z.boolean().default(false).describe('Attach the invoice PDF too.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const business = client.businessId(args.businessId);
      await mutate('SendPaymentReceipt', PAYMENT_RECEIPT_MUTATION, 'invoicePaymentReceiptSend', {
        invoiceId: toCompositeGlobalId(business, 'Invoice', args.invoiceId),
        invoicePaymentId: toCompositeGlobalId(business, 'InvoicePayment', args.paymentId),
        ...emailInput(args),
        attachPdf: args.attachPdf,
      });
      return jsonResult({ ok: true, invoiceId: args.invoiceId, paymentId: args.paymentId, to: args.to });
    },
  );
}
