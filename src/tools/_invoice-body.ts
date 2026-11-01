import { z } from 'zod';
import type { InvoiceDetail } from './_shape.js';

export const InvoiceItemInput = z.object({
  productId: z
    .number()
    .int()
    .positive()
    .describe('Integer product id: `items[].product.id` on wave_get_invoice, or `id` from wave_list_products.'),
  name: z.string().min(1).describe('Line label shown on the invoice. Usually the product name.'),
  description: z.string().default(''),
  incomeAccountId: z
    .number()
    .int()
    .positive()
    .describe('Integer income account id: `items[].product.income_account.id` on wave_get_invoice, or an `account_type: "income"` account from wave_list_accounts.'),
  quantity: z.number().default(1),
  price: z.string().regex(/^\d+(\.\d+)?$/).describe('Unit price as a decimal string, e.g. "150.00".'),
  taxes: z
    .array(z.number().int().positive())
    .default([])
    .describe('Integer sales-tax ids to apply to this line: `items[].taxes[].sales_tax.id` on wave_get_invoice. Empty for no tax.'),
});
export type InvoiceItemArgs = z.infer<typeof InvoiceItemInput>;

export interface InvoiceBodyArgs {
  customerId: number;
  items: ReadonlyArray<InvoiceItemArgs>;
  status: 'draft' | 'saved';
  /** Left out of the body when blank so Wave assigns the next number. */
  invoiceNumber?: string | undefined;
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
  /** Stored fields a partial update carries over. Wave treats a missing or empty key as "clear it". */
  carry?: CarriedInvoiceFields | undefined;
}

export interface CarriedInvoiceFields {
  discounts: unknown[];
  attachmentIds: unknown[];
  tagIds: unknown[];
  hideItem: boolean;
  hideDescription: boolean;
  hideQuantity: boolean;
  hidePrice: boolean;
  hideAmount: boolean;
  requireTermsOfServiceAgreement: boolean;
}

/** Everything buildInvoiceBody would otherwise reset, read from Wave's raw invoice record. */
export function carriedFromRawInvoice(raw: unknown): CarriedInvoiceFields {
  const r = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const flag = (v: unknown): boolean => v === true;
  return {
    discounts: list(r['discounts']),
    attachmentIds: list(r['attachments'])
      .map((a) => (a !== null && typeof a === 'object' ? (a as Record<string, unknown>)['id'] : a))
      .filter((id) => id !== undefined && id !== null),
    tagIds: list(r['tag_ids']),
    hideItem: flag(r['hide_item']),
    hideDescription: flag(r['hide_description']),
    hideQuantity: flag(r['hide_quantity']),
    hidePrice: flag(r['hide_price']),
    hideAmount: flag(r['hide_amount']),
    requireTermsOfServiceAgreement: flag(r['require_terms_of_service_agreement']),
  };
}

const CURRENCIES: Record<string, { symbol: string; name: string }> = {
  CAD: { symbol: '$', name: 'Canadian dollar' },
  USD: { symbol: '$', name: 'US dollar' },
  EUR: { symbol: '€', name: 'Euro' },
  GBP: { symbol: '£', name: 'British Pound' },
  AUD: { symbol: '$', name: 'Australian dollar' },
};

/** Wave's REST body wants the whole currency record, not just the code. */
export function currencyEnvelope(code: string): Record<string, unknown> {
  const meta = CURRENCIES[code] ?? { symbol: '', name: code };
  return {
    url: `https://api.waveapps.com/currencies/${code}/`,
    code,
    symbol: meta.symbol,
    name: meta.name,
    plural: null,
  };
}

