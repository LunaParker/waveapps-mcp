import { describe, expect, it } from 'vitest';
import { WaveMutationError } from '../client/errors.js';
import { registerCustomerTools } from './customers.js';
import { CUSTOMER_LIST_QUERY } from './_queries.js';
import { CREATE_CUSTOMER_MUTATION, DELETE_CUSTOMER_MUTATION } from './_mutations.js';
import {
  BUSINESS_GLOBAL_ID,
  createMockClient,
  createStubServer,
} from './_test_utils.js';

const RAW_CUSTOMER = (id: string, name: string, email: string) => ({
  id, internalId: '201', displayId: '', name, firstName: '', lastName: '', email, fax: '', mobile: '', phone: '', tollFree: '',
  website: '', internalNotes: '', currency: { code: 'CAD', symbol: '$', name: 'Canadian dollar', __typename: 'Currency' },
  address: { addressLine1: '', addressLine2: '', city: '', province: null, country: { name: 'Canada', code: 'CA' }, postalCode: '' },
  createdAt: 'x', modifiedAt: 'x', shippingDetails: null,
  outstandingAmount: { value: '0.00', currency: { code: 'CAD' } }, overdueAmount: { value: '0.00', currency: { code: 'CAD' } },
  additionalContacts: [], paymentMethodCards: [{ id: 'card', lastFourDigits: '4242' }], __typename: 'Customer',
});

function listResponse(nodes: unknown[], pageInfo = { currentPage: 1, totalPages: 1 }) {
  return { business: { id: BUSINESS_GLOBAL_ID, customers: { pageInfo, edges: nodes.map((node) => ({ node })) } } };
}

