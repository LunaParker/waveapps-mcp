import { describe, expect, it } from 'vitest';
import { registerPaymentTools } from './payments.js';
import { todayIso } from '../util/dates.js';
import { BUSINESS_UUID, createMockClient, createStubServer } from './_test_utils.js';

const RAW_PAYMENT = {
  id: '9000000000000000002', url: 'pay', payment_date: '2026-01-20', memo: 'thanks', exchange_rate: 1, amount: 5,
  payment_account: { id: 302, url: 'u', name: 'Cash on Hand', active: true, account_type: 'asset', is_payment: true, currency: { code: 'CAD' } },
  payment_method: 'cash', payment_details: {}, date_created: 'x', date_modified: 'x', readonly_url: 'r', api_origin: null, origin: 'manual', next_acct_transaction: null,
};

describe('registerPaymentTools', () => {
  it('registers both payment tools', () => {
    const stub = createStubServer();
    registerPaymentTools(stub.server as never, createMockClient().client);
    expect([...stub.handlers.keys()].sort()).toEqual(['wave_delete_invoice_payment', 'wave_record_invoice_payment']);
  });

  describe('wave_record_invoice_payment', () => {
    it('POSTs the captured payment shape and returns the trimmed payment', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.post.mockResolvedValueOnce(RAW_PAYMENT);
      registerPaymentTools(stub.server as never, mock.client);
      const out = (await stub.parsed('wave_record_invoice_payment', {
        invoiceId: '999',
        amount: 5,
        paymentMethod: 'cash',
        paymentAccountId: 302,
        paymentDate: '2026-01-20',
        memo: 'thanks',
      })) as { payment: unknown };
      expect(mock.rest.post).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/invoices/999/payments/`, {
        amount: 5,
        exchange_rate: 1,
        memo: 'thanks',
        payment_account: { id: 302 },
        payment_date: '2026-01-20',
        payment_method: 'cash',
      });
      expect(out.payment).toEqual({
        id: '9000000000000000002',
        payment_date: '2026-01-20',
        amount: 5,
        payment_method: 'cash',
        memo: 'thanks',
        exchange_rate: 1,
        payment_account: { id: 302, name: 'Cash on Hand' },
      });
    });

    it('defaults memo to null, exchange_rate to 1, the date to the local today and the method to bank_transfer', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.post.mockResolvedValueOnce(RAW_PAYMENT);
      registerPaymentTools(stub.server as never, mock.client);
      await stub.invoke('wave_record_invoice_payment', { invoiceId: '999', amount: 7, paymentAccountId: 1 });
      const body = mock.rest.post.mock.calls[0]![1] as Record<string, unknown>;
      expect(body['exchange_rate']).toBe(1);
      expect(body['memo']).toBeNull();
      expect(body['payment_method']).toBe('bank_transfer');
      expect(body['payment_date']).toBe(todayIso());
    });
  });

  describe('wave_delete_invoice_payment', () => {
    it('DELETEs /payments/{paymentId}/ and url-encodes both ids', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.delete.mockResolvedValueOnce(undefined);
      registerPaymentTools(stub.server as never, mock.client);
      const out = (await stub.parsed('wave_delete_invoice_payment', { invoiceId: 'INV', paymentId: 'PAY' })) as { ok: boolean };
      expect(mock.rest.delete).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/invoices/INV/payments/PAY/`);
      expect(out.ok).toBe(true);
    });
  });
});