export function buildInvoiceBody(args: InvoiceBodyArgs): Record<string, unknown> {
  const body: Record<string, unknown> = {
    amount_title: args.amountTitle,
    customer: { id: args.customerId },
    discounts: args.carry?.discounts ?? [],
    due_date: args.dueDate,
    exchange_rate: args.exchangeRate,
    footer: args.footer,
    hide_amount: args.carry?.hideAmount ?? false,
    hide_description: args.carry?.hideDescription ?? false,
    hide_item: args.carry?.hideItem ?? false,
    hide_price: args.carry?.hidePrice ?? false,
    hide_quantity: args.carry?.hideQuantity ?? false,
    invoice_currency: currencyEnvelope(args.currency),
    invoice_date: args.invoiceDate,
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
      // Wave rejects bare integers here ("Expected a dictionary, but got int").
      taxes: it.taxes.map((id) => ({ sales_tax: { id } })),
    })),
    memo: args.memo,
    po_so_number: args.poSoNumber,
    price_title: args.priceTitle,
    quantity_title: args.quantityTitle,
    require_terms_of_service_agreement: args.carry?.requireTermsOfServiceAgreement ?? false,
    status: args.status,
    subhead: args.subhead,
    attachment_ids: args.carry?.attachmentIds ?? [],
    tag_ids: args.carry?.tagIds ?? [],
  };
  if (args.invoiceNumber) body['invoice_number'] = args.invoiceNumber;
  return body;
}

const BODY_FIELDS: ReadonlyArray<keyof InvoiceBodyArgs> = [
  'customerId', 'items', 'status', 'invoiceNumber', 'poSoNumber', 'invoiceDate', 'dueDate', 'currency', 'exchangeRate',
  'memo', 'footer', 'subhead', 'itemTitle', 'quantityTitle', 'priceTitle', 'amountTitle', 'invoiceNumberLabel',
];

/** True when the caller supplied every field Wave's PATCH replaces, so no read is needed first. */
export function hasFullState(a: Partial<InvoiceBodyArgs>): a is InvoiceBodyArgs {
  return BODY_FIELDS.every((k) => a[k] !== undefined);
}

/** The arguments that would recreate `inv` as it stands, with `changes` overlaid. Fields the caller supplied are never read from the stored invoice, so a gap there cannot block the update. */
export function bodyArgsFromInvoice(inv: InvoiceDetail, changes: Partial<InvoiceBodyArgs> = {}): InvoiceBodyArgs {
  const need = <T>(value: T | null | undefined, what: string): T => {
    if (value === null || value === undefined) throw new Error(`The invoice on Wave has no ${what}; pass it explicitly.`);
    return value;
  };
  const storedItems = (): InvoiceItemArgs[] => {
    if (inv.items.length === 0) throw new Error('The invoice on Wave has no line items; pass items explicitly.');
    return inv.items.map((it, i) => ({
      productId: need(it.product.id, `product id on line ${i + 1}`),
      name: need(it.product.name, `product name on line ${i + 1}`),
      description: it.description ?? '',
      incomeAccountId: need(it.account_id ?? it.product.income_account?.id, `income account on line ${i + 1}`),
      quantity: need(it.quantity, `quantity on line ${i + 1}`),
      price: String(need(it.price, `price on line ${i + 1}`)),
      taxes: it.taxes.map((t, j) => need(t.sales_tax.id, `sales tax id on line ${i + 1}, tax ${j + 1}`)),
    }));
  };
  return {
    customerId: changes.customerId ?? need(inv.customer?.id, 'customer id'),
    items: changes.items ?? storedItems(),
    status: changes.status ?? (need(inv.status, 'status') === 'draft' ? 'draft' : 'saved'),
    invoiceNumber: changes.invoiceNumber ?? inv.invoice_number ?? undefined,
    poSoNumber: changes.poSoNumber ?? inv.po_so_number ?? '',
    invoiceDate: changes.invoiceDate ?? need(inv.invoice_date, 'invoice date'),
    dueDate: changes.dueDate ?? need(inv.due_date, 'due date'),
    currency: changes.currency ?? need(inv.currency, 'currency'),
    exchangeRate: changes.exchangeRate ?? String(need(inv.exchange_rate, 'exchange rate')),
    memo: changes.memo ?? inv.memo ?? '',
    footer: changes.footer ?? inv.footer ?? '',
    subhead: changes.subhead ?? inv.subhead ?? '',
    itemTitle: changes.itemTitle ?? inv.item_title ?? 'Items',
    quantityTitle: changes.quantityTitle ?? inv.quantity_title ?? 'Quantity',
    priceTitle: changes.priceTitle ?? inv.price_title ?? 'Price',
    amountTitle: changes.amountTitle ?? inv.amount_title ?? 'Amount',
    invoiceNumberLabel: changes.invoiceNumberLabel ?? inv.invoice_number_label ?? 'Invoice',
  };
}
