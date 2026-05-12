import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { toCompositeGlobalId } from '../client/ids.js';
import { INVOICE_SEND_MUTATION } from './_mutations.js';
import { jsonResult } from './_helpers.js';

const InvoiceStatus = z.enum(['draft', 'unpaid', 'paid', 'overdue', 'partial']);
const InvoiceSort = z.enum([
  '-invoice_date',
  'invoice_date',
  '-due_date',
  'due_date',
  '-amount_due',
  'amount_due',
]);

const InvoiceItemInput = z.object({
  productId: z
    .number()
    .int()
    .positive()
    .describe('Wave integer product ID. From an existing invoice (`items[].product.id`) or the legacy products UI.'),
  name: z.string().min(1),
  description: z.string().default(''),
  incomeAccountId: z
    .number()
    .int()
    .positive()
    .describe('Integer income account ID. From an existing invoice (`items[].product.income_account.id`).'),
  quantity: z.number().default(1),
  price: z.string().regex(/^\d+(\.\d+)?$/).describe('Decimal as a string, e.g. "150.00".'),
  taxes: z.array(z.unknown()).default([]),
});

const CURRENCIES: Record<string, { symbol: string; name: string }> = {
  CAD: { symbol: '$', name: 'Canadian dollar' },
  USD: { symbol: '$', name: 'US dollar' },
  EUR: { symbol: '€', name: 'Euro' },
  GBP: { symbol: '£', name: 'British Pound' },
  AUD: { symbol: '$', name: 'Australian dollar' },
};

function currencyEnvelope(code: string): Record<string, unknown> {
  const meta = CURRENCIES[code] ?? { symbol: '', name: code };
  return {
    url: `https://api.waveapps.com/currencies/${code}/`,
    code,
    symbol: meta.symbol,
    name: meta.name,
    plural: null,
  };
}

function buildInvoiceBody(args: {
  customerId: number;
  items: ReadonlyArray<z.infer<typeof InvoiceItemInput>>;
  status: 'draft' | 'saved';
  invoiceNumber: string;
  poSoNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  exchangeRate: string;
  memo: string;
  footer: string;
  subhead: string;
  itemTitle: string;
  quantityTitle: string;
  priceTitle: string;
  amountTitle: string;
  invoiceNumberLabel: string;
}): Record<string, unknown> {
  return {
    amount_title: args.amountTitle,
    customer: { id: args.customerId },
    discounts: [],
    due_date: args.dueDate,
    exchange_rate: args.exchangeRate,
    footer: args.footer,
    hide_amount: false,
    hide_description: false,
    hide_item: false,
    hide_price: false,
    hide_quantity: false,
    invoice_currency: currencyEnvelope(args.currency),
    invoice_date: args.invoiceDate,
    invoice_number: args.invoiceNumber,
    invoice_number_label: args.invoiceNumberLabel,
    item_title: args.itemTitle,
    items: args.items.map((it) => ({
      description: it.description,
      price: it.price,
      product: {
        id: it.productId,
        income_account: { id: it.incomeAccountId },
        name: it.name,
      },
      quantity: it.quantity,
      taxes: it.taxes,
    })),
    memo: args.memo,
    po_so_number: args.poSoNumber,
    price_title: args.priceTitle,
    quantity_title: args.quantityTitle,
    require_terms_of_service_agreement: false,
    status: args.status,
    subhead: args.subhead,
    attachment_ids: [],
    tag_ids: [],
  };
}

