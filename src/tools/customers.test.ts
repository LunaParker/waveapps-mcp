import { describe, expect, it } from 'vitest';
import { WaveMutationError } from '../client/errors.js';
import { provinceCode, registerCustomerTools } from './customers.js';
import { CUSTOMER_LIST_QUERY, GET_CUSTOMER_QUERY } from './_queries.js';
import { CREATE_CUSTOMER_MUTATION, DELETE_CUSTOMER_MUTATION, PATCH_CUSTOMER_MUTATION } from './_mutations.js';
import {
  BUSINESS_GLOBAL_ID,
  BUSINESS_UUID,
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
  it('registers list, get, create, update, delete customer tools', () => {
    const stub = createStubServer();
    const mock = createMockClient();
    registerCustomerTools(stub.server as never, mock.client);
    expect([...stub.handlers.keys()].sort()).toEqual([
      'wave_create_customer',
      'wave_delete_customer',
      'wave_get_customer',
      'wave_list_customers',
      'wave_update_customer',
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

  it('wave_list_customers search walks every page and filters by name or email, case-insensitively', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute
      .mockResolvedValueOnce(listResponse([RAW_CUSTOMER('c1', 'Acme Corp', 'ap@acme.example'), RAW_CUSTOMER('c2', 'Beta LLC', 'hello@beta.example')], { currentPage: 1, totalPages: 2 }))
      .mockResolvedValueOnce(listResponse([RAW_CUSTOMER('c3', 'Gamma', 'acme-fan@gamma.example')], { currentPage: 2, totalPages: 2 }));
    registerCustomerTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_list_customers', { search: 'ACME', page: 3, pageSize: 10 })) as {
      customers: Array<{ id: string }>; pageInfo: unknown; matched: number; searchedAllPages: boolean;
    };
    expect(mock.gql.execute.mock.calls.map((c) => c[0].variables)).toEqual([
      { businessId: BUSINESS_GLOBAL_ID, page: 1, pageSize: 500 },
      { businessId: BUSINESS_GLOBAL_ID, page: 2, pageSize: 500 },
    ]);
    expect(out.customers.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(out.matched).toBe(2);
    expect(out.searchedAllPages).toBe(true);
    expect(out.pageInfo).toEqual({ currentPage: 1, totalPages: 2 });
  });

  it('wave_list_customers search stops after ten pages and says so', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    for (let page = 1; page <= 10; page += 1) {
      mock.gql.execute.mockResolvedValueOnce(listResponse([], { currentPage: page, totalPages: 12 }));
    }
    registerCustomerTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_list_customers', { search: 'nobody' })) as { customers: unknown[]; searchedAllPages: boolean };
    expect(mock.gql.execute).toHaveBeenCalledTimes(10);
    expect(out.customers).toEqual([]);
    expect(out.searchedAllPages).toBe(false);
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
      provinceCode: 'CA-ON',
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

describe('provinceCode', () => {
  it('turns a bare province into the ISO 3166-2 code Wave accepts', () => {
    expect(provinceCode('on', 'ca')).toBe('CA-ON');
    expect(provinceCode('CA-ON', 'CA')).toBe('CA-ON');
    expect(provinceCode('ON', undefined)).toBe('ON');
    expect(provinceCode(undefined, 'CA')).toBe('');
  });
});

describe('wave_get_customer and wave_update_customer', () => {
  const CUSTOMER_ID = Buffer.from(`Business:${BUSINESS_UUID};Customer:201`, 'utf8').toString('base64');
  const STORED = {
    ...RAW_CUSTOMER(CUSTOMER_ID, 'Stored Co', 'stored@example.com'),
    address: { addressLine1: '1 Old St', addressLine2: 'Unit 2', city: 'Toronto', province: { code: 'CA-ON', name: 'Ontario' }, country: { code: 'CA', name: 'Canada' }, postalCode: 'M5V 1A1' },
    shippingDetails: { name: 'Dock', instructions: 'Back door', phone: '555', address: { addressLine1: '9 Dock Rd', addressLine2: '', city: 'Guelph', province: { code: 'CA-ON' }, country: { code: 'CA' }, postalCode: 'N1H 1A1' } },
    additionalContacts: [{ id: 'contact1', name: 'Old Contact', email: 'old@example.com', phone: '' }],
  };
  function setup() {
    const stub = createStubServer();
    const mock = createMockClient();
    registerCustomerTools(stub.server as never, mock.client);
    return { stub, mock };
  }

  it('wave_get_customer reads one customer by integer id', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ business: { id: BUSINESS_GLOBAL_ID, customer: STORED } });
    const out = (await stub.parsed('wave_get_customer', { customerId: 201 })) as { customer: Record<string, unknown> };
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(GET_CUSTOMER_QUERY);
    expect(call.variables).toEqual({ businessId: BUSINESS_GLOBAL_ID, customerId: CUSTOMER_ID });
    expect(out.customer).toMatchObject({ name: 'Stored Co', address: { city: 'Toronto', province: 'CA-ON' } });
  });

  it('wave_update_customer sends back the stored address and shipping details, which Wave would otherwise clear', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ business: { id: BUSINESS_GLOBAL_ID, customer: STORED } });
    mock.gql.execute.mockResolvedValueOnce({ customerPatch: { didSucceed: true, customer: STORED } });
    await stub.invoke('wave_update_customer', { customerId: 201, internalNotes: 'new note', address: { city: 'Guelph' } });
    const patch = mock.gql.execute.mock.calls[1]![0];
    expect(patch.query).toBe(PATCH_CUSTOMER_MUTATION);
    expect(patch.variables.input).toEqual({
      id: CUSTOMER_ID,
      internalNotes: 'new note',
      address: { addressLine1: '1 Old St', addressLine2: 'Unit 2', city: 'Guelph', provinceCode: 'CA-ON', countryCode: 'CA', postalCode: 'M5V 1A1' },
      shippingDetails: {
        name: 'Dock', phone: '555', instructions: 'Back door',
        address: { addressLine1: '9 Dock Rd', addressLine2: '', city: 'Guelph', provinceCode: 'CA-ON', countryCode: 'CA', postalCode: 'N1H 1A1' },
      },
    });
  });

  it('replaces additional contacts by deleting the stored ones and adding the new list', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ business: { id: BUSINESS_GLOBAL_ID, customer: STORED } });
    mock.gql.execute.mockResolvedValueOnce({ customerPatch: { didSucceed: true, customer: STORED } });
    await stub.invoke('wave_update_customer', { customerId: 201, additionalContacts: [{ name: 'New Contact', email: 'new@example.com' }], shippingDetails: null });
    const input = mock.gql.execute.mock.calls[1]![0].variables.input;
    expect(input.additionalContacts).toEqual([{ id: 'contact1' }, { name: 'New Contact', email: 'new@example.com', phone: '' }]);
    expect(input.shippingDetails).toBeNull();
  });

  it('skips the read when the full address and shipping details are given', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ customerPatch: { didSucceed: true, customer: STORED } });
    await stub.invoke('wave_update_customer', {
      customerGlobalId: CUSTOMER_ID,
      address: { addressLine1: 'a', addressLine2: '', city: 'c', provinceCode: 'ON', countryCode: 'CA', postalCode: 'p' },
      shippingDetails: null,
    });
    expect(mock.gql.execute).toHaveBeenCalledTimes(1);
    expect(mock.gql.execute.mock.calls[0]![0].variables.input.address.provinceCode).toBe('CA-ON');
  });

  it('surfaces a refused update as a WaveMutationError', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ business: { id: BUSINESS_GLOBAL_ID, customer: STORED } });
    mock.gql.execute.mockResolvedValueOnce({ customerPatch: { didSucceed: false, inputErrors: [{ message: 'This is not a valid choice.', path: ['input', 'address', 'provinceCode'] }] } });
    await expect(stub.invoke('wave_update_customer', { customerId: 201, name: 'X' })).rejects.toThrow(WaveMutationError);
  });
});
