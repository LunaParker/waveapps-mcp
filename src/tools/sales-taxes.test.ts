import { describe, expect, it } from 'vitest';
import { registerSalesTaxTools } from './sales-taxes.js';
import { SALES_TAXES_QUERY } from './_queries.js';
import { BUSINESS_GLOBAL_ID, BUSINESS_UUID, createMockClient, createStubServer } from './_test_utils.js';

const RELAY = Buffer.from(`Business:${BUSINESS_UUID};SalesTax:401`, 'utf8').toString('base64');
const RAW_TAX = {
  id: RELAY, name: 'Harmonized Sales Tax', abbreviation: 'HST', description: '', rate: '0.13', isArchived: false,
  isCompound: false, isRecoverable: true, taxNumber: 'TEST_TAX_NUMBER', showTaxNumberOnInvoices: true,
  rates: [{ effective: '0001-01-01', rate: '0.13' }],
};
const PAGE_INFO = { currentPage: 1, totalPages: 1, totalCount: 1 };

function setup() {
  const stub = createStubServer();
  const mock = createMockClient();
  mock.gql.execute.mockResolvedValueOnce({ business: { id: BUSINESS_GLOBAL_ID, salesTaxes: { pageInfo: PAGE_INFO, edges: [{ node: RAW_TAX }] } } });
  registerSalesTaxTools(stub.server as never, mock.client);
  return { stub, mock };
}

describe('registerSalesTaxTools', () => {
  it('registers wave_list_sales_taxes', () => {
    const stub = createStubServer();
    registerSalesTaxTools(stub.server as never, createMockClient().client);
    expect([...stub.handlers.keys()]).toEqual(['wave_list_sales_taxes']);
  });

  it('lists active taxes with the integer id the invoice and estimate tools take', async () => {
    const { stub, mock } = setup();
    const out = await stub.parsed('wave_list_sales_taxes', {});
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.operationName).toBe('ListSalesTaxes');
    expect(call.query).toBe(SALES_TAXES_QUERY);
    expect(call.variables).toEqual({ businessId: BUSINESS_GLOBAL_ID, page: 1, pageSize: 100, isArchived: false });
    expect(out).toEqual({
      salesTaxes: [{
        id: 401, relayId: RELAY, name: 'Harmonized Sales Tax', abbreviation: 'HST', description: '', rate: 0.13,
        rates: [{ effective: '0001-01-01', rate: 0.13 }], isArchived: false, isCompound: false, isRecoverable: true,
        taxNumber: 'TEST_TAX_NUMBER', showTaxNumberOnInvoices: true,
      }],
      pageInfo: PAGE_INFO,
    });
  });

  it('asks for archived taxes too when includeArchived is set', async () => {
    const { stub, mock } = setup();
    await stub.invoke('wave_list_sales_taxes', { includeArchived: true, pageSize: 10 });
    const variables = mock.gql.execute.mock.calls[0]![0].variables;
    expect(variables.isArchived).toBeNull();
    expect(variables.pageSize).toBe(10);
  });
});
