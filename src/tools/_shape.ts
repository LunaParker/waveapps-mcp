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
  website: string | null;
  internalNotes: string | null;
  currency: string | null;
  address: {
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    province: string | null;
    country: string | null;
    postalCode: string | null;
  } | null;
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

export function shapeCustomer(v: unknown): CustomerSummary {
  const c = obj(v) ?? {};
  const address = obj(c['address']);
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
    website: str(c['website']),
    internalNotes: str(c['internalNotes']),
    currency: code(c['currency']),
    address: address
      ? {
          addressLine1: str(address['addressLine1']),
          addressLine2: str(address['addressLine2']),
          city: str(address['city']),
          province: code(address['province']),
          country: code(address['country']),
          postalCode: str(address['postalCode']),
        }
      : null,
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
