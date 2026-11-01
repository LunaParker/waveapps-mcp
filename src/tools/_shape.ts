// Output shapes for tool results. Pure functions over Wave's raw payloads: a missing scalar
// becomes null and a missing list becomes [], so a schema change on Wave's side degrades quietly.
import { fromCompositeGlobalId } from '../client/ids.js';

type Raw = Record<string, unknown>;

export interface CustomerRef { id: number | null; name: string | null; email: string | null }
export interface AccountRef { id: number | null; name: string | null }
export interface SalesTaxRef { id: number | null; name: string | null; abbreviation: string | null; rate: number | null }

export interface InvoiceSummary {
  id: string | null;
  invoice_number: string | null;
  status: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string | null;
  invoice_total: number | null;
  invoice_tax_total: number | null;
  invoice_discount_total: number | null;
  invoice_amount_paid: number | null;
  invoice_amount_due: number | null;
  last_payment_date: string | null;
  last_sent: string | null;
  last_sent_via: string | null;
  last_viewed: string | null;
  memo: string | null;
  po_so_number: string | null;
  pdf_url: string | null;
  public_url: string | null;
  customer: CustomerRef | null;
}

export interface InvoiceItem {
  id: number | null;
  description: string | null;
  quantity: number | null;
  price: number | null;
  account_id: number | null;
  product: { id: number | null; name: string | null; income_account: AccountRef | null };
  taxes: Array<{ id: number | null; amount: number | null; sales_tax: SalesTaxRef }>;
}

export interface InvoicePayment {
  id: string | null;
  payment_date: string | null;
  amount: number | null;
  payment_method: string | null;
  memo: string | null;
  exchange_rate: number | null;
  payment_account: AccountRef | null;
}

export interface InvoiceDetail extends InvoiceSummary {
  exchange_rate: number | null;
  subhead: string | null;
  footer: string | null;
  invoice_number_label: string | null;
  item_title: string | null;
  quantity_title: string | null;
  price_title: string | null;
  amount_title: string | null;
  items: InvoiceItem[];
  payments: InvoicePayment[];
  discounts: unknown[];
  attachments: unknown[];
}

export interface BusinessSummary {
  id: string | null;
  company_name: string | null;
  currency: string | null;
  country: string | null;
  timezone_id: string | null;
  is_personal: boolean | null;
  is_default_business: boolean | null;
  is_owner: boolean | null;
  is_admin: boolean | null;
  invoice_sending_emails: Array<{ email: string | null; default: boolean | null; verified: boolean | null }>;
}

export interface ProductSummary {
  id: number | null;
  name: string | null;
  description: string | null;
  price: number | null;
  active: boolean | null;
  is_sold: boolean | null;
  is_bought: boolean | null;
  income_account: AccountRef | null;
  expense_account: AccountRef | null;
  default_sales_taxes: SalesTaxRef[];
}

export interface AccountSummary {
  id: number | null;
  name: string | null;
  account_type: string | null;
  is_payment: boolean | null;
  active: boolean | null;
  currency: string | null;
}

export interface CustomerAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  postalCode: string | null;
}

export interface CustomerSummary {
  id: string | null;
  internalId: string | null;
  displayId: string | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  fax: string | null;
  tollFree: string | null;
  website: string | null;
  internalNotes: string | null;
  currency: string | null;
  address: CustomerAddress | null;
  shippingDetails: { name: string | null; instructions: string | null; phone: string | null; address: CustomerAddress | null } | null;
  outstandingAmount: string | number | null;
  overdueAmount: string | number | null;
  additionalContacts: Array<{ id: string | null; name: string | null; email: string | null; phone: string | null }>;
  createdAt: string | null;
  modifiedAt: string | null;
}

export interface EstimateSummary {
  id: string | null;
  internalId: string | null;
  estimateNumber: string | null;
  status: string | null;
  estimateDate: string | null;
  dueDate: string | null;
  currency: string | null;
  exchangeRate: string | number | null;
  total: string | number | null;
  amountDue: string | number | null;
  amountPaid: string | number | null;
  customer: { id: string | null; name: string | null; email: string | null } | null;
  lastSentAt: string | null;
  lastSentVia: string | null;
  viewUrl: string | null;
  depositStatus: string | null;
  depositValue: string | number | null;
  depositUnit: string | null;
  depositPaymentStatus: string | null;
}

