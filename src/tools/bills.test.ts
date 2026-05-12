import { describe, expect, it } from 'vitest';
import { registerBillTools } from './bills.js';
import { BILLS_QUERY } from './_queries.js';
import { BUSINESS_GLOBAL_ID, createMockClient, createStubServer } from './_test_utils.js';

describe('registerBillTools', () => {
  it('registers wave_list_bills', () => {
    const stub = createStubServer();
    const mock = createMockClient();
    registerBillTools(stub.server as never, mock.client);
    expect([...stub.handlers.keys()]).toEqual(['wave_list_bills']);
  });

  it('fires ListBills with defaults', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({
      business: {
        id: BUSINESS_GLOBAL_ID,
        bills: {
          pageInfo: { totalCount: 0 },
          edges: [],
          businessSupportsContractorPayments: false,
        },
      },
    });
    registerBillTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_list_bills', {})) as Record<string, unknown>;
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.operationName).toBe('ListBills');
    expect(call.query).toBe(BILLS_QUERY);
    expect(call.variables.businessId).toBe(BUSINESS_GLOBAL_ID);
    expect(call.variables.sort).toBe('BILL_DATE_DESC');
    expect(call.variables.page).toBe(1);
    expect(call.variables.pageSize).toBe(25);
    expect(out).toHaveProperty('bills');
    expect(out).toHaveProperty('totalCount', 0);
  });

  it('flows optional vendor + date filters', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({
      business: { id: BUSINESS_GLOBAL_ID, bills: { pageInfo: { totalCount: 0 }, edges: [], businessSupportsContractorPayments: false } },
    });
    registerBillTools(stub.server as never, mock.client);
    await stub.invoke('wave_list_bills', {
      vendorId: 'VENDOR_GID',
      billDateStart: '2026-01-01',
      billDateEnd: '2026-05-11',
      sort: 'DUE_DATE_ASC',
    });
    const variables = mock.gql.execute.mock.calls[0]![0].variables;
    expect(variables.vendorId).toBe('VENDOR_GID');
    expect(variables.billDateStart).toBe('2026-01-01');
    expect(variables.billDateEnd).toBe('2026-05-11');
    expect(variables.sort).toBe('DUE_DATE_ASC');
  });
});
