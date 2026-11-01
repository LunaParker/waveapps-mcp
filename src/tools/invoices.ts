import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { requireDidSucceed } from '../client/errors.js';
import { toCompositeGlobalId } from '../client/ids.js';
import { addDays, todayIso } from '../util/dates.js';
import { INVOICE_SEND_MUTATION } from './_mutations.js';
import { jsonResult } from './_helpers.js';
import { InvoiceItemInput, bodyArgsFromInvoice, buildInvoiceBody, hasFullState, type InvoiceBodyArgs } from './_invoice-body.js';
import { looksLikeInvoice, shapeBusiness, shapeInvoice, shapeInvoiceSummary } from './_shape.js';

const InvoiceStatus = z.enum(['draft', 'unpaid', 'paid', 'overdue', 'partial']);
const InvoiceSort = z.enum(['-invoice_date', 'invoice_date', '-due_date', 'due_date', '-amount_due', 'amount_due']);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Currency = z.string().length(3).toUpperCase();
const InvoiceLifecycle = z.enum(['draft', 'saved']);

const INVOICE_EMBEDS = {
  embed_accounts: true,
  embed_customer: true,
  embed_discounts: true,
  embed_items: true,
  embed_payments: true,
  embed_products: true,
  embed_sales_taxes: true,
  embed_attachments: true,
} as const;

/** Presentation fields a caller may leave out; the workspace's invoice settings fill them. */
const presentationInputs = {
  memo: z.string().optional().describe('Defaults to the workspace standard memo.'),
  footer: z.string().optional().describe('Defaults to the workspace default footer.'),
  subhead: z.string().optional().describe('Defaults to the workspace default subheading.'),
  itemTitle: z.string().optional().describe('Column heading for line names. Defaults to the workspace setting.'),
  quantityTitle: z.string().optional().describe('Column heading for quantities. Defaults to the workspace setting.'),
  priceTitle: z.string().optional().describe('Column heading for unit prices. Defaults to the workspace setting.'),
  amountTitle: z.string().optional().describe('Column heading for line totals. Defaults to the workspace setting.'),
  invoiceNumberLabel: z.string().optional().describe('Label before the number, e.g. "Invoice". Defaults to the workspace setting.'),
};

interface InvoiceDefaults {
  paymentTermsDays: number;
  memo: string;
  footer: string;
  subhead: string;
  itemTitle: string;
  quantityTitle: string;
  priceTitle: string;
  amountTitle: string;
  invoiceNumberLabel: string;
}

function defaultsFromSettings(settings: unknown): InvoiceDefaults {
  const s = (settings !== null && typeof settings === 'object' ? settings : {}) as Record<string, unknown>;
  const text = (v: unknown, fallback: string): string => (typeof v === 'string' && v.length > 0 ? v : fallback);
  return {
    paymentTermsDays: typeof s['default_payment_terms'] === 'number' ? s['default_payment_terms'] : 15,
    memo: text(s['standard_memo'], ''),
    footer: text(s['default_footer'], ''),
    subhead: text(s['default_subheading'], ''),
    itemTitle: text(s['default_item_title'], 'Items'),
    quantityTitle: text(s['default_quantity_title'], 'Quantity'),
    priceTitle: text(s['default_price_title'], 'Price'),
    amountTitle: text(s['default_amount_title'], 'Amount'),
    invoiceNumberLabel: text(s['default_title'], 'Invoice'),
  };
}

function invoicePath(businessId: string, invoiceId: string): string {
  return `/businesses/${businessId}/invoices/${encodeURIComponent(invoiceId)}/`;
}

