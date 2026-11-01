import { describe, expect, it } from 'vitest';
import { registerInvoiceTools } from './invoices.js';
import { bodyArgsFromInvoice, hasFullState } from './_invoice-body.js';
import { INVOICE_SEND_MUTATION } from './_mutations.js';
import { shapeInvoice } from './_shape.js';
import { addDays, todayIso } from '../util/dates.js';
import { WaveMutationError } from '../client/errors.js';
import { BUSINESS_UUID, createMockClient, createStubServer } from './_test_utils.js';

const ITEM = {
  productId: 601,
  name: 'Design',
  description: 'Design work',
  incomeAccountId: 301,
  quantity: 2,
  price: '100.00',
  taxes: [401],
};

const CURRENCY = { url: 'u', code: 'CAD', symbol: '$', name: 'Canadian dollar', plural: null };
const ACCOUNT = { id: 301, url: 'u', name: 'Consulting Income', active: true, account_type: 'income', is_payment: false, currency: CURRENCY };
const SALES_TAX = { id: 401, url: 'u', name: 'HST', abbreviation: 'HST', current_rate: 0.13, accounts_receivable: ACCOUNT, accounts_payable: ACCOUNT };
const CUSTOMER = { id: 201, url: 'u', name: 'Example Co', email: 'billing@example.com', address1: '1 Example St', country: { country_code: 'CA', currency: CURRENCY } };

/** A raw Wave invoice as GET returns it (abridged to the fields that matter). */
const RAW_INVOICE = {
  id: '9000000000000000001', url: 'u', subhead: 'Sub', footer: 'Thanks', po_so_number: 'PO-1', memo: 'Memo',
  invoice_date: '2026-01-10', invoice_number_label: 'Invoice', invoice_number: '42', invoice_currency: CURRENCY, exchange_rate: 1,
  invoice_total: 226, invoice_discount_total: 0, invoice_tax_total: 26, invoice_amount_paid: 0, invoice_amount_due: 226,
  due_date: '2026-01-25', status: 'unpaid', pdf_url: 'https://example.com/pdf', sharing_urls: { public: 'https://example.com/pub' },
  items: [
    {
      id: 501, url: 'u', product: { id: 601, url: 'u', name: 'Design', price: 100, income_account: ACCOUNT, default_sales_taxes: [] },
      price: 100, quantity: 2, description: 'Design work',
      taxes: [{ id: 701, url: 'u', amount: 26, sales_tax: SALES_TAX }],
      account_id: 301,
    },
  ],
  discounts: [], attachments: [], payments: [],
  item_title: 'Services', description_title: 'Description', quantity_title: 'Hours', price_title: 'Rate', amount_title: 'Amount',
  hide_item: false, hide_description: false, hide_quantity: false, hide_price: false, hide_amount: false, tag_ids: [], customer: CUSTOMER,
};

const SETTINGS = {
  default_footer: 'Pay within terms.', default_payment_terms: 30, default_title: 'Invoice', default_subheading: 'Studio',
  standard_memo: 'Thank you.', default_item_title: 'Work', default_quantity_title: 'Qty', default_price_title: 'Unit', default_amount_title: 'Total',
};
const BUSINESS = { id: BUSINESS_UUID, company_name: 'Example Co', primary_currency: { code: 'NZD', symbol: '$', name: 'New Zealand dollar' } };

/** rest.get answering settings, business or invoice GETs by path. */
function answerGets(mock: ReturnType<typeof createMockClient>, overrides: { settings?: unknown; business?: unknown; invoice?: unknown } = {}): void {
  mock.rest.get.mockImplementation(async (path: string) => {
    if (path.endsWith('/invoices/settings/')) return overrides.settings ?? SETTINGS;
    if (path === `/businesses/${BUSINESS_UUID}/`) return overrides.business ?? BUSINESS;
    return overrides.invoice ?? RAW_INVOICE;
  });
}

function setup() {
  const stub = createStubServer();
  const mock = createMockClient();
  registerInvoiceTools(stub.server as never, mock.client);
  return { stub, mock };
}

