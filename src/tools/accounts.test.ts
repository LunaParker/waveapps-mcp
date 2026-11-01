import { describe, expect, it } from 'vitest';
import { registerAccountTools } from './accounts.js';
import { BUSINESS_UUID, createMockClient, createStubServer } from './_test_utils.js';

const CURRENCY = { url: 'u', code: 'CAD', symbol: '$', name: 'Canadian dollar', plural: null };
const RAW_ACCOUNTS = [
  { id: 301, url: 'u', name: 'Consulting Income', active: true, account_template_id: 7, account_type: 'income', system_account: null, is_payment: false, can_delete: true, currency: CURRENCY, is_currency_editable: false, is_name_editable: true, is_payment_editable: false, date_created: 'x', date_modified: 'x' },
  { id: 302, url: 'u', name: 'Cash on Hand', active: true, account_template_id: 8, account_type: 'asset', system_account: null, is_payment: true, can_delete: false, currency: CURRENCY, is_currency_editable: false, is_name_editable: true, is_payment_editable: false, date_created: 'x', date_modified: 'x' },
];

describe('wave_list_accounts', () => {
  it('registers under its old name', () => {
    const stub = createStubServer();
    registerAccountTools(stub.server as never, createMockClient().client);
    expect([...stub.handlers.keys()]).toEqual(['wave_list_accounts']);
  });

  it('hits /accounts/ with active_only and returns trimmed accounts', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.rest.get.mockResolvedValueOnce(RAW_ACCOUNTS);
    registerAccountTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_list_accounts', { activeOnly: true })) as { accounts: unknown[] };
    expect(mock.rest.get).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/accounts/`, { active_only: true });
    expect(out.accounts).toEqual([
      { id: 301, name: 'Consulting Income', account_type: 'income', is_payment: false, active: true, currency: 'CAD' },
      { id: 302, name: 'Cash on Hand', account_type: 'asset', is_payment: true, active: true, currency: 'CAD' },
    ]);
  });

  it('filters by accountType on the client side', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.rest.get.mockResolvedValueOnce(RAW_ACCOUNTS);
    registerAccountTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_list_accounts', { accountType: 'income' })) as { accounts: Array<{ id: number }> };
    expect(out.accounts.map((a) => a.id)).toEqual([301]);
  });

  it('returns an empty list when Wave sends something that is not an array', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.rest.get.mockResolvedValueOnce({ detail: 'odd' });
    registerAccountTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_list_accounts', {})) as { accounts: unknown[] };
    expect(out.accounts).toEqual([]);
  });
});