export function registerInvoiceTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_list_invoices',
    {
      title: 'List Wave invoices',
      description:
        'Lists invoices with their status, dates, totals and customer. Filter by status, page and sort. Each row\'s `id` is what the other invoice tools take as `invoiceId`; call wave_get_invoice for line items and payments.',
      inputSchema: {
        businessId: z.uuid().optional(),
        status: InvoiceStatus.optional().describe('draft, unpaid, paid, overdue or partial. Omit for all.'),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(25),
        sort: InvoiceSort.default('-invoice_date').describe('A leading "-" sorts descending.'),
        raw: z.boolean().default(false).describe('Return Wave\'s full records instead of the trimmed rows. Large.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, status, page, pageSize, sort, raw }) => {
      const id = client.businessId(businessId);
      const paged = await client.rest.getPaged<unknown>(`/businesses/${id}/invoices/`, {
        page,
        page_size: pageSize,
        sort,
        status,
        embed_customer: true,
      });
      if (raw) return jsonResult(paged);
      return jsonResult({ items: paged.items.map(shapeInvoiceSummary), meta: paged.meta });
    },
  );

  server.registerTool(
    'wave_get_invoice',
    {
      title: 'Get one Wave invoice',
      description:
        'Fetches one invoice with its line items, taxes, payments and customer. Use it before wave_update_invoice, and to find `items[].product.id`, `items[].product.income_account.id`, `items[].taxes[].sales_tax.id` and `payments[].id`.',
      inputSchema: {
        businessId: z.uuid().optional(),
        invoiceId: z.string().min(1).describe('Invoice `id` from wave_list_invoices.'),
        raw: z.boolean().default(false).describe('Return Wave\'s full record instead of the trimmed one. Large.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, invoiceId, raw }) => {
      const id = client.businessId(businessId);
      const invoice = await client.rest.get<unknown>(invoicePath(id, invoiceId), INVOICE_EMBEDS);
      return jsonResult({ invoice: raw ? invoice : shapeInvoice(invoice) });
    },
  );

  server.registerTool(
    'wave_get_invoice_settings',
    {
      title: 'Get Wave invoice settings',
      description:
        'Returns the workspace-wide invoice settings: default payment terms (days), column headings, footer, memo and reminder settings. wave_create_invoice uses these as its defaults.',
      inputSchema: { businessId: z.uuid().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId }) => {
      const id = client.businessId(businessId);
      const settings = await client.rest.get<unknown>(`/businesses/${id}/invoices/settings/`);
      return jsonResult({ settings });
    },
  );

  server.registerTool(
    'wave_create_invoice',
    {
      title: 'Create a Wave invoice',
      description:
        'Creates an invoice, as an unapproved draft unless `status` is "saved". Needs the customer\'s integer id (wave_list_customers `internalId`) and at least one line. Anything you leave out follows the workspace: currency, payment terms, column headings, footer and memo come from wave_get_business and wave_get_invoice_settings; the number is Wave\'s next one.',
      inputSchema: {
        businessId: z.uuid().optional(),
        customerId: z.number().int().positive().describe('Integer customer id: `internalId` from wave_list_customers.'),
        items: z.array(InvoiceItemInput).min(1),
        status: InvoiceLifecycle.default('draft').describe('"draft" leaves it unapproved; "saved" approves it on create.'),
        invoiceNumber: z.string().optional().describe('Defaults to the next number in the workspace.'),
        poSoNumber: z.string().default(''),
        invoiceDate: IsoDate.optional().describe('YYYY-MM-DD. Defaults to today.'),
        dueDate: IsoDate.optional().describe('YYYY-MM-DD. Defaults to the invoice date plus the workspace payment terms.'),
        currency: Currency.optional().describe('ISO 4217 code. Defaults to the business currency.'),
        exchangeRate: z.string().default('1.0000000000'),
        ...presentationInputs,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const id = client.businessId(args.businessId);
      const needsSettings = [args.dueDate, args.memo, args.footer, args.subhead, args.itemTitle, args.quantityTitle, args.priceTitle, args.amountTitle, args.invoiceNumberLabel].some((v) => v === undefined);
      const [settings, business] = await Promise.all([
        needsSettings ? client.rest.get<unknown>(`/businesses/${id}/invoices/settings/`) : undefined,
        args.currency === undefined ? client.rest.get<unknown>(`/businesses/${id}/`) : undefined,
      ]);
      const d = defaultsFromSettings(settings);
      const invoiceDate = args.invoiceDate ?? todayIso();
      const body = buildInvoiceBody({
        customerId: args.customerId,
        items: args.items,
        status: args.status,
        invoiceNumber: args.invoiceNumber,
        poSoNumber: args.poSoNumber,
        invoiceDate,
        dueDate: args.dueDate ?? addDays(invoiceDate, d.paymentTermsDays),
        currency: args.currency ?? shapeBusiness(business).currency ?? 'USD',
        exchangeRate: args.exchangeRate,
        memo: args.memo ?? d.memo,
        footer: args.footer ?? d.footer,
        subhead: args.subhead ?? d.subhead,
        itemTitle: args.itemTitle ?? d.itemTitle,
        quantityTitle: args.quantityTitle ?? d.quantityTitle,
        priceTitle: args.priceTitle ?? d.priceTitle,
        amountTitle: args.amountTitle ?? d.amountTitle,
        invoiceNumberLabel: args.invoiceNumberLabel ?? d.invoiceNumberLabel,
      });
      const invoice = await client.rest.post<unknown>(`/businesses/${id}/invoices/`, body);
      return jsonResult({ invoice: shapeInvoice(invoice) });
    },
  );

  server.registerTool(
    'wave_update_invoice',
    {
      title: 'Update a Wave invoice',
      description:
        'Changes an invoice. Pass only the fields to change: the tool reads the current invoice and keeps everything else, including line items and approval state. To change lines, pass the complete new `items` list. Pass `status: "draft"` to unapprove or "saved" to approve.',
      inputSchema: {
        businessId: z.uuid().optional(),
        invoiceId: z.string().min(1).describe('Invoice `id` from wave_list_invoices.'),
        customerId: z.number().int().positive().optional().describe('Integer customer id: `internalId` from wave_list_customers.'),
        items: z.array(InvoiceItemInput).min(1).optional().describe('The complete list of lines the invoice should have.'),
        status: InvoiceLifecycle.optional().describe('Omit to keep the current approval state.'),
        invoiceNumber: z.string().optional(),
        poSoNumber: z.string().optional(),
        invoiceDate: IsoDate.optional(),
        dueDate: IsoDate.optional(),
        currency: Currency.optional(),
        exchangeRate: z.string().optional(),
        ...presentationInputs,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ businessId, invoiceId, ...supplied }) => {
      const id = client.businessId(businessId);
      const path = invoicePath(id, invoiceId);
      const changes = definedOnly(supplied);
      const merged: InvoiceBodyArgs = hasFullState(changes)
        ? changes
        : { ...bodyArgsFromInvoice(shapeInvoice(await client.rest.get<unknown>(path, INVOICE_EMBEDS))), ...changes };
      const invoice = await client.rest.patch<unknown>(path, buildInvoiceBody(merged));
      return jsonResult({ invoice: shapeInvoice(invoice) });
    },
  );

  server.registerTool(
    'wave_approve_invoice',
    {
      title: 'Approve a Wave invoice draft',
      description:
        'Approves a draft so it can be sent or paid (Wave\'s "Approve draft"). Returns the invoice; its status moves from `draft` to `unpaid`.',
      inputSchema: {
        businessId: z.uuid().optional(),
        invoiceId: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ businessId, invoiceId }) => {
      const id = client.businessId(businessId);
      const invoice = await client.rest.patch<unknown>(invoicePath(id, invoiceId), { status: 'saved' });
      return jsonResult({ invoice: shapeInvoice(invoice) });
    },
  );

  server.registerTool(
    'wave_mark_invoice_sent',
    {
      title: 'Mark a Wave invoice as sent (outside Wave)',
      description:
        'Records that an approved invoice was delivered some other way (printed, attached elsewhere) without emailing it through Wave. Use wave_send_invoice to actually email it.',
      inputSchema: {
        businessId: z.uuid().optional(),
        invoiceId: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ businessId, invoiceId }) => {
      const id = client.businessId(businessId);
      const result = await client.rest.put<unknown>(`${invoicePath(id, invoiceId)}mark-sent/`, { sent_via: 'marked_sent' });
      return jsonResult(looksLikeInvoice(result) ? { invoice: shapeInvoice(result) } : { result });
    },
  );

  server.registerTool(
    'wave_send_invoice',
    {
      title: 'Send a Wave invoice by email',
      description:
        'Emails an approved invoice to the recipients through Wave. This cannot be undone; confirm the recipients and the sender with the user first. The invoice must be approved (wave_approve_invoice). `fromAddress` must be one of the verified `invoice_sending_emails` on wave_get_business.',
      inputSchema: {
        businessId: z.uuid().optional(),
        invoiceId: z.string().min(1).describe('Invoice `id` from wave_list_invoices.'),
        to: z.array(z.email()).min(1).max(10).describe('Recipient email addresses, up to 10.'),
        subject: z.string().min(1),
        message: z.string().min(1),
        fromAddress: z.email().describe('A verified sender from wave_get_business `invoice_sending_emails`.'),
        ccMyself: z.boolean().default(true),
        attachPDF: z.boolean().default(true).describe('Attach the invoice PDF.'),
        includeAttachments: z.boolean().default(false).describe('Also attach any files attached to the invoice.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const businessUuid = client.businessId(args.businessId);
      const data = await client.gql.execute<{
        invoiceSend: {
          didSucceed: boolean;
          inputErrors?: ReadonlyArray<{ path?: ReadonlyArray<string | number> | null; message: string; code?: string | null }> | null;
        };
      }>({
        operationName: 'InvoiceSend',
        query: INVOICE_SEND_MUTATION,
        variables: {
          input: {
            invoiceId: toCompositeGlobalId(businessUuid, 'Invoice', args.invoiceId),
            to: args.to,
            subject: args.subject,
            message: args.message,
            attachPDF: args.attachPDF,
            fromAddress: args.fromAddress,
            ccMyself: args.ccMyself,
            includeAttachments: args.includeAttachments,
          },
        },
      });
      requireDidSucceed('InvoiceSend', data.invoiceSend);
      return jsonResult({ sent: true, invoiceId: args.invoiceId, to: args.to });
    },
  );

  server.registerTool(
    'wave_delete_invoice',
    {
      title: 'Delete a Wave invoice',
      description: 'Deletes an invoice permanently. Only drafts and unsent invoices should be deleted; confirm with the user first.',
      inputSchema: {
        businessId: z.uuid().optional(),
        invoiceId: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ businessId, invoiceId }) => {
      const id = client.businessId(businessId);
      await client.rest.delete(invoicePath(id, invoiceId));
      return jsonResult({ ok: true, invoiceId });
    },
  );
}

/** Drop undefined entries so a spread cannot overwrite a read value with "not supplied". */
function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
