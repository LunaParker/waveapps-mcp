import { describe, expect, it } from 'vitest';
import { registerReceiptTools } from './receipts.js';
import { TRANSACTIONS_QUERY } from './_queries.js';
import { BUSINESS_GLOBAL_ID, createMockClient, createStubServer } from './_test_utils.js';

describe('registerReceiptTools', () => {
  it('registers wave_list_receipts', () => {
    const stub = createStubServer();
    const mock = createMockClient();
    registerReceiptTools(stub.server as never, mock.client);
    expect([...stub.handlers.keys()]).toEqual(['wave_list_receipts']);
  });

  it('fires GetTransactions with RECEIPT_CAPTURE filter and default sort', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({
      business: { id: BUSINESS_GLOBAL_ID, roles: ['ADMIN'], transactions: { edges: [{ node: { id: 'r1' } }] } },
    });
    registerReceiptTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_list_receipts', {})) as {
      receipts: ReadonlyArray<{ id: string }>;
      roles: ReadonlyArray<string>;
    };
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.operationName).toBe('GetTransactions');
    expect(call.query).toBe(TRANSACTIONS_QUERY);
    expect(call.variables.businessId).toBe(BUSINESS_GLOBAL_ID);
    expect(call.variables.filters).toEqual({ originType: 'RECEIPT_CAPTURE' });
    expect(call.variables.first).toBe(25);
    expect(call.variables.sort).toEqual(['DATE_CREATED_DESC']);
    expect(out.receipts).toEqual([{ id: 'r1' }]);
    expect(out.roles).toEqual(['ADMIN']);
  });

  it('honours `first` and `sort` overrides', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({
      business: { id: BUSINESS_GLOBAL_ID, roles: [], transactions: { edges: [] } },
    });
    registerReceiptTools(stub.server as never, mock.client);
    await stub.invoke('wave_list_receipts', { first: 50, sort: 'DATE_CREATED_ASC' });
    const variables = mock.gql.execute.mock.calls[0]![0].variables;
    expect(variables.first).toBe(50);
    expect(variables.sort).toEqual(['DATE_CREATED_ASC']);
  });
});
