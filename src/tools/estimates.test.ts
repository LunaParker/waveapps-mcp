import { describe, expect, it } from 'vitest';
import { registerEstimateTools } from './estimates.js';
import { ESTIMATES_QUERY } from './_queries.js';
import {
  CREATE_ESTIMATE_MUTATION,
  DELETE_ESTIMATE_MUTATION,
  PATCH_ESTIMATE_MUTATION,
} from './_mutations.js';
import {
  BUSINESS_GLOBAL_ID,
  BUSINESS_UUID,
  createMockClient,
  createStubServer,
} from './_test_utils.js';
import { WaveMutationError } from '../client/errors.js';
import { addDays, todayIso } from '../util/dates.js';

const ITEM = {
  productId: 133995046,
  name: 'Test line',
  unitPrice: '1.00',
  quantity: '1',
  incomeAccountClassicId: '729213118',
  taxIds: [],
};

const UPDATE_ARGS = {
  estimateGlobalId: 'EST_REL',
  customerId: 1,
  items: [ITEM],
  estimateNumber: '12',
  estimateDate: '2026-05-11',
  dueDate: '2026-06-10',
};

const RAW_ESTIMATE = (id: string, number: string, status: string) => ({
  id, status, estimateDate: '2026-02-01', estimateNumber: number, dueDate: '2026-03-03',
  currency: { code: 'CAD', symbol: '$', __typename: 'Currency' }, exchangeRate: '1',
  amountDue: { value: '226.00', currency: { code: 'CAD' } }, total: { minorUnitValue: 22600, value: '226.00', currency: { code: 'CAD' } },
  customer: { id: 'cust', name: 'Example Co', firstName: 'Ex', lastName: 'Ample', email: 'billing@example.com', __typename: 'Customer' },
  lastSentAt: null, lastSentVia: null, viewUrl: 'https://example.com/est', amountPaid: { value: '0.00' },
  depositStatus: 'DISABLED', depositValue: null, depositUnit: null, depositPaymentStatus: null, __typename: 'AREstimate',
});

function estimatesResponse(all: unknown[], pageInfo = { currentPage: 1, totalCount: all.length, totalPages: 1 }) {
  const bucket = (nodes: unknown[]) => ({ edges: nodes.map((node) => ({ node })), pageInfo });
  return { business: { id: BUSINESS_GLOBAL_ID, allEstimates: bucket(all), draftEstimates: bucket([]), activeEstimates: bucket([]) } };
}