describe('registerInvoiceTools', () => {
  it('registers the invoice tools (accounts and payments live elsewhere now)', () => {
    const { stub } = setup();
    expect([...stub.handlers.keys()].sort()).toEqual([
      'wave_approve_invoice',
      'wave_create_invoice',
      'wave_delete_invoice',
      'wave_get_invoice',
      'wave_get_invoice_settings',
      'wave_list_invoices',
      'wave_mark_invoice_sent',
      'wave_send_invoice',
      'wave_update_invoice',
    ]);
  });
});

describe('wave_list_invoices', () => {
  it('always embeds the customer and returns trimmed rows', async () => {
    const { stub, mock } = setup();
    mock.rest.getPaged.mockResolvedValueOnce({ items: [RAW_INVOICE], meta: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 } });
    const out = (await stub.parsed('wave_list_invoices', { status: 'draft' })) as { items: Array<Record<string, unknown>>; meta: unknown };
    expect(mock.rest.getPaged).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/invoices/`, {
      page: 1,
      page_size: 25,
      sort: '-invoice_date',
      status: 'draft',
      embed_customer: true,
    });
    expect(out.meta).toEqual({ page: 1, pageSize: 25, totalCount: 1, totalPages: 1 });
    expect(out.items[0]).toMatchObject({ id: '9000000000000000001', invoice_number: '42', currency: 'CAD', customer: { id: 201, name: 'Example Co', email: 'billing@example.com' } });
    expect(out.items[0]).not.toHaveProperty('items');
    expect(out.items[0]).not.toHaveProperty('hide_item');
  });

  it('returns Wave\'s untouched page with raw: true', async () => {
    const { stub, mock } = setup();
    const paged = { items: [RAW_INVOICE], meta: { page: 1, pageSize: 25, totalCount: 1, totalPages: 1 } };
    mock.rest.getPaged.mockResolvedValueOnce(paged);
    const out = await stub.parsed('wave_list_invoices', { raw: true });
    expect(out).toEqual(paged);
  });
});

describe('wave_get_invoice', () => {
  it('asks for every embed, url-encodes the id and returns the trimmed invoice', async () => {
    const { stub, mock } = setup();
    mock.rest.get.mockResolvedValueOnce(RAW_INVOICE);
    const out = (await stub.parsed('wave_get_invoice', { invoiceId: '9000000000000000001' })) as { invoice: Record<string, unknown> };
    expect(mock.rest.get).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/invoices/9000000000000000001/`, {
      embed_accounts: true,
      embed_customer: true,
      embed_discounts: true,
      embed_items: true,
      embed_payments: true,
      embed_products: true,
      embed_sales_taxes: true,
      embed_attachments: true,
    });
    expect(out.invoice).toEqual(shapeInvoice(RAW_INVOICE));
    expect(JSON.stringify(out.invoice)).not.toContain('accounts_receivable');
  });

  it('returns the raw invoice with raw: true', async () => {
    const { stub, mock } = setup();
    mock.rest.get.mockResolvedValueOnce(RAW_INVOICE);
    const out = (await stub.parsed('wave_get_invoice', { invoiceId: '1', raw: true })) as { invoice: unknown };
    expect(out.invoice).toEqual(RAW_INVOICE);
  });
});

