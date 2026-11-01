import { describe, expect, it } from 'vitest';
import { registerBillTools } from './bills.js';
import { BILLS_QUERY } from './_queries.js';
import { BUSINESS_GLOBAL_ID, createMockClient, createStubServer } from './_test_utils.js';

const RAW_BILL = {
  id: 'bill1', billerId: 'vendor1', dueDate: '2026-02-20', billDate: '2026-02-01',
  currency: { name: 'Canadian dollar', code: 'CAD', symbol: '$', exponent: 2, __typename: 'Currency' },
  amountDue: '50.00', amountPaid: '0.00', subtotal: '44.25', total: '50.00', billNumber: 'B-9', vendorIsContractor: false,
  linkedToPayroll: false, eligibleForDirectDeposit: false, payrollId: null, depositStatus: null, paymentStatus: 'UNPAID',
  linkedToTaxForm: false, vendorPayrollId: null, checkPayrollId: null, __typename: 'Bill',
};

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
          pageInfo: { totalCount: 1 },
          edges: [{ node: RAW_BILL }],
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
    expect(out).toEqual({
      bills: [{ id: 'bill1', billNumber: 'B-9', billDate: '2026-02-01', dueDate: '2026-02-20', currency: 'CAD', subtotal: '44.25', total: '50.00', amountDue: '50.00', amountPaid: '0.00', paymentStatus: 'UNPAID', vendorId: 'vendor1', vendorIsContractor: false }],
      totalCount: 1,
    });
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
