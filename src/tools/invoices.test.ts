import { describe, expect, it } from 'vitest';
import { registerInvoiceTools } from './invoices.js';
import { INVOICE_SEND_MUTATION } from './_mutations.js';
import { BUSINESS_UUID, createMockClient, createStubServer } from './_test_utils.js';

const ITEM = {
  productId: 133995046,
  name: 'Test line',
  description: '',
  incomeAccountId: 729213118,
  quantity: 1,
  price: '5.00',
  taxes: [],
};

describe('registerInvoiceTools', () => {
  it('registers every invoice tool', () => {
    const stub = createStubServer();
    const mock = createMockClient();
    registerInvoiceTools(stub.server as never, mock.client);
    const names = [...stub.handlers.keys()].sort();
    expect(names).toEqual([
      'wave_approve_invoice',
      'wave_create_invoice',
      'wave_delete_invoice',
      'wave_delete_invoice_payment',
      'wave_get_invoice',
      'wave_get_invoice_settings',
      'wave_list_accounts',
      'wave_list_invoices',
      'wave_mark_invoice_sent',
      'wave_record_invoice_payment',
      'wave_send_invoice',
      'wave_update_invoice',
    ]);
  });

  describe('wave_list_invoices', () => {
    it('builds the REST URL + query params', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.getPaged.mockResolvedValueOnce({ items: [], meta: { page: 1, pageSize: 25, totalCount: 0, totalPages: 0 } });
      registerInvoiceTools(stub.server as never, mock.client);
      await stub.invoke('wave_list_invoices', { status: 'draft', page: 1, pageSize: 25, sort: '-invoice_date', embedCustomer: true });
      expect(mock.rest.getPaged).toHaveBeenCalledWith(
        `/businesses/${BUSINESS_UUID}/invoices/`,
        { page: 1, page_size: 25, sort: '-invoice_date', status: 'draft', embed_customer: true },
      );
    });
  });

  describe('wave_get_invoice', () => {
    it('asks for every embed and url-encodes the id', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.get.mockResolvedValueOnce({ id: '252...' });
      registerInvoiceTools(stub.server as never, mock.client);
      await stub.invoke('wave_get_invoice', { invoiceId: '2520825210135910924' });
      expect(mock.rest.get).toHaveBeenCalledWith(
        `/businesses/${BUSINESS_UUID}/invoices/2520825210135910924/`,
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
    });
  });

  describe('wave_get_invoice_settings', () => {
    it('hits /invoices/settings/', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.get.mockResolvedValueOnce({});
      registerInvoiceTools(stub.server as never, mock.client);
      await stub.invoke('wave_get_invoice_settings', {});
      expect(mock.rest.get).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/invoices/settings/`);
    });
  });

  describe('wave_list_accounts', () => {
    it('hits /accounts/ with active_only', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.get.mockResolvedValueOnce([]);
      registerInvoiceTools(stub.server as never, mock.client);
      await stub.invoke('wave_list_accounts', { activeOnly: true });
      expect(mock.rest.get).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/accounts/`, { active_only: true });
    });
  });

  describe('wave_create_invoice', () => {
    it('POSTs a full invoice body and strips invoice_number when blank', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.post.mockResolvedValueOnce({ id: 'new', invoice_number: '999', invoice_date: '2026-05-11', due_date: '2026-05-26', status: 'draft' });
      registerInvoiceTools(stub.server as never, mock.client);
      await stub.invoke('wave_create_invoice', { customerId: 102532808, items: [ITEM] });
      expect(mock.rest.post).toHaveBeenCalledTimes(1);
      const [path, body] = mock.rest.post.mock.calls[0]! as [string, Record<string, unknown>];
      expect(path).toBe(`/businesses/${BUSINESS_UUID}/invoices/`);
      expect(body).not.toHaveProperty('invoice_number');
      expect(body['customer']).toEqual({ id: 102532808 });
      expect(body['status']).toBe('draft');
      expect(body['exchange_rate']).toBe('1.0000000000');
      expect(body['invoice_currency']).toMatchObject({ code: 'CAD', symbol: '$', name: 'Canadian dollar' });
      const items = body['items'] as ReadonlyArray<Record<string, unknown>>;
      expect(items[0]!['product']).toEqual({
        id: ITEM.productId,
        income_account: { id: ITEM.incomeAccountId },
        name: ITEM.name,
      });
      expect(items[0]!['price']).toBe('5.00');
      expect(items[0]!['quantity']).toBe(1);
    });

    it('keeps invoice_number when caller supplies it, and defaults dates', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.post.mockResolvedValueOnce({ id: 'x' });
      registerInvoiceTools(stub.server as never, mock.client);
      await stub.invoke('wave_create_invoice', { customerId: 1, items: [ITEM], invoiceNumber: 'INV-42' });
      const body = mock.rest.post.mock.calls[0]![1] as Record<string, string>;
      expect(body['invoice_number']).toBe('INV-42');
      expect(body['invoice_date']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(body['due_date']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('defaults dueDate to 15 days after invoiceDate', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.post.mockResolvedValueOnce({ id: 'x' });
      registerInvoiceTools(stub.server as never, mock.client);
      await stub.invoke('wave_create_invoice', { customerId: 1, items: [ITEM], invoiceDate: '2026-05-11' });
      const body = mock.rest.post.mock.calls[0]![1] as Record<string, string>;
      expect(body['invoice_date']).toBe('2026-05-11');
      expect(body['due_date']).toBe('2026-05-26');
    });
  });

  describe('wave_update_invoice', () => {
    it('PATCHes the invoice and includes customer { id }', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.patch.mockResolvedValueOnce({});
      registerInvoiceTools(stub.server as never, mock.client);
      await stub.invoke('wave_update_invoice', {
        invoiceId: '2520825210135910924',
        customerId: 102532808,
        items: [ITEM],
        invoiceNumber: '220',
        invoiceDate: '2026-05-11',
        dueDate: '2026-05-26',
      });
      const [path, body] = mock.rest.patch.mock.calls[0]! as [string, Record<string, unknown>];
      expect(path).toBe(`/businesses/${BUSINESS_UUID}/invoices/2520825210135910924/`);
      expect(body['customer']).toEqual({ id: 102532808 });
      expect(body['invoice_number']).toBe('220');
    });
  });

  describe('wave_approve_invoice', () => {
    it('PATCHes status=saved', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.patch.mockResolvedValueOnce({ status: 'saved' });
      registerInvoiceTools(stub.server as never, mock.client);
      await stub.invoke('wave_approve_invoice', { invoiceId: 'X' });
      expect(mock.rest.patch).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/invoices/X/`, { status: 'saved' });
    });
  });

  describe('wave_mark_invoice_sent', () => {
    it('PUTs mark-sent with marked_sent sent_via', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.put.mockResolvedValueOnce({});
      registerInvoiceTools(stub.server as never, mock.client);
      await stub.invoke('wave_mark_invoice_sent', { invoiceId: '999' });
      expect(mock.rest.put).toHaveBeenCalledWith(
        `/businesses/${BUSINESS_UUID}/invoices/999/mark-sent/`,
        { sent_via: 'marked_sent' },
      );
    });
  });

  describe('wave_send_invoice', () => {
    it('encodes the invoice ID as a composite Relay ID and forwards the email fields', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.gql.execute.mockResolvedValueOnce({ invoiceSend: { didSucceed: true } });
      registerInvoiceTools(stub.server as never, mock.client);
      await stub.invoke('wave_send_invoice', {
        invoiceId: '2520832016585333081',
        to: ['x@example.com'],
        subject: 'S',
        message: 'M',
        fromAddress: 'me@example.com',
        ccMyself: true,
        attachPDF: true,
        includeAttachments: false,
      });
      const call = mock.gql.execute.mock.calls[0]![0];
      expect(call.query).toBe(INVOICE_SEND_MUTATION);
      expect(call.variables.input).toMatchObject({
        to: ['x@example.com'],
        subject: 'S',
        message: 'M',
        fromAddress: 'me@example.com',
        ccMyself: true,
        attachPDF: true,
        includeAttachments: false,
      });
      const expectedId = Buffer.from(
        `Business:${BUSINESS_UUID};Invoice:2520832016585333081`,
        'utf8',
      ).toString('base64');
      expect(call.variables.input.invoiceId).toBe(expectedId);
    });
  });

  describe('wave_record_invoice_payment', () => {
    it('POSTs the captured payment shape', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.post.mockResolvedValueOnce({ id: 'pid' });
      registerInvoiceTools(stub.server as never, mock.client);
      await stub.invoke('wave_record_invoice_payment', {
        invoiceId: '999',
        amount: 5,
        paymentMethod: 'cash',
        paymentAccountId: 729213109,
        paymentDate: '2026-05-11',
        memo: 'thanks',
      });
      expect(mock.rest.post).toHaveBeenCalledWith(
        `/businesses/${BUSINESS_UUID}/invoices/999/payments/`,
        {
          amount: 5,
          exchange_rate: 1,
          memo: 'thanks',
          payment_account: { id: 729213109 },
          payment_date: '2026-05-11',
          payment_method: 'cash',
        },
      );
    });

    it('defaults memo to null, exchange_rate to 1, date to today, method to bank_transfer', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.post.mockResolvedValueOnce({ id: 'pid' });
      registerInvoiceTools(stub.server as never, mock.client);
      await stub.invoke('wave_record_invoice_payment', {
        invoiceId: '999',
        amount: 7,
        paymentAccountId: 1,
      });
      const body = mock.rest.post.mock.calls[0]![1] as Record<string, unknown>;
      expect(body['exchange_rate']).toBe(1);
      expect(body['memo']).toBeNull();
      expect(body['payment_method']).toBe('bank_transfer');
      expect(body['payment_date']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('wave_delete_invoice_payment', () => {
    it('DELETEs /payments/{paymentId}/', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.delete.mockResolvedValueOnce(undefined);
      registerInvoiceTools(stub.server as never, mock.client);
      const out = (await stub.parsed('wave_delete_invoice_payment', { invoiceId: 'INV', paymentId: 'PAY' })) as {
        ok: boolean;
      };
      expect(mock.rest.delete).toHaveBeenCalledWith(
        `/businesses/${BUSINESS_UUID}/invoices/INV/payments/PAY/`,
      );
      expect(out.ok).toBe(true);
    });
  });

  describe('currency fallback', () => {
    it('falls back to empty symbol when the currency code is not in the lookup', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.post.mockResolvedValueOnce({ id: 'x' });
      registerInvoiceTools(stub.server as never, mock.client);
      await stub.invoke('wave_create_invoice', { customerId: 1, items: [ITEM], currency: 'NZD' });
      const body = mock.rest.post.mock.calls[0]![1] as Record<string, unknown>;
      const cur = body['invoice_currency'] as Record<string, unknown>;
      expect(cur['code']).toBe('NZD');
      expect(cur['symbol']).toBe('');
      expect(cur['name']).toBe('NZD');
    });
  });

  describe('wave_delete_invoice', () => {
    it('DELETEs /invoices/{id}/', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.delete.mockResolvedValueOnce(undefined);
      registerInvoiceTools(stub.server as never, mock.client);
      const out = (await stub.parsed('wave_delete_invoice', { invoiceId: 'INV' })) as { ok: boolean };
      expect(mock.rest.delete).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/invoices/INV/`);
      expect(out.ok).toBe(true);
    });
  });
});