describe('wave_get_invoice_settings', () => {
  it('hits /invoices/settings/', async () => {
    const { stub, mock } = setup();
    mock.rest.get.mockResolvedValueOnce(SETTINGS);
    const out = (await stub.parsed('wave_get_invoice_settings', {})) as { settings: unknown };
    expect(mock.rest.get).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/invoices/settings/`);
    expect(out.settings).toEqual(SETTINGS);
  });
});

describe('wave_create_invoice', () => {
  it('takes labels, memo, footer, terms and currency from the workspace when not supplied', async () => {
    const { stub, mock } = setup();
    answerGets(mock);
    mock.rest.post.mockResolvedValueOnce(RAW_INVOICE);
    const out = (await stub.parsed('wave_create_invoice', { customerId: 201, items: [ITEM], invoiceDate: '2026-05-11' })) as { invoice: Record<string, unknown> };
    expect(mock.rest.get).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/invoices/settings/`);
    expect(mock.rest.get).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/`);
    const [path, body] = mock.rest.post.mock.calls[0]! as [string, Record<string, unknown>];
    expect(path).toBe(`/businesses/${BUSINESS_UUID}/invoices/`);
    expect(body).toMatchObject({
      customer: { id: 201 },
      status: 'draft',
      invoice_date: '2026-05-11',
      due_date: '2026-06-10',
      footer: 'Pay within terms.',
      memo: 'Thank you.',
      subhead: 'Studio',
      item_title: 'Work',
      quantity_title: 'Qty',
      price_title: 'Unit',
      amount_title: 'Total',
      invoice_number_label: 'Invoice',
      exchange_rate: '1.0000000000',
    });
    expect(body['invoice_currency']).toMatchObject({ code: 'NZD', symbol: '', name: 'NZD' });
    expect(body).not.toHaveProperty('invoice_number');
    const items = body['items'] as ReadonlyArray<Record<string, unknown>>;
    expect(items[0]).toEqual({
      description: 'Design work',
      price: '100.00',
      product: { id: 601, income_account: { id: 301 }, name: 'Design' },
      quantity: 2,
      taxes: [{ sales_tax: { id: 401 } }],
    });
    expect(out.invoice).toEqual(shapeInvoice(RAW_INVOICE));
  });

  it('falls back to neutral labels and 15-day terms when the settings are empty', async () => {
    const { stub, mock } = setup();
    answerGets(mock, { settings: {} });
    mock.rest.post.mockResolvedValueOnce(RAW_INVOICE);
    await stub.invoke('wave_create_invoice', { customerId: 1, items: [ITEM], invoiceDate: '2026-05-11', currency: 'CAD' });
    const body = mock.rest.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toMatchObject({ due_date: '2026-05-26', item_title: 'Items', quantity_title: 'Quantity', price_title: 'Price', amount_title: 'Amount', invoice_number_label: 'Invoice', footer: '', memo: '', subhead: '' });
  });

  it('skips the settings and business reads when everything is supplied, and defaults the date to the local today', async () => {
    const { stub, mock } = setup();
    mock.rest.post.mockResolvedValueOnce(RAW_INVOICE);
    await stub.invoke('wave_create_invoice', {
      customerId: 1, items: [ITEM], invoiceNumber: 'INV-42', dueDate: '2026-12-31', currency: 'CAD', memo: 'm', footer: 'f', subhead: 's',
      itemTitle: 'Services', quantityTitle: 'Hours', priceTitle: 'Rate', amountTitle: 'Amount', invoiceNumberLabel: 'Invoice',
    });
    expect(mock.rest.get).not.toHaveBeenCalled();
    const body = mock.rest.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body['invoice_number']).toBe('INV-42');
    expect(body['invoice_date']).toBe(todayIso());
    expect(body['due_date']).toBe('2026-12-31');
    expect(body['invoice_currency']).toMatchObject({ code: 'CAD', symbol: '$', name: 'Canadian dollar' });
  });

  it('dates a due date from the invoice date and the workspace terms', async () => {
    const { stub, mock } = setup();
    answerGets(mock);
    mock.rest.post.mockResolvedValueOnce(RAW_INVOICE);
    await stub.invoke('wave_create_invoice', { customerId: 1, items: [ITEM], currency: 'CAD' });
    const body = mock.rest.post.mock.calls[0]![1] as Record<string, string>;
    expect(body['due_date']).toBe(addDays(todayIso(), 30));
  });
});

describe('wave_update_invoice', () => {
  it('reads the invoice and PATCHes the full state with only the supplied fields changed', async () => {
    const { stub, mock } = setup();
    answerGets(mock);
    mock.rest.patch.mockResolvedValueOnce({ ...RAW_INVOICE, due_date: '2026-02-28' });
    const out = (await stub.parsed('wave_update_invoice', { invoiceId: '9000000000000000001', dueDate: '2026-02-28' })) as { invoice: Record<string, unknown> };
    expect(mock.rest.get).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/invoices/9000000000000000001/`, expect.objectContaining({ embed_items: true }));
    const [path, body] = mock.rest.patch.mock.calls[0]! as [string, Record<string, unknown>];
    expect(path).toBe(`/businesses/${BUSINESS_UUID}/invoices/9000000000000000001/`);
    expect(body).toMatchObject({
      customer: { id: 201 },
      status: 'saved',
      invoice_number: '42',
      po_so_number: 'PO-1',
      invoice_date: '2026-01-10',
      due_date: '2026-02-28',
      exchange_rate: '1',
      memo: 'Memo',
      footer: 'Thanks',
      subhead: 'Sub',
      item_title: 'Services',
      quantity_title: 'Hours',
      price_title: 'Rate',
      amount_title: 'Amount',
      invoice_number_label: 'Invoice',
    });
    expect(body['invoice_currency']).toMatchObject({ code: 'CAD' });
    expect(body['items']).toEqual([
      { description: 'Design work', price: '100', product: { id: 601, income_account: { id: 301 }, name: 'Design' }, quantity: 2, taxes: [{ sales_tax: { id: 401 } }] },
    ]);
    expect(out.invoice['due_date']).toBe('2026-02-28');
  });

  it('keeps a draft a draft and lets status be set explicitly', async () => {
    const { stub, mock } = setup();
    answerGets(mock, { invoice: { ...RAW_INVOICE, status: 'draft' } });
    mock.rest.patch.mockResolvedValue(RAW_INVOICE);
    await stub.invoke('wave_update_invoice', { invoiceId: '1', memo: 'new memo' });
    expect((mock.rest.patch.mock.calls[0]![1] as Record<string, unknown>)['status']).toBe('draft');
    await stub.invoke('wave_update_invoice', { invoiceId: '1', status: 'saved' });
    expect((mock.rest.patch.mock.calls[1]![1] as Record<string, unknown>)['status']).toBe('saved');
  });

  it('does not read first when the caller supplies the full state', async () => {
    const { stub, mock } = setup();
    mock.rest.patch.mockResolvedValueOnce(RAW_INVOICE);
    await stub.invoke('wave_update_invoice', {
      invoiceId: '1', customerId: 201, items: [ITEM], status: 'saved', invoiceNumber: '220', poSoNumber: '', invoiceDate: '2026-05-11', dueDate: '2026-05-26',
      currency: 'CAD', exchangeRate: '1.0000000000', memo: '', footer: '', subhead: '', itemTitle: 'Services', quantityTitle: 'Hours', priceTitle: 'Rate', amountTitle: 'Amount', invoiceNumberLabel: 'Invoice',
    });
    expect(mock.rest.get).not.toHaveBeenCalled();
    const body = mock.rest.patch.mock.calls[0]![1] as Record<string, unknown>;
    expect(body['customer']).toEqual({ id: 201 });
    expect(body['invoice_number']).toBe('220');
  });

  it('explains which field the stored invoice lacks instead of sending a broken body', async () => {
    const { stub, mock } = setup();
    answerGets(mock, { invoice: { ...RAW_INVOICE, items: [{ ...RAW_INVOICE.items[0], product: { id: null, name: 'Design', income_account: ACCOUNT } }] } });
    await expect(stub.invoke('wave_update_invoice', { invoiceId: '1', memo: 'x' })).rejects.toThrow(/product id on line 1/);
    expect(mock.rest.patch).not.toHaveBeenCalled();
  });
});