export interface EstimateItem {
  id: string | null;
  productId: number | null;
  name: string | null;
  description: string | null;
  quantity: string | number | null;
  unitPrice: string | number | null;
  incomeAccountClassicId: string | null;
  incomeAccountName: string | null;
  subtotal: string | number | null;
  total: string | number | null;
  taxes: Array<{ salesTaxId: number | null; name: string | null; abbreviation: string | null; rate: number | null; amount: string | number | null }>;
}

export interface EstimateDetail extends EstimateSummary {
  title: string | null;
  subhead: string | null;
  poNumber: string | null;
  memo: string | null;
  footer: string | null;
  itemTitle: string | null;
  unitTitle: string | null;
  priceTitle: string | null;
  amountTitle: string | null;
  items: EstimateItem[];
  subtotal: string | number | null;
  discountTotal: string | number | null;
  taxTotal: string | number | null;
  createdAt: string | null;
  lastViewedAt: string | null;
  dontCarryOverNotesToInvoice: boolean | null;
  disableCreditCardPayments: boolean | null;
  disableAmexPayments: boolean | null;
}

export interface BillSummary {
  id: string | null;
  billNumber: string | null;
  billDate: string | null;
  dueDate: string | null;
  currency: string | null;
  subtotal: string | number | null;
  total: string | number | null;
  amountDue: string | number | null;
  amountPaid: string | number | null;
  paymentStatus: string | null;
  vendorId: string | null;
  vendorIsContractor: boolean | null;
}

export interface SalesTaxSummary {
  id: number | null;
  relayId: string | null;
  name: string | null;
  abbreviation: string | null;
  description: string | null;
  rate: number | null;
  rates: Array<{ effective: string | null; rate: number | null }>;
  isArchived: boolean | null;
  isCompound: boolean | null;
  isRecoverable: boolean | null;
  taxNumber: string | null;
  showTaxNumberOnInvoices: boolean | null;
}

export interface ReceiptSummary {
  id: string | null;
  amount: string | number | null;
  currency: string | null;
  dateCreated: string | null;
  description: string | null;
  missingFields: unknown[];
  attachment: { id: string | null; thumbnailUrl: string | null } | null;
}

function obj(v: unknown): Raw | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
/** Money values Wave sends as a decimal string in GraphQL and a number in REST. */
function scalar(v: unknown): string | number | null {
  return typeof v === 'string' ? v : num(v);
}
/** A rate Wave sends as a decimal string ("0.13") or a number. */
function decimal(v: unknown): number | null {
  if (typeof v === 'string' && v.trim() !== '') return num(Number(v));
  return num(v);
}
/** Ids Wave sends as a numeric string (invoices, payments) or an integer (customers, items). */
function idString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  const n = num(v);
  return n === null ? null : String(n);
}
/** `{ code: 'CAD', symbol, name, ... }` collapses to its code. */
function code(v: unknown): string | null {
  return str(obj(v)?.['code']);
}

export function shapeCustomerRef(v: unknown): CustomerRef | null {
  const c = obj(v);
  return c ? { id: num(c['id']), name: str(c['name']), email: str(c['email']) } : null;
}

export function shapeAccountRef(v: unknown): AccountRef | null {
  const a = obj(v);
  return a ? { id: num(a['id']), name: str(a['name']) } : null;
}

export function shapeSalesTax(v: unknown): SalesTaxRef {
  if (typeof v === 'number') return { id: v, name: null, abbreviation: null, rate: null };
  const t = obj(v) ?? {};
  return { id: num(t['id']), name: str(t['name']), abbreviation: str(t['abbreviation']), rate: num(t['current_rate']) };
}

