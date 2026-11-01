import { describe, expect, it } from 'vitest';
import { registerTransactionTools } from './transactions.js';
import { registerTagTools } from './tags.js';
import { ACCOUNT_IDS_QUERY, GET_TRANSACTION_QUERY, LIST_TAGS_QUERY, LIST_TRANSACTIONS_QUERY } from './_queries.js';
import { CREATE_TAG_MUTATION, CREATE_TRANSACTION_MUTATION, DELETE_TAGS_MUTATION, DELETE_TRANSACTION_MUTATION, PATCH_TRANSACTION_MUTATION } from './_mutations.js';
import { BUSINESS_GLOBAL_ID, BUSINESS_UUID, createMockClient, createStubServer } from './_test_utils.js';

const CASH = 'ACCT_CASH_RELAY';
const SALES = 'ACCT_SALES_RELAY';
const OFFICE = 'ACCT_OFFICE_RELAY';
const ACCOUNTS = {
  business: { id: BUSINESS_GLOBAL_ID, accounts: { edges: [
    { node: { id: CASH, classicId: '101', name: 'Cash on Hand' } },
    { node: { id: SALES, classicId: '401', name: 'Sales' } },
    { node: { id: OFFICE, classicId: '501', name: 'Office Supplies' } },
    { node: { id: 'ACCT_NO_CLASSIC', classicId: null, name: 'Payable' } },
  ] } },
};
const RAW_TX = {
  id: 'TX1', date: '2026-11-01', description: 'Deposit', notes: '', amount: '25', direction: 'DEPOSIT', sequence: 3,
  verificationStatus: 'NOT_VERIFIED', missingFields: [], currency: { code: 'CAD' }, origin: { type: 'MANUAL' },
  anchorLineItem: { order: 0, account: { id: CASH, classicId: '101', name: 'Cash on Hand' }, amount: '25', itemType: 'DEBIT' },
  lineItems: [{ order: 1, account: { id: SALES, classicId: '401', name: 'Sales' }, amount: '25', itemType: 'CREDIT', description: '', customer: null, tags: [{ id: 'TAG1', name: 'Q4' }] }],
};

function setup() {
  const stub = createStubServer();
  const mock = createMockClient();
  registerTransactionTools(stub.server as never, mock.client);
  registerTagTools(stub.server as never, mock.client);
  return { stub, mock };
}