describe('bodyArgsFromInvoice and hasFullState', () => {
  it('round-trips a shaped invoice into update arguments', () => {
    const args = bodyArgsFromInvoice(shapeInvoice(RAW_INVOICE));
    expect(args).toMatchObject({ customerId: 201, status: 'saved', invoiceNumber: '42', currency: 'CAD', exchangeRate: '1' });
    expect(args.items).toEqual([{ productId: 601, name: 'Design', description: 'Design work', incomeAccountId: 301, quantity: 2, price: '100', taxes: [401] }]);
    expect(hasFullState(args)).toBe(true);
    expect(hasFullState({ customerId: 1 })).toBe(false);
  });
});

describe('wave_approve_invoice', () => {
  it('PATCHes status=saved and returns the trimmed invoice', async () => {
    const { stub, mock } = setup();
    mock.rest.patch.mockResolvedValueOnce({ ...RAW_INVOICE, status: 'unpaid' });
    const out = (await stub.parsed('wave_approve_invoice', { invoiceId: 'X' })) as { invoice: { status: string } };
    expect(mock.rest.patch).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/invoices/X/`, { status: 'saved' });
    expect(out.invoice.status).toBe('unpaid');
  });
});

describe('wave_mark_invoice_sent', () => {
  it('PUTs mark-sent and returns the trimmed invoice when Wave sends one back', async () => {
    const { stub, mock } = setup();
    mock.rest.put.mockResolvedValueOnce({ ...RAW_INVOICE, last_sent_via: 'marked_sent' });
    const out = (await stub.parsed('wave_mark_invoice_sent', { invoiceId: '999' })) as { invoice: { last_sent_via: string } };
    expect(mock.rest.put).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/invoices/999/mark-sent/`, { sent_via: 'marked_sent' });
    expect(out.invoice.last_sent_via).toBe('marked_sent');
  });

  it('passes through anything that is not an invoice', async () => {
    const { stub, mock } = setup();
    mock.rest.put.mockResolvedValueOnce({ ok: true });
    const out = await stub.parsed('wave_mark_invoice_sent', { invoiceId: '999' });
    expect(out).toEqual({ result: { ok: true } });
  });
});