export function shapeInvoiceSummary(v: unknown): InvoiceSummary {
  const i = obj(v) ?? {};
  return {
    id: idString(i['id']),
    invoice_number: str(i['invoice_number']),
    status: str(i['status']),
    invoice_date: str(i['invoice_date']),
    due_date: str(i['due_date']),
    currency: code(i['invoice_currency']),
    invoice_total: num(i['invoice_total']),
    invoice_tax_total: num(i['invoice_tax_total']),
    invoice_discount_total: num(i['invoice_discount_total']),
    invoice_amount_paid: num(i['invoice_amount_paid']),
    invoice_amount_due: num(i['invoice_amount_due']),
    last_payment_date: str(i['last_payment_date']),
    last_sent: str(i['last_sent']),
    last_sent_via: str(i['last_sent_via']),
    last_viewed: str(i['last_viewed']),
    memo: str(i['memo']),
    po_so_number: str(i['po_so_number']),
    pdf_url: str(i['pdf_url']),
    public_url: str(obj(i['sharing_urls'])?.['public']),
    customer: shapeCustomerRef(i['customer']),
  };
}

export function shapeInvoiceItem(v: unknown): InvoiceItem {
  const it = obj(v) ?? {};
  const product = obj(it['product']) ?? {};
  return {
    id: num(it['id']),
    description: str(it['description']),
    quantity: num(it['quantity']),
    price: num(it['price']),
    account_id: num(it['account_id']),
    product: { id: num(product['id']), name: str(product['name']), income_account: shapeAccountRef(product['income_account']) },
    taxes: arr(it['taxes']).map((t) => {
      const tax = obj(t) ?? {};
      return { id: num(tax['id']), amount: num(tax['amount']), sales_tax: shapeSalesTax(tax['sales_tax']) };
    }),
  };
}

export function shapeInvoicePayment(v: unknown): InvoicePayment {
  const p = obj(v) ?? {};
  return {
    id: idString(p['id']),
    payment_date: str(p['payment_date']),
    amount: num(p['amount']),
    payment_method: str(p['payment_method']),
    memo: str(p['memo']),
    exchange_rate: num(p['exchange_rate']),
    payment_account: shapeAccountRef(p['payment_account']),
  };
}

export function shapeInvoice(v: unknown): InvoiceDetail {
  const i = obj(v) ?? {};
  return {
    ...shapeInvoiceSummary(i),
    exchange_rate: num(i['exchange_rate']),
    subhead: str(i['subhead']),
    footer: str(i['footer']),
    invoice_number_label: str(i['invoice_number_label']),
    item_title: str(i['item_title']),
    quantity_title: str(i['quantity_title']),
    price_title: str(i['price_title']),
    amount_title: str(i['amount_title']),
    items: arr(i['items']).map(shapeInvoiceItem),
    payments: arr(i['payments']).map(shapeInvoicePayment),
    discounts: arr(i['discounts']),
    attachments: arr(i['attachments']),
  };
}

export function looksLikeInvoice(v: unknown): boolean {
  return typeof obj(v)?.['invoice_number'] === 'string';
}

export function shapeBusiness(v: unknown): BusinessSummary {
  const b = obj(v) ?? {};
  return {
    id: str(b['id']),
    company_name: str(b['company_name']),
    currency: code(b['primary_currency']),
    country: str(obj(b['country'])?.['country_code']),
    timezone_id: str(b['timezone_id']),
    is_personal: bool(b['is_personal']),
    is_default_business: bool(b['is_default_business']),
    is_owner: bool(b['is_owner']),
    is_admin: bool(b['is_admin']),
    invoice_sending_emails: arr(b['invoice_sending_emails']).map((e) => {
      const m = obj(e) ?? {};
      return { email: str(m['email']), default: bool(m['default']), verified: bool(m['verified']) };
    }),
  };
}

export function shapeProduct(v: unknown): ProductSummary {
  const p = obj(v) ?? {};
  return {
    id: num(p['id']),
    name: str(p['name']),
    description: str(p['description']),
    price: num(p['price']),
    active: bool(p['active']),
    is_sold: bool(p['is_sold']),
    is_bought: bool(p['is_bought']),
    income_account: shapeAccountRef(p['income_account']),
    expense_account: shapeAccountRef(p['expense_account']),
    default_sales_taxes: arr(p['default_sales_taxes']).map(shapeSalesTax),
  };
}

export function shapeAccount(v: unknown): AccountSummary {
  const a = obj(v) ?? {};
  return {
    id: num(a['id']),
    name: str(a['name']),
    account_type: str(a['account_type']),
    is_payment: bool(a['is_payment']),
    active: bool(a['active']),
    currency: code(a['currency']),
  };
}