describe('registerEstimateTools', () => {
  it('registers list, create, update, delete tools', () => {
    const stub = createStubServer();
    const mock = createMockClient();
    registerEstimateTools(stub.server as never, mock.client);
    expect([...stub.handlers.keys()].sort()).toEqual([
      'wave_create_estimate',
      'wave_delete_estimate',
      'wave_list_estimates',
      'wave_update_estimate',
    ]);
  });

  it('wave_list_estimates fires GetEstimates with the fixed bucket statuses and returns one trimmed list', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    const relayId = Buffer.from(`Business:${BUSINESS_UUID};Estimate:808`, 'utf8').toString('base64');
    mock.gql.execute.mockResolvedValueOnce(estimatesResponse([RAW_ESTIMATE(relayId, '12', 'DRAFT')]));
    registerEstimateTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_list_estimates', {})) as { estimates: Array<Record<string, unknown>>; pageInfo: unknown };
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.operationName).toBe('GetEstimates');
    expect(call.query).toBe(ESTIMATES_QUERY);
    expect(call.variables).toMatchObject({ businessId: BUSINESS_GLOBAL_ID, sort: 'ESTIMATE_DATE_DESC', activeStatus: 'ACTIVE', draftStatus: 'DRAFT', allStatus: undefined });
    expect(out.estimates).toEqual([
      {
        id: relayId, internalId: '808', estimateNumber: '12', status: 'DRAFT', estimateDate: '2026-02-01', dueDate: '2026-03-03',
        currency: 'CAD', exchangeRate: '1', total: '226.00', amountDue: '226.00', amountPaid: '0.00',
        customer: { id: 'cust', name: 'Example Co', email: 'billing@example.com' },
        lastSentAt: null, lastSentVia: null, viewUrl: 'https://example.com/est',
        depositStatus: 'DISABLED', depositValue: null, depositUnit: null, depositPaymentStatus: null,
      },
    ]);
    expect(out.pageInfo).toEqual({ currentPage: 1, totalCount: 1, totalPages: 1 });
    expect(out).not.toHaveProperty('active');
  });

  it('wave_list_estimates sends a status filter as allStatus', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce(estimatesResponse([]));
    registerEstimateTools(stub.server as never, mock.client);
    await stub.invoke('wave_list_estimates', { status: 'EXPIRED' });
    expect(mock.gql.execute.mock.calls[0]![0].variables.allStatus).toBe('EXPIRED');
  });

  it('wave_create_estimate encodes customerId and productId as composite Relay IDs', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({
      estimateCreate: { didSucceed: true, estimate: { id: 'eid', estimateNumber: '1' } },
    });
    registerEstimateTools(stub.server as never, mock.client);
    await stub.invoke('wave_create_estimate', { customerId: 102532808, items: [ITEM], estimateNumber: '1', currency: 'CAD' });
    const input = mock.gql.execute.mock.calls[0]![0].variables.input;
    expect(input.businessId).toBe(BUSINESS_GLOBAL_ID);
    expect(input.customerId).toBe(
      'QnVzaW5lc3M6YWFhYWFhYWEtYmJiYi1jY2NjLWRkZGQtZWVlZWVlZWVlZWVlO0N1c3RvbWVyOjEwMjUzMjgwOA==',
    );
    expect(input.items).toHaveLength(1);
    const productGlobalId = Buffer.from(`Business:${BUSINESS_UUID};Product:${ITEM.productId}`, 'utf8').toString('base64');
    expect(input.items[0].productId).toBe(productGlobalId);
    expect(input.items[0].unitPrice).toBe('1.00');
    expect(input.items[0].quantity).toBe('1');
    expect(input.items[0].taxes).toEqual([]);
  });

  it('wave_create_estimate takes the next number, the business currency and a 30-day validity when omitted', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce(estimatesResponse([RAW_ESTIMATE('e1', '9', 'SENT'), RAW_ESTIMATE('e2', '12', 'DRAFT'), RAW_ESTIMATE('e3', 'Q-7', 'DRAFT')]));
    mock.gql.execute.mockResolvedValueOnce({ estimateCreate: { didSucceed: true, estimate: { id: 'x', estimateNumber: '13' } } });
    mock.rest.get.mockResolvedValueOnce({ id: BUSINESS_UUID, primary_currency: { code: 'NZD' } });
    registerEstimateTools(stub.server as never, mock.client);
    const out = await stub.parsed('wave_create_estimate', { customerId: 1, items: [ITEM] });
    const listCall = mock.gql.execute.mock.calls[0]![0];
    expect(listCall.operationName).toBe('GetEstimates');
    expect(listCall.variables).toMatchObject({ sort: 'ESTIMATE_NUMBER_DESC', page: 1, pageSize: 50 });
    expect(mock.rest.get).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/`);
    const input = mock.gql.execute.mock.calls[1]![0].variables.input;
    expect(input.estimateNumber).toBe('13');
    expect(input.currency).toBe('NZD');
    expect(input.estimateDate).toBe(todayIso());
    expect(input.dueDate).toBe(addDays(todayIso(), 30));
    expect(input.title).toBe('Estimate');
    expect(input.itemTitle).toBe('Services');
    expect(out).toEqual({ estimate: { id: 'x', estimateNumber: '13' } });
  });

  it('wave_create_estimate starts at 1 when there are no estimates and skips the reads when the caller supplies number and currency', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce(estimatesResponse([]));
    mock.gql.execute.mockResolvedValueOnce({ estimateCreate: { didSucceed: true, estimate: { id: 'x', estimateNumber: '1' } } });
    mock.gql.execute.mockResolvedValueOnce({ estimateCreate: { didSucceed: true, estimate: { id: 'y', estimateNumber: '77' } } });
    mock.rest.get.mockResolvedValueOnce({ primary_currency: { code: 'CAD' } });
    registerEstimateTools(stub.server as never, mock.client);
    await stub.invoke('wave_create_estimate', { customerId: 1, items: [ITEM] });
    expect(mock.gql.execute.mock.calls[1]![0].variables.input.estimateNumber).toBe('1');
    await stub.invoke('wave_create_estimate', { customerId: 1, items: [ITEM], estimateNumber: '77', currency: 'CAD', dueDate: '2026-12-31' });
    expect(mock.gql.execute).toHaveBeenCalledTimes(3);
    expect(mock.rest.get).toHaveBeenCalledTimes(1);
    expect(mock.gql.execute.mock.calls[2]![0].variables.input).toMatchObject({ estimateNumber: '77', currency: 'CAD', dueDate: '2026-12-31' });
  });

  it('wave_create_estimate asks for an explicit number when existing numbers are not integers', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce(estimatesResponse([RAW_ESTIMATE('e1', 'Q-7', 'SENT')]));
    mock.rest.get.mockResolvedValueOnce({ primary_currency: { code: 'CAD' } });
    registerEstimateTools(stub.server as never, mock.client);
    await expect(stub.invoke('wave_create_estimate', { customerId: 1, items: [ITEM] })).rejects.toThrow(/estimateNumber/);
  });

  it('estimate mutations throw WaveMutationError with Wave\'s reason on didSucceed: false', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({ estimateCreate: { didSucceed: false, inputErrors: [{ message: 'Customer not found.' }] } });
    mock.gql.execute.mockResolvedValueOnce({ estimatePatch: { didSucceed: false, inputErrors: [{ message: 'Estimate is converted.' }] } });
    mock.gql.execute.mockResolvedValueOnce({ estimateDelete: { didSucceed: false, inputErrors: null } });
    registerEstimateTools(stub.server as never, mock.client);
    await expect(stub.invoke('wave_create_estimate', { customerId: 1, items: [ITEM], estimateNumber: '1', currency: 'CAD' })).rejects.toThrow(/Customer not found/);
    await expect(stub.invoke('wave_update_estimate', UPDATE_ARGS)).rejects.toThrow(/Estimate is converted/);
    await expect(stub.invoke('wave_delete_estimate', { estimateGlobalId: 'EID' })).rejects.toThrow(WaveMutationError);
  });

  it('wave_create_estimate passes verbatim CreateEstimate mutation text', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({ estimateCreate: { didSucceed: true, estimate: { id: 'x' } } });
    registerEstimateTools(stub.server as never, mock.client);
    await stub.invoke('wave_create_estimate', { customerId: 1, items: [ITEM], estimateNumber: '1', currency: 'CAD' });
    expect(mock.gql.execute.mock.calls[0]![0].query).toBe(CREATE_ESTIMATE_MUTATION);
  });

  it('wave_update_estimate sends PatchEstimate with the supplied global id', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({ estimatePatch: { didSucceed: true } });
    registerEstimateTools(stub.server as never, mock.client);
    const out = await stub.parsed('wave_update_estimate', {
      estimateGlobalId: 'EST_REL',
      customerId: 1,
      items: [ITEM],
      estimateNumber: '12',
      estimateDate: '2026-05-11',
      dueDate: '2026-06-10',
    });
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(PATCH_ESTIMATE_MUTATION);
    expect(call.variables.input.id).toBe('EST_REL');
    expect(call.variables.input.status).toBe('DRAFT');
    expect(call.variables.input.depositStatus).toBe('DISABLED');
    expect(call.variables.input.disableCreditCardPayments).toBe(true);
    expect(out).toEqual({ ok: true, estimateGlobalId: 'EST_REL' });
  });

  it('wraps line taxes as { salesTaxId } objects, composing integer IDs into SalesTax Relay IDs', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({ estimateCreate: { didSucceed: true, estimate: { id: 'x' } } });
    registerEstimateTools(stub.server as never, mock.client);
    await stub.invoke('wave_create_estimate', {
      customerId: 1,
      items: [{ ...ITEM, taxIds: [1234567, 'TAX_REL'] }],
      estimateNumber: '1',
      currency: 'CAD',
    });
    const taxes = mock.gql.execute.mock.calls[0]![0].variables.input.items[0].taxes;
    expect(taxes).toEqual([
      { salesTaxId: Buffer.from(`Business:${BUSINESS_UUID};SalesTax:1234567`, 'utf8').toString('base64') },
      { salesTaxId: 'TAX_REL' },
    ]);
  });

  it('wave_update_estimate forwards a deposit unit and value when a deposit is enabled', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({ estimatePatch: { didSucceed: true } });
    registerEstimateTools(stub.server as never, mock.client);
    await stub.invoke('wave_update_estimate', {
      ...UPDATE_ARGS,
      status: 'SENT',
      depositStatus: 'ENABLED_MANDATORY',
      depositUnit: 'PERCENTAGE',
      depositValue: '25',
    });
    const input = mock.gql.execute.mock.calls[0]![0].variables.input;
    expect(input.status).toBe('SENT');
    expect(input.depositStatus).toBe('ENABLED_MANDATORY');
    expect(input.depositUnit).toBe('PERCENTAGE');
    expect(input.depositValue).toBe('25');
  });

  it('wave_update_estimate rejects an enabled deposit without unit and value', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    registerEstimateTools(stub.server as never, mock.client);
    await expect(
      stub.invoke('wave_update_estimate', { ...UPDATE_ARGS, depositStatus: 'ENABLED_OPTIONAL' }),
    ).rejects.toThrow(/needs both depositUnit and depositValue/);
    expect(mock.gql.execute).not.toHaveBeenCalled();
  });

  it('wave_update_estimate drops deposit unit and value when deposits are disabled', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({ estimatePatch: { didSucceed: true } });
    registerEstimateTools(stub.server as never, mock.client);
    await stub.invoke('wave_update_estimate', { ...UPDATE_ARGS, depositUnit: 'AMOUNT', depositValue: '10' });
    const input = mock.gql.execute.mock.calls[0]![0].variables.input;
    expect(input.depositUnit).toBeNull();
    expect(input.depositValue).toBeNull();
  });

  it('rejects estimate statuses Wave no longer accepts', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    registerEstimateTools(stub.server as never, mock.client);
    await expect(stub.invoke('wave_update_estimate', { ...UPDATE_ARGS, status: 'ACTIVE' })).rejects.toThrow();
    await expect(stub.invoke('wave_list_estimates', { status: 'OVERDUE' })).rejects.toThrow();
    expect(mock.gql.execute).not.toHaveBeenCalled();
  });

  it('wave_delete_estimate sends the estimateId to the delete mutation', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({ estimateDelete: { didSucceed: true } });
    registerEstimateTools(stub.server as never, mock.client);
    const out = await stub.parsed('wave_delete_estimate', { estimateGlobalId: 'EID' });
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(DELETE_ESTIMATE_MUTATION);
    expect(call.variables.input.estimateId).toBe('EID');
    expect(out).toEqual({ ok: true, estimateGlobalId: 'EID' });
  });
});