describe('registerCustomerTools', () => {
  it('registers list, create, delete customer tools', () => {
    const stub = createStubServer();
    const mock = createMockClient();
    registerCustomerTools(stub.server as never, mock.client);
    expect([...stub.handlers.keys()].sort()).toEqual([
      'wave_create_customer',
      'wave_delete_customer',
      'wave_list_customers',
    ]);
  });

  it('wave_list_customers fires the verbatim Customer query and returns trimmed customers', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce(listResponse([RAW_CUSTOMER('cust1', 'A', 'a@example.com'), RAW_CUSTOMER('cust2', 'B', 'b@example.com')]));
    registerCustomerTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_list_customers', { page: 2, pageSize: 50 })) as {
      customers: ReadonlyArray<Record<string, unknown>>;
      pageInfo: { currentPage: number };
    };
    expect(mock.gql.execute).toHaveBeenCalledWith({
      operationName: 'CustomerListListCustomers',
      query: CUSTOMER_LIST_QUERY,
      variables: { businessId: BUSINESS_GLOBAL_ID, page: 2, pageSize: 50 },
    });
    expect(out.customers).toHaveLength(2);
    expect(out.customers[0]).toMatchObject({ id: 'cust1', internalId: '201', name: 'A', email: 'a@example.com', currency: 'CAD' });
    expect(out.customers[0]).not.toHaveProperty('paymentMethodCards');
    expect(JSON.stringify(out)).not.toContain('4242');
    expect(out.pageInfo).toEqual({ currentPage: 1, totalPages: 1 });
  });

  it('wave_list_customers search fetches one big page and filters by name or email, case-insensitively', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce(
      listResponse([RAW_CUSTOMER('c1', 'Acme Corp', 'ap@acme.example'), RAW_CUSTOMER('c2', 'Beta LLC', 'hello@beta.example'), RAW_CUSTOMER('c3', 'Gamma', 'acme-fan@gamma.example')]),
    );
    registerCustomerTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_list_customers', { search: 'ACME', page: 3, pageSize: 10 })) as { customers: Array<{ id: string }> };
    expect(mock.gql.execute.mock.calls[0]![0].variables).toEqual({ businessId: BUSINESS_GLOBAL_ID, page: 1, pageSize: 500 });
    expect(out.customers.map((c) => c.id)).toEqual(['c1', 'c3']);
  });

  it('wave_create_customer builds the canonical input shape and returns the trimmed customer', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({
      customerCreate: { didSucceed: true, inputErrors: null, customer: RAW_CUSTOMER('gid', 'Test', 'test@example.com') },
    });
    registerCustomerTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_create_customer', { name: 'Test', email: 'test@example.com' })) as { customer: Record<string, unknown> };
    expect(out.customer).toMatchObject({ id: 'gid', internalId: '201', name: 'Test' });
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.operationName).toBe('CreateCustomer');
    expect(call.query).toBe(CREATE_CUSTOMER_MUTATION);
    expect(call.variables.input.name).toBe('Test');
    expect(call.variables.input.email).toBe('test@example.com');
    expect(call.variables.input.businessId).toBe(BUSINESS_GLOBAL_ID);
    // Empty strings for optional text fields (matches captured shape).
    expect(call.variables.input.firstName).toBe('');
    expect(call.variables.input.currency).toBeNull();
    expect(call.variables.input.address.countryCode).toBeNull();
    expect(call.variables.input.shippingDetails).toBeNull();
  });

  it('wave_create_customer throws WaveMutationError with Wave\'s reason when didSucceed is false', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({
      customerCreate: { didSucceed: false, inputErrors: [{ message: 'A customer with this name already exists.', path: ['name'] }] },
    });
    registerCustomerTools(stub.server as never, mock.client);
    await expect(stub.invoke('wave_create_customer', { name: 'Dup' })).rejects.toThrow(/name: A customer with this name already exists/);
  });

  it('wave_create_customer flows optional fields through', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({ customerCreate: { didSucceed: true } });
    registerCustomerTools(stub.server as never, mock.client);
    await stub.invoke('wave_create_customer', {
      name: 'X',
      firstName: 'Jo',
      currency: 'CAD',
      address: { addressLine1: '1 Test Lane', countryCode: 'CA', provinceCode: 'ON' },
      displayId: 'ACCT-123',
      internalNotes: 'note',
    });
    const input = mock.gql.execute.mock.calls[0]![0].variables.input;
    expect(input.currency).toBe('CAD');
    expect(input.address).toMatchObject({
      addressLine1: '1 Test Lane',
      countryCode: 'CA',
      provinceCode: 'ON',
    });
    expect(input.displayId).toBe('ACCT-123');
    expect(input.internalNotes).toBe('note');
  });

  it('wave_delete_customer encodes a composite Relay ID from integer customerId', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({ customerDelete: { didSucceed: true } });
    registerCustomerTools(stub.server as never, mock.client);
    await stub.invoke('wave_delete_customer', { customerId: 102532808 });
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(DELETE_CUSTOMER_MUTATION);
    expect(call.variables.input.id).toBe(
      'QnVzaW5lc3M6YWFhYWFhYWEtYmJiYi1jY2NjLWRkZGQtZWVlZWVlZWVlZWVlO0N1c3RvbWVyOjEwMjUzMjgwOA==',
    );
  });

  it('wave_delete_customer accepts an explicit Relay ID without rebuilding it', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({ customerDelete: { didSucceed: true } });
    registerCustomerTools(stub.server as never, mock.client);
    await stub.invoke('wave_delete_customer', { customerGlobalId: 'pre-computed' });
    expect(mock.gql.execute.mock.calls[0]![0].variables.input.id).toBe('pre-computed');
  });

  it('wave_delete_customer rejects when neither id form is given', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    registerCustomerTools(stub.server as never, mock.client);
    await expect(stub.invoke('wave_delete_customer', {})).rejects.toThrow(/customerId/);
    expect(mock.gql.execute).not.toHaveBeenCalled();
  });

  it('wave_delete_customer returns ok on success and throws on didSucceed: false', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({ customerDelete: { didSucceed: true } });
    mock.gql.execute.mockResolvedValueOnce({ customerDelete: { didSucceed: false, inputErrors: [{ message: 'Customer has invoices.' }] } });
    registerCustomerTools(stub.server as never, mock.client);
    expect(await stub.parsed('wave_delete_customer', { customerId: 1 })).toEqual({ ok: true });
    await expect(stub.invoke('wave_delete_customer', { customerId: 1 })).rejects.toThrow(WaveMutationError);
  });
});