function shapeAddress(v: unknown): CustomerAddress | null {
  const a = obj(v);
  if (!a) return null;
  return {
    addressLine1: str(a['addressLine1']),
    addressLine2: str(a['addressLine2']),
    city: str(a['city']),
    province: code(a['province']),
    country: code(a['country']),
    postalCode: str(a['postalCode']),
  };
}

export function shapeCustomer(v: unknown): CustomerSummary {
  const c = obj(v) ?? {};
  return {
    id: str(c['id']),
    internalId: idString(c['internalId']),
    displayId: str(c['displayId']),
    name: str(c['name']),
    firstName: str(c['firstName']),
    lastName: str(c['lastName']),
    email: str(c['email']),
    phone: str(c['phone']),
    mobile: str(c['mobile']),
    fax: str(c['fax']),
    tollFree: str(c['tollFree']),
    website: str(c['website']),
    internalNotes: str(c['internalNotes']),
    currency: code(c['currency']),
    address: shapeAddress(c['address']),
    shippingDetails: (() => {
      const s = obj(c['shippingDetails']);
      return s ? { name: str(s['name']), instructions: str(s['instructions']), phone: str(s['phone']), address: shapeAddress(s['address']) } : null;
    })(),
    outstandingAmount: scalar(obj(c['outstandingAmount'])?.['value']),
    overdueAmount: scalar(obj(c['overdueAmount'])?.['value']),
    additionalContacts: arr(c['additionalContacts']).map((x) => {
      const m = obj(x) ?? {};
      return { id: str(m['id']), name: str(m['name']), email: str(m['email']), phone: str(m['phone']) };
    }),
    createdAt: str(c['createdAt']),
    modifiedAt: str(c['modifiedAt']),
  };
}

export function shapeEstimate(v: unknown): EstimateSummary {
  const e = obj(v) ?? {};
  const id = str(e['id']);
  const customer = obj(e['customer']);
  return {
    id,
    internalId: decodeInternalId(id),
    estimateNumber: str(e['estimateNumber']),
    status: str(e['status']),
    estimateDate: str(e['estimateDate']),
    dueDate: str(e['dueDate']),
    currency: code(e['currency']),
    exchangeRate: scalar(e['exchangeRate']),
    total: scalar(obj(e['total'])?.['value']),
    amountDue: scalar(obj(e['amountDue'])?.['value']),
    amountPaid: scalar(obj(e['amountPaid'])?.['value']),
    customer: customer ? { id: str(customer['id']), name: str(customer['name']), email: str(customer['email']) } : null,
    lastSentAt: str(e['lastSentAt']),
    lastSentVia: str(e['lastSentVia']),
    viewUrl: str(e['viewUrl']),
    depositStatus: str(e['depositStatus']),
    depositValue: scalar(e['depositValue']),
    depositUnit: str(e['depositUnit']),
    depositPaymentStatus: str(e['depositPaymentStatus']),
  };
}

function shapeEstimateItem(v: unknown): EstimateItem {
  const it = obj(v) ?? {};
  const product = obj(it['product']);
  const account = obj(it['account']);
  const internal = decodeInternalId(str(product?.['id']));
  return {
    id: str(it['id']),
    productId: internal === null ? null : num(Number(internal)),
    name: str(product?.['name']),
    description: str(it['description']),
    quantity: scalar(it['quantity']),
    unitPrice: scalar(it['unitPrice']),
    incomeAccountClassicId: idString(account?.['classicId']),
    incomeAccountName: str(account?.['name']),
    subtotal: scalar(obj(it['subtotal'])?.['value']),
    total: scalar(obj(it['total'])?.['value']),
    taxes: arr(it['taxes']).map((t) => {
      const tax = obj(obj(t)?.['salesTax']);
      const taxId = decodeInternalId(str(tax?.['id']));
      return {
        salesTaxId: taxId === null ? null : num(Number(taxId)),
        name: str(tax?.['name']),
        abbreviation: str(tax?.['abbreviation']),
        rate: decimal(tax?.['rate']),
        amount: scalar(obj(obj(t)?.['amount'])?.['value']),
      };
    }),
  };
}

export interface EstimateRef { id: string | null; internalId: string | null; estimateNumber: string | null; status: string | null }