describe('transaction tools', () => {
  it('lists transactions with filters and shapes accounts to wave_list_accounts ids', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ business: { id: BUSINESS_GLOBAL_ID, transactions: { pageInfo: { hasNextPage: false, endCursor: 'c1' }, edges: [{ node: RAW_TX }] } } });
    const out = (await stub.parsed('wave_list_transactions', { startDate: '2026-10-01', description: 'Deposit', after: 'c0' })) as { transactions: unknown[]; pageInfo: unknown };
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(LIST_TRANSACTIONS_QUERY);
    expect(call.variables).toEqual({ businessId: BUSINESS_GLOBAL_ID, first: 25, after: 'c0', filters: { startDate: '2026-10-01', description: 'Deposit' }, sort: ['DATE_DESC'] });
    expect(out.pageInfo).toEqual({ hasNextPage: false, endCursor: 'c1' });
    expect(out.transactions[0]).toEqual({
      id: 'TX1', date: '2026-11-01', description: 'Deposit', notes: '', amount: '25', currency: 'CAD', direction: 'DEPOSIT', sequence: 3,
      verificationStatus: 'NOT_VERIFIED', origin: 'MANUAL', missingFields: [],
      account: { id: 101, relayId: CASH, name: 'Cash on Hand' },
      lines: [{ account: { id: 401, relayId: SALES, name: 'Sales' }, amount: '25', itemType: 'CREDIT', description: '', customer: null, tags: [{ id: 'TAG1', name: 'Q4' }] }],
    });
  });

  it('creates a deposit by debiting the bank account and crediting the category', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce(ACCOUNTS);
    mock.gql.execute.mockResolvedValueOnce({ transactionCreate: { didSucceed: true, transaction: RAW_TX } });
    await stub.invoke('wave_create_transaction', { date: '2026-11-01', description: 'Deposit', amount: '25.00', direction: 'deposit', accountId: 101, categoryAccountId: 401, customerId: 7, tagIds: ['TAG1'] });
    expect(mock.gql.execute.mock.calls[0]![0].query).toBe(ACCOUNT_IDS_QUERY);
    const call = mock.gql.execute.mock.calls[1]![0];
    expect(call.query).toBe(CREATE_TRANSACTION_MUTATION);
    expect(call.variables.input).toEqual({
      businessId: BUSINESS_GLOBAL_ID, date: '2026-11-01', description: 'Deposit',
      anchorLineItem: { category: { type: 'ACCOUNT_ID', accountId: CASH }, amount: '25.00', itemType: 'DEBIT' },
      lineItems: [{
        category: { type: 'ACCOUNT_ID', accountId: SALES }, amount: '25.00', itemType: 'CREDIT', tagIds: ['TAG1'],
        customerId: Buffer.from(`Business:${BUSINESS_UUID};Customer:7`, 'utf8').toString('base64'),
      }],
    });
  });

  it('creates a withdrawal the other way round, and skips the account lookup for relay ids', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ transactionCreate: { didSucceed: true, transaction: RAW_TX } });
    await stub.invoke('wave_create_transaction', { date: '2026-11-01', description: 'Paper', amount: '5', direction: 'withdrawal', accountId: CASH, categoryAccountId: OFFICE });
    expect(mock.gql.execute).toHaveBeenCalledTimes(1);
    const input = mock.gql.execute.mock.calls[0]![0].variables.input;
    expect(input.anchorLineItem.itemType).toBe('CREDIT');
    expect(input.lineItems[0]).toMatchObject({ category: { accountId: OFFICE }, itemType: 'DEBIT' });
  });

  it('matches a system account without a classicId by its unique name', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ business: { id: BUSINESS_GLOBAL_ID, accounts: { edges: [...ACCOUNTS.business.accounts.edges, { node: { id: 'ACCT_FX', classicId: null, name: 'Gain on Foreign Exchange' } }] } } });
    mock.rest.get.mockResolvedValueOnce([{ id: 301, name: 'Gain on Foreign Exchange' }]);
    mock.gql.execute.mockResolvedValueOnce({ transactionCreate: { didSucceed: true, transaction: RAW_TX } });
    await stub.invoke('wave_create_transaction', { date: '2026-11-01', description: 'FX', amount: '1', direction: 'deposit', accountId: 101, categoryAccountId: 301 });
    expect(mock.gql.execute.mock.calls[1]![0].variables.input.lineItems[0].category.accountId).toBe('ACCT_FX');
  });

  it('rejects an account id wave_list_accounts would not give', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce(ACCOUNTS);
    mock.rest.get.mockResolvedValueOnce([]);
    await expect(stub.invoke('wave_create_transaction', { date: '2026-11-01', description: 'x', amount: '1', direction: 'deposit', accountId: 999, categoryAccountId: 401 })).rejects.toThrow(/No active account with id 999/);
  });

  it('updates the description with the current sequence and leaves the lines alone', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ business: { id: BUSINESS_GLOBAL_ID, transaction: RAW_TX } });
    mock.gql.execute.mockResolvedValueOnce({ transactionPatch: { didSucceed: true, transaction: RAW_TX } });
    await stub.invoke('wave_update_transaction', { transactionId: 'TX1', description: 'Renamed' });
    expect(mock.gql.execute.mock.calls[0]![0].query).toBe(GET_TRANSACTION_QUERY);
    const call = mock.gql.execute.mock.calls[1]![0];
    expect(call.query).toBe(PATCH_TRANSACTION_MUTATION);
    expect(call.variables.input).toEqual({ id: 'TX1', sequence: 3, description: 'Renamed' });
  });

  it('rebuilds the single line, keeping its tags, when the amount changes', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ business: { id: BUSINESS_GLOBAL_ID, transaction: RAW_TX } });
    mock.gql.execute.mockResolvedValueOnce({ transactionPatch: { didSucceed: true, transaction: RAW_TX } });
    await stub.invoke('wave_update_transaction', { transactionId: 'TX1', amount: '30.00' });
    expect(mock.gql.execute.mock.calls[1]![0].variables.input).toEqual({
      id: 'TX1', sequence: 3,
      lineItems: [{ order: 1, category: { type: 'ACCOUNT_ID', accountId: SALES }, amount: '30.00', itemType: 'CREDIT', tagIds: ['TAG1'] }],
      anchorLineItem: { order: 0, category: { type: 'ACCOUNT_ID', accountId: CASH }, amount: '30.00', itemType: 'DEBIT' },
    });
  });

  it('refuses line changes on a split transaction', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ business: { id: BUSINESS_GLOBAL_ID, transaction: { ...RAW_TX, lineItems: [RAW_TX.lineItems[0], RAW_TX.lineItems[0]] } } });
    await expect(stub.invoke('wave_update_transaction', { transactionId: 'TX1', tagIds: [] })).rejects.toThrow(/exactly one category line/);
  });

  it('deletes with the given sequence without reading first', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ transactionDelete: { didSucceed: true, deletedTransactionIds: ['TX1'] } });
    const out = await stub.parsed('wave_delete_transaction', { transactionId: 'TX1', sequence: 4 });
    expect(mock.gql.execute.mock.calls[0]![0].query).toBe(DELETE_TRANSACTION_MUTATION);
    expect(mock.gql.execute.mock.calls[0]![0].variables.input).toEqual({ id: 'TX1', sequence: 4 });
    expect(out).toEqual({ ok: true, deletedTransactionIds: ['TX1'] });
  });
});

describe('tag tools', () => {
  it('lists tags with the page-number pagination Wave wants', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ accountingTags: { edges: [{ node: { id: 'TAG1', name: 'Q4', description: '', archived: false, group: { id: 'G', name: 'Quarters' } } }], pageInfo: { currentPage: 1, totalPages: 1 } } });
    const out = await stub.parsed('wave_list_tags', {});
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(LIST_TAGS_QUERY);
    expect(call.variables).toEqual({ businessId: BUSINESS_GLOBAL_ID, pagination: { pageNumber: 1, resultsPerPage: 100 } });
    expect(out).toEqual({ tags: [{ id: 'TAG1', name: 'Q4', description: '', archived: false, group: 'Quarters' }], pageInfo: { currentPage: 1, totalPages: 1 } });
  });

  it('creates and deletes a tag', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ createAccountingTag: { didSucceed: true, tag: { id: 'TAG2', name: 'Trip', description: null, archived: false } } });
    mock.gql.execute.mockResolvedValueOnce({ deleteAccountingTags: { didSucceed: true } });
    expect(await stub.parsed('wave_create_tag', { name: 'Trip' })).toEqual({ tag: { id: 'TAG2', name: 'Trip', description: null, archived: false, group: null } });
    expect(mock.gql.execute.mock.calls[0]![0].query).toBe(CREATE_TAG_MUTATION);
    await stub.invoke('wave_delete_tag', { tagId: 'TAG2' });
    expect(mock.gql.execute.mock.calls[1]![0].query).toBe(DELETE_TAGS_MUTATION);
    expect(mock.gql.execute.mock.calls[1]![0].variables.input).toEqual({ businessId: BUSINESS_GLOBAL_ID, tagIds: ['TAG2'] });
  });
});
