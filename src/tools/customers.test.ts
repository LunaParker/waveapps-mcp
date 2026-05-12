import { describe, expect, it } from 'vitest';
import { registerCustomerTools } from './customers.js';
import { CUSTOMER_LIST_QUERY } from './_queries.js';
import { CREATE_CUSTOMER_MUTATION, DELETE_CUSTOMER_MUTATION } from './_mutations.js';
import {
  BUSINESS_GLOBAL_ID,
  BUSINESS_UUID,
  createMockClient,
  createStubServer,
} from './_test_utils.js';

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

  it('wave_list_customers fires the verbatim Customer query with Relay business ID', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({
      business: {
        id: BUSINESS_GLOBAL_ID,
        customers: {
          pageInfo: { currentPage: 1, totalPages: 1 },
          edges: [{ node: { id: 'cust1', name: 'A' } }, { node: { id: 'cust2', name: 'B' } }],
        },
      },
    });
    registerCustomerTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_list_customers', { page: 2, pageSize: 50 })) as {
      customers: ReadonlyArray<{ name: string }>;
      pageInfo: { currentPage: number };
    };
    expect(mock.gql.execute).toHaveBeenCalledWith({
      operationName: 'CustomerListListCustomers',
      query: CUSTOMER_LIST_QUERY,
      variables: { businessId: BUSINESS_GLOBAL_ID, page: 2, pageSize: 50 },
    });
    expect(out.customers).toHaveLength(2);
    expect(out.customers[0]!.name).toBe('A');
  });

  it('wave_create_customer builds the canonical input shape', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({
      customerCreate: {
        didSucceed: true,
        inputErrors: null,
        customer: { id: 'gid', internalId: 555, name: 'Test' },
      },
    });
    registerCustomerTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_create_customer', {
      name: 'Test',
      email: 'test@example.com',
    })) as { didSucceed: boolean };
    expect(out.didSucceed).toBe(true);
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
    await expect(stub.invoke('wave_delete_customer', {})).rejects.toThrowError(/customerId/);
    expect(mock.gql.execute).not.toHaveBeenCalled();
  });
});