/** The small estimate record lifecycle mutations return. */
export function shapeEstimateRef(v: unknown): EstimateRef | null {
  const e = obj(v);
  if (!e) return null;
  const id = str(e['id']);
  return { id, internalId: decodeInternalId(id), estimateNumber: str(e['estimateNumber']), status: str(e['status']) };
}

export function shapeEstimateDetail(v: unknown): EstimateDetail {
  const e = obj(v) ?? {};
  return {
    ...shapeEstimate(v),
    title: str(e['title']),
    subhead: str(e['subhead']),
    poNumber: str(e['poNumber']),
    memo: str(e['memo']),
    footer: str(e['footer']),
    itemTitle: str(e['itemTitle']),
    unitTitle: str(e['unitTitle']),
    priceTitle: str(e['priceTitle']),
    amountTitle: str(e['amountTitle']),
    items: arr(e['items']).map(shapeEstimateItem),
    subtotal: scalar(obj(e['subtotal'])?.['value']),
    discountTotal: scalar(obj(e['discountTotal'])?.['value']),
    taxTotal: scalar(obj(e['taxTotal'])?.['value']),
    createdAt: str(e['createdAt']),
    lastViewedAt: str(e['lastViewedAt']),
    dontCarryOverNotesToInvoice: bool(e['dontCarryOverNotesToInvoice']),
    disableCreditCardPayments: bool(e['disableCreditCardPayments']),
    disableAmexPayments: bool(e['disableAmexPayments']),
  };
}

function decodeInternalId(relayId: string | null): string | null {
  if (!relayId) return null;
  try {
    return fromCompositeGlobalId(relayId).internalId;
  } catch {
    return null;
  }
}

export function shapeBill(v: unknown): BillSummary {
  const b = obj(v) ?? {};
  return {
    id: str(b['id']),
    billNumber: str(b['billNumber']),
    billDate: str(b['billDate']),
    dueDate: str(b['dueDate']),
    currency: code(b['currency']),
    subtotal: scalar(b['subtotal']),
    total: scalar(b['total']),
    amountDue: scalar(b['amountDue']),
    amountPaid: scalar(b['amountPaid']),
    paymentStatus: str(b['paymentStatus']),
    vendorId: idString(b['billerId']),
    vendorIsContractor: bool(b['vendorIsContractor']),
  };
}

export function shapeReceipt(v: unknown): ReceiptSummary {
  const r = obj(v) ?? {};
  const att = obj(r['attachment']);
  return {
    id: str(r['id']),
    amount: scalar(r['amount']),
    currency: code(r['currency']),
    dateCreated: str(r['dateCreated']),
    description: str(r['description']),
    missingFields: arr(r['missingFields']),
    attachment: att ? { id: str(att['id']), thumbnailUrl: str(att['thumbnailUrl']) } : null,
  };
}

export function shapeSalesTaxSummary(v: unknown): SalesTaxSummary {
  const t = obj(v) ?? {};
  const relayId = str(t['id']);
  const internalId = decodeInternalId(relayId);
  return {
    id: internalId === null ? null : num(Number(internalId)),
    relayId,
    name: str(t['name']),
    abbreviation: str(t['abbreviation']),
    description: str(t['description']),
    rate: decimal(t['rate']),
    rates: arr(t['rates']).map((r) => {
      const o = obj(r) ?? {};
      return { effective: str(o['effective']), rate: decimal(o['rate']) };
    }),
    isArchived: bool(t['isArchived']),
    isCompound: bool(t['isCompound']),
    isRecoverable: bool(t['isRecoverable']),
    taxNumber: str(t['taxNumber']),
    showTaxNumberOnInvoices: bool(t['showTaxNumberOnInvoices']),
  };
}

export interface ReportRow { type: string | null; indent: number | null; cells: Array<string | null>; notes?: Array<string | null> }
export interface ReportSection { title: string | null; columns: Array<string | null>; rows: ReportRow[] }
export interface ReportFigure { label: string | null; value: string | null; currency: string | null }

