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
    require_terms_of_service_agreement: false,
    status: args.status,
    subhead: args.subhead,
    attachment_ids: [],
    tag_ids: [],
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

/** The arguments that would recreate `inv` as it stands, for a partial update to overlay. */
export function bodyArgsFromInvoice(inv: InvoiceDetail): InvoiceBodyArgs {
  const need = <T>(value: T | null | undefined, what: string): T => {
    if (value === null || value === undefined) throw new Error(`The invoice on Wave has no ${what}; pass it explicitly.`);
    return value;
  };
  return {
    customerId: need(inv.customer?.id, 'customer id'),
    items: inv.items.map((it, i) => ({
      productId: need(it.product.id, `product id on line ${i + 1}`),
      name: need(it.product.name, `product name on line ${i + 1}`),
      description: it.description ?? '',
      incomeAccountId: need(it.product.income_account?.id, `income account on line ${i + 1}`),
      quantity: it.quantity ?? 1,
      price: String(need(it.price, `price on line ${i + 1}`)),
      taxes: it.taxes.map((t, j) => need(t.sales_tax.id, `sales tax id on line ${i + 1}, tax ${j + 1}`)),
    })),
    status: inv.status === 'draft' ? 'draft' : 'saved',
    invoiceNumber: inv.invoice_number ?? undefined,
    poSoNumber: inv.po_so_number ?? '',
    invoiceDate: need(inv.invoice_date, 'invoice date'),
    dueDate: need(inv.due_date, 'due date'),
    currency: need(inv.currency, 'currency'),
    exchangeRate: String(inv.exchange_rate ?? 1),
    memo: inv.memo ?? '',
    footer: inv.footer ?? '',
    subhead: inv.subhead ?? '',
    itemTitle: inv.item_title ?? 'Items',
    quantityTitle: inv.quantity_title ?? 'Quantity',
    priceTitle: inv.price_title ?? 'Price',
    amountTitle: inv.amount_title ?? 'Amount',
    invoiceNumberLabel: inv.invoice_number_label ?? 'Invoice',
  };
}