export function registerInvoiceTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_list_invoices',
    {
      title: 'List Wave invoices',
      description:
        'Lists invoices for a Wave business. REST-backed (`/businesses/{id}/invoices/`). Supports status filtering, pagination, sort, customer embed.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        status: InvoiceStatus.optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(25),
        sort: InvoiceSort.default('-invoice_date'),
        embedCustomer: z.boolean().default(true),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, status, page, pageSize, sort, embedCustomer }) => {
      const id = client.businessId(businessId);
      const paged = await client.rest.getPaged<unknown>(`/businesses/${id}/invoices/`, {
        page,
        page_size: pageSize,
        sort,
        status,
        embed_customer: embedCustomer,
      });
      return jsonResult(paged);
    },
  );

  server.registerTool(
    'wave_get_invoice',
    {
      title: 'Get one Wave invoice',
      description:
        'Fetches a single invoice by ID, with customer/items/payments/taxes/attachments embedded. `invoiceId` is the long integer Wave returns on the list endpoint (e.g. 2520825210135910924).',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        invoiceId: z.string().min(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, invoiceId }) => {
      const id = client.businessId(businessId);
      const invoice = await client.rest.get<unknown>(
        `/businesses/${id}/invoices/${encodeURIComponent(invoiceId)}/`,
        {
          embed_accounts: true,
          embed_customer: true,
          embed_discounts: true,
          embed_items: true,
          embed_payments: true,
          embed_products: true,
          embed_sales_taxes: true,
          embed_attachments: true,
        },
      );
      return jsonResult({ invoice });
    },
  );

  server.registerTool(
    'wave_get_invoice_settings',
    {
      title: 'Get Wave invoice settings',
      description:
        'Returns the workspace-wide invoice settings (numbering, terms, branding) used as defaults on new invoices.',
      inputSchema: { businessId: z.string().uuid().optional() },
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
        'Creates an invoice via REST `POST /businesses/{id}/invoices/`. Saves as a draft by default. The customer + each item\'s product/income-account references are integer IDs from prior list calls.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        customerId: z.number().int().positive().describe('Integer customer ID.'),
        items: z.array(InvoiceItemInput).min(1),
        status: z.enum(['draft', 'saved']).default('draft').describe('"draft" leaves it unapproved; "saved" approves on create.'),
        invoiceNumber: z.string().optional().describe('Auto-incremented if omitted.'),
        poSoNumber: z.string().default(''),
        invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD. Defaults to today.'),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Defaults to 15 days after invoice date.'),
        currency: z.string().length(3).toUpperCase().default('CAD'),
        exchangeRate: z.string().default('1.0000000000'),
        memo: z.string().default(''),
        footer: z.string().default(''),
        subhead: z.string().default(''),
        itemTitle: z.string().default('Services'),
        quantityTitle: z.string().default('Hours'),
        priceTitle: z.string().default('Rate'),
        amountTitle: z.string().default('Amount'),
        invoiceNumberLabel: z.string().default('Invoice'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const id = client.businessId(args.businessId);
      const today = new Date().toISOString().slice(0, 10);
      const invoiceDate = args.invoiceDate ?? today;
      const dueDate = args.dueDate ?? addDays(invoiceDate, 15);
      const body = buildInvoiceBody({
        customerId: args.customerId,
        items: args.items,
        status: args.status,
        invoiceNumber: args.invoiceNumber ?? '',
        poSoNumber: args.poSoNumber,
        invoiceDate,
        dueDate,
        currency: args.currency,
        exchangeRate: args.exchangeRate,
        memo: args.memo,
        footer: args.footer,
        subhead: args.subhead,
        itemTitle: args.itemTitle,
        quantityTitle: args.quantityTitle,
        priceTitle: args.priceTitle,
        amountTitle: args.amountTitle,
        invoiceNumberLabel: args.invoiceNumberLabel,
      });
      // Wave auto-generates invoice_number when blank — drop it from the payload
      // so it doesn't overwrite the server-assigned next number.
      if (!args.invoiceNumber) delete (body as Record<string, unknown>)['invoice_number'];
      const invoice = await client.rest.post<unknown>(`/businesses/${id}/invoices/`, body);
      return jsonResult({ invoice });
    },
  );

  server.registerTool(
    'wave_update_invoice',
    {
      title: 'Update a Wave invoice',
      description:
        'Patches an invoice via REST `PATCH /businesses/{id}/invoices/{invoiceId}/`. Send the full intended state — Wave replaces the prior body. Use `wave_get_invoice` first to read the current state if you only want to change one field.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        invoiceId: z.string().min(1).describe('The long integer Wave invoice ID.'),
        customerId: z.number().int().positive(),
        items: z.array(InvoiceItemInput).min(1),
        status: z.enum(['draft', 'saved']).default('draft'),
        invoiceNumber: z.string(),
        poSoNumber: z.string().default(''),
        invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        currency: z.string().length(3).toUpperCase().default('CAD'),
        exchangeRate: z.string().default('1.0000000000'),
        memo: z.string().default(''),
        footer: z.string().default(''),
        subhead: z.string().default(''),
        itemTitle: z.string().default('Services'),
        quantityTitle: z.string().default('Hours'),
        priceTitle: z.string().default('Rate'),
        amountTitle: z.string().default('Amount'),
        invoiceNumberLabel: z.string().default('Invoice'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const id = client.businessId(args.businessId);
      const body = buildInvoiceBody(args);
      const invoice = await client.rest.patch<unknown>(
        `/businesses/${id}/invoices/${encodeURIComponent(args.invoiceId)}/`,
        body,
      );
      return jsonResult({ invoice });
    },
  );

  server.registerTool(
    'wave_approve_invoice',
    {
      title: 'Approve a Wave invoice draft',
      description:
        'Approves a draft invoice (status `draft` → `saved`). Wave\'s UI calls this "Approve draft" — required before the invoice can be sent. Implemented as REST PATCH `/invoices/{id}/` with `{"status":"saved"}`.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        invoiceId: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ businessId, invoiceId }) => {
      const id = client.businessId(businessId);
      const invoice = await client.rest.patch<unknown>(
        `/businesses/${id}/invoices/${encodeURIComponent(invoiceId)}/`,
        { status: 'saved' },
      );
      return jsonResult({ invoice });
    },
  );

  server.registerTool(
    'wave_mark_invoice_sent',
    {
      title: 'Mark a Wave invoice as sent (outside Wave)',
      description:
        'Flips an approved invoice\'s status to "Sent" without actually emailing through Wave. Use this when you delivered the invoice yourself (print + mail, attachment in another tool, etc.). REST PUT `/invoices/{id}/mark-sent/` with `{"sent_via":"marked_sent"}`.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        invoiceId: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ businessId, invoiceId }) => {
      const id = client.businessId(businessId);
      const result = await client.rest.put<unknown>(
        `/businesses/${id}/invoices/${encodeURIComponent(invoiceId)}/mark-sent/`,
        { sent_via: 'marked_sent' },
      );
      return jsonResult({ result });
    },
  );

  server.registerTool(
    'wave_send_invoice',
    {
      title: 'Send a Wave invoice by email',
      description:
        'Sends an approved invoice to one or more recipients via Wave\'s email service. The invoice must be in `saved` status first (run `wave_approve_invoice`). Backed by the GraphQL `invoiceSend` mutation.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        invoiceId: z
          .string()
          .min(1)
          .describe('Wave integer invoice ID (e.g. "2520832016585333081"). The tool encodes it as a Relay global ID for GraphQL.'),
        to: z
          .array(z.string().email())
          .min(1)
          .max(10)
          .describe('Recipient email addresses. At least one; Wave caps at ~10.'),
        subject: z.string().min(1),
        message: z.string().min(1),
        fromAddress: z
          .string()
          .email()
          .describe('Sender email. Must be a verified-sender address on your Wave account.'),
        ccMyself: z.boolean().default(true),
        attachPDF: z.boolean().default(true).describe('Embed the invoice as a PDF attachment.'),
        includeAttachments: z
          .boolean()
          .default(false)
          .describe('Include any extra files attached to the invoice (separate from the auto-generated PDF).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const businessUuid = client.businessId(args.businessId);
      const invoiceGlobalId = toCompositeGlobalId(businessUuid, 'Invoice', args.invoiceId);
      const data = await client.gql.execute<{
        invoiceSend: {
          didSucceed: boolean;
          inputErrors?: ReadonlyArray<{ path?: ReadonlyArray<string | number>; message: string; code?: string }> | null;
        };
      }>({
        operationName: 'InvoiceSend',
        query: INVOICE_SEND_MUTATION,
        variables: {
          input: {
            invoiceId: invoiceGlobalId,
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
      return jsonResult(data.invoiceSend);
    },
  );

  server.registerTool(
    'wave_list_accounts',
    {
      title: 'List Wave chart-of-accounts entries',
      description:
        'Lists active accounts in the chart of accounts. Use this to find the integer `id` to pass as `paymentAccountId` when recording an invoice payment (look for accounts of type "Cash on Hand", "Wave Payments", or a connected bank account).',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        activeOnly: z.boolean().default(true),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, activeOnly }) => {
      const id = client.businessId(businessId);
      const accounts = await client.rest.get<unknown>(`/businesses/${id}/accounts/`, {
        active_only: activeOnly,
      });
      return jsonResult({ accounts });
    },
  );

  server.registerTool(
    'wave_record_invoice_payment',
    {
      title: 'Record a payment against a Wave invoice',
      description:
        'Records a manual payment (cash / cheque / bank transfer / etc.) against an approved invoice. REST POST `/invoices/{id}/payments/`. Pulls the invoice toward `paid` status. The invoice must already be approved (status `saved` or later).',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        invoiceId: z.string().min(1).describe('The long integer Wave invoice ID.'),
        amount: z.number().positive().describe('Decimal dollar amount. e.g. 5 or 1429.13.'),
        paymentDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('YYYY-MM-DD. Defaults to today.'),
        paymentMethod: z
          .enum(['bank_transfer', 'cash', 'cheque', 'credit_card', 'paypal', 'other'])
          .default('bank_transfer')
          .describe('UI labels map: Bank payment → bank_transfer, Cash → cash, Cheque → cheque, Credit card → credit_card, PayPal → paypal, Other → other.'),
        paymentAccountId: z
          .number()
          .int()
          .positive()
          .describe('Integer account ID from `wave_list_accounts`. Common picks: "Cash on Hand", "Wave Payments", a connected bank account.'),
        exchangeRate: z.number().default(1),
        memo: z.string().nullish(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const id = client.businessId(args.businessId);
      const today = new Date().toISOString().slice(0, 10);
      const payment = await client.rest.post<unknown>(
        `/businesses/${id}/invoices/${encodeURIComponent(args.invoiceId)}/payments/`,
        {
          amount: args.amount,
          exchange_rate: args.exchangeRate,
          memo: args.memo ?? null,
          payment_account: { id: args.paymentAccountId },
          payment_date: args.paymentDate ?? today,
          payment_method: args.paymentMethod,
        },
      );
      return jsonResult({ payment });
    },
  );

  server.registerTool(
    'wave_delete_invoice_payment',
    {
      title: 'Remove a payment from a Wave invoice',
      description:
        'Removes a recorded payment from an invoice. REST DELETE `/invoices/{invoiceId}/payments/{paymentId}/`. Returns 204. The invoice\'s status will recompute (`paid` → `unpaid`/`partial`).',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        invoiceId: z.string().min(1),
        paymentId: z.string().min(1).describe('Long integer payment ID from the payment record (or from `wave_get_invoice` → payments embed).'),
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

  server.registerTool(
    'wave_delete_invoice',
    {
      title: 'Delete a Wave invoice',
      description:
        'Deletes an invoice via REST `DELETE /businesses/{id}/invoices/{invoiceId}/`. Returns 204 No Content on success. Only drafts and unsent invoices should be deleted.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        invoiceId: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ businessId, invoiceId }) => {
      const id = client.businessId(businessId);
      await client.rest.delete(`/businesses/${id}/invoices/${encodeURIComponent(invoiceId)}/`);
      return jsonResult({ ok: true, invoiceId });
    },
  );
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