describe('wave_send_invoice', () => {
  const ARGS = { invoiceId: '9000000000000000003', to: ['x@example.com'], subject: 'S', message: 'M', fromAddress: 'me@example.com' };

  it('encodes the invoice id as a composite Relay id, forwards the email fields and reports success', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ invoiceSend: { didSucceed: true, inputErrors: [] } });
    const out = await stub.parsed('wave_send_invoice', { ...ARGS, ccMyself: true, attachPDF: true, includeAttachments: false });
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(INVOICE_SEND_MUTATION);
    expect(call.variables.input).toMatchObject({ to: ['x@example.com'], subject: 'S', message: 'M', fromAddress: 'me@example.com', ccMyself: true, attachPDF: true, includeAttachments: false });
    expect(call.variables.input.invoiceId).toBe(Buffer.from(`Business:${BUSINESS_UUID};Invoice:9000000000000000003`, 'utf8').toString('base64'));
    expect(out).toEqual({ sent: true, invoiceId: '9000000000000000003', to: ['x@example.com'] });
  });

  it('throws WaveMutationError with Wave\'s reason when didSucceed is false', async () => {
    const { stub, mock } = setup();
    const rejected = { invoiceSend: { didSucceed: false, inputErrors: [{ path: ['fromAddress'], message: 'Not a verified sender.', code: 'INVALID' }] } };
    mock.gql.execute.mockResolvedValueOnce(rejected);
    await expect(stub.invoke('wave_send_invoice', ARGS)).rejects.toThrow(WaveMutationError);
    mock.gql.execute.mockResolvedValueOnce(rejected);
    await expect(stub.invoke('wave_send_invoice', ARGS)).rejects.toThrow(/fromAddress: Not a verified sender/);
  });

  it('is marked destructive: an email cannot be unsent', () => {
    const { stub } = setup();
    const cfg = stub.configs.get('wave_send_invoice') as { annotations: { destructiveHint: boolean } };
    expect(cfg.annotations.destructiveHint).toBe(true);
  });
});

describe('wave_delete_invoice', () => {
  it('DELETEs /invoices/{id}/', async () => {
    const { stub, mock } = setup();
    mock.rest.delete.mockResolvedValueOnce(undefined);
    const out = (await stub.parsed('wave_delete_invoice', { invoiceId: 'INV' })) as { ok: boolean };
    expect(mock.rest.delete).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/invoices/INV/`);
    expect(out.ok).toBe(true);
  });
});