/** A report cell's value: one string, or several parts (`["Jan 1, 2026", "to Nov 1, 2026"]`) joined with a space. */
function cellText(v: unknown): string | null {
  if (Array.isArray(v)) {
    const parts = v.filter((x) => x !== null && x !== undefined).map(String);
    return parts.length === 0 ? null : parts.join(' ');
  }
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function rowType(v: unknown): string | null {
  const name = str(obj(v)?.['display_name']);
  return name === null ? null : name.replace(/ Row$/, '').toLowerCase();
}

/** Wave's report tables come as header-plus-rows sections or, for the aged reports, as grids of values. */
function shapeReportSection(v: unknown): ReportSection {
  const sec = obj(v) ?? {};
  if (Array.isArray(sec['values'])) {
    return {
      title: str(obj(sec['report_engine_type'])?.['display_name']),
      columns: [],
      rows: arr(sec['values']).map((r) => ({ type: 'data', indent: 0, cells: arr(r).map((c) => cellText(obj(c)?.['value'])) })),
    };
  }
  const header = arr(obj(sec['header'])?.['cells']).map((c) => cellText(obj(c)?.['value']));
  return {
    title: header[0] ?? null,
    columns: header,
    rows: arr(sec['rows']).map((r) => {
      const row = obj(r) ?? {};
      const cells = arr(row['cells']);
      const notes = cells.map((c) => str(obj(obj(c)?.['params'])?.['subtitle']));
      const shaped: ReportRow = {
        type: rowType(row['row_type']),
        indent: num(obj(row['params'])?.['indentation_level']),
        cells: cells.map((c) => cellText(obj(c)?.['value'])),
      };
      if (notes.some((n) => n !== null)) shaped.notes = notes;
      return shaped;
    }),
  };
}

function figure(label: string | null, amount: unknown): ReportFigure {
  const a = obj(amount);
  return { label, value: str(a?.['value']) ?? str(a?.['formatted_string']), currency: code(a?.['currency']) };
}

/** Headline figures: `summary: [{ label, total }]` on profit and loss, `{ name, balance }` entries elsewhere. */
function shapeReportOverview(v: unknown): ReportFigure[] {
  const o = obj(v) ?? {};
  if (Array.isArray(o['summary'])) return arr(o['summary']).map((f) => figure(str(obj(f)?.['label']), obj(f)?.['total']));
  const out: ReportFigure[] = [];
  for (const [key, entry] of Object.entries(o)) {
    const e = obj(entry);
    if (!e) continue;
    const amount = e['balance'] ?? e['total'] ?? e['amount'];
    if (amount === undefined) continue;
    const label = [str(e['name']), str(e['label'])].find((l) => l !== null && l.trim() !== '') ?? key.replace(/_/g, ' ');
    out.push(figure(label, amount));
  }
  return out;
}

export interface ReportResult { detail: 'summary' | 'detailed'; overview: ReportFigure[]; sections: ReportSection[] }

/** Pick the requested detail level, falling back to the other when Wave leaves it null. */
export function shapeReport(v: unknown, detail: 'summary' | 'detailed'): ReportResult {
  const r = obj(v) ?? {};
  const reports = obj(r['reports']) ?? {};
  const other = detail === 'summary' ? 'detailed' : 'summary';
  const used = Array.isArray(reports[detail]) ? detail : Array.isArray(reports[other]) ? other : detail;
  return { detail: used, overview: shapeReportOverview(r['overview']), sections: arr(reports[used]).map(shapeReportSection) };
}

export interface TransactionAccount { id: number | null; relayId: string | null; name: string | null }
export interface TransactionLine {
  account: TransactionAccount | null;
  amount: string | number | null;
  itemType: string | null;
  description: string | null;
  customer: { id: string | null; name: string | null } | null;
  tags: Array<{ id: string | null; name: string | null }>;
}
export interface TransactionSummary {
  id: string | null;
  date: string | null;
  description: string | null;
  notes: string | null;
  amount: string | number | null;
  currency: string | null;
  direction: string | null;
  sequence: number | null;
  verificationStatus: string | null;
  origin: string | null;
  missingFields: unknown[];
  account: TransactionAccount | null;
  lines: TransactionLine[];
}
export interface TagSummary { id: string | null; name: string | null; description: string | null; archived: boolean | null; group: string | null }

/** GraphQL accounts carry the REST integer id as `classicId`; that is the `id` callers see. */
function shapeTransactionAccount(v: unknown): TransactionAccount | null {
  const a = obj(v);
  if (!a) return null;
  const classic = idString(a['classicId']);
  return { id: classic === null ? null : num(Number(classic)), relayId: str(a['id']), name: str(a['name']) };
}

export function shapeTransaction(v: unknown): TransactionSummary {
  const t = obj(v) ?? {};
  const anchor = obj(t['anchorLineItem']);
  return {
    id: str(t['id']),
    date: str(t['date']),
    description: str(t['description']),
    notes: str(t['notes']),
    amount: scalar(t['amount']),
    currency: code(t['currency']),
    direction: str(t['direction']),
    sequence: num(t['sequence']),
    verificationStatus: str(t['verificationStatus']),
    origin: str(obj(t['origin'])?.['type']),
    missingFields: arr(t['missingFields']),
    account: shapeTransactionAccount(anchor?.['account']),
    lines: arr(t['lineItems']).map((l) => {
      const line = obj(l) ?? {};
      const customer = obj(line['customer']);
      return {
        account: shapeTransactionAccount(line['account']),
        amount: scalar(line['amount']),
        itemType: str(line['itemType']),
        description: str(line['description']),
        customer: customer ? { id: str(customer['id']), name: str(customer['name']) } : null,
        tags: arr(line['tags']).map((g) => ({ id: str(obj(g)?.['id']), name: str(obj(g)?.['name']) })),
      };
    }),
  };
}

export function shapeTag(v: unknown): TagSummary {
  const t = obj(v) ?? {};
  return { id: str(t['id']), name: str(t['name']), description: str(t['description']), archived: bool(t['archived']), group: str(obj(t['group'])?.['name']) };
}

export interface RecurringInvoiceLine { productId: number | null; name: string | null; description: string | null; quantity: number | null; price: number | null; taxes: unknown[] }
export interface RecurringInvoiceSummary {
  id: string | null;
  state: string | null;
  customerId: number | null;
  currency: string | null;
  total: number | null;
  paymentTerms: string | null;
  firstInvoiceDate: string | null;
  previousInvoiceDate: string | null;
  nextInvoiceDate: string | null;
  invoicesGenerated: number | null;
  dateAdded: string | null;
  canEdit: boolean | null;
}
export interface RecurringInvoiceDetail extends RecurringInvoiceSummary {
  notes: string | null;
  footer: string | null;
  subheading: string | null;
  purchaseOrderId: string | null;
  lineItems: RecurringInvoiceLine[];
  /** Passed through as Wave sends them: their fields vary with the schedule and delivery chosen. */
  schedule: Record<string, unknown> | null;
  delivery: Record<string, unknown> | null;
}

export function shapeRecurringInvoice(v: unknown): RecurringInvoiceSummary {
  const r = obj(v) ?? {};
  const customer = idString(obj(r['customer'])?.['id']);
  return {
    id: idString(r['id']),
    state: str(r['state']),
    customerId: customer === null ? null : num(Number(customer)),
    currency: str(r['currency_code']),
    total: num(r['total']),
    paymentTerms: str(r['payment_terms']),
    firstInvoiceDate: str(r['first_invoice_date']),
    previousInvoiceDate: str(r['previous_invoice_date']),
    nextInvoiceDate: str(r['next_invoice_date']),
    invoicesGenerated: num(r['num_generated_to_date']),
    dateAdded: str(r['date_added']),
    canEdit: bool(r['can_edit']),
  };
}

export function shapeRecurringInvoiceDetail(v: unknown): RecurringInvoiceDetail {
  const r = obj(v) ?? {};
  return {
    ...shapeRecurringInvoice(v),
    notes: str(r['notes']),
    footer: str(r['footer']),
    subheading: str(r['subheading']),
    purchaseOrderId: str(r['purchase_order_id']),
    lineItems: arr(r['line_items']).map((l) => {
      const li = obj(l) ?? {};
      return { productId: num(li['product_id']), name: str(li['name']), description: str(li['description']), quantity: num(li['quantity']), price: num(li['price']), taxes: arr(li['taxes']) };
    }),
    schedule: obj(r['schedule_settings']),
    delivery: obj(r['delivery_settings']),
  };
}
