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

const ITEM = {
  productId: 133995046,
  name: 'Test line',
  unitPrice: '1.00',
  quantity: '1',
  incomeAccountClassicId: '729213118',
  taxIds: [],
};

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

  it('wave_list_estimates fires GetEstimates with default sort + status buckets', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    const emptyBucket = { edges: [], pageInfo: { currentPage: 1, totalCount: 0, totalPages: 0 } };
    mock.gql.execute.mockResolvedValueOnce({
      business: { id: BUSINESS_GLOBAL_ID, allEstimates: emptyBucket, draftEstimates: emptyBucket, activeEstimates: emptyBucket },
    });
    registerEstimateTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_list_estimates', {})) as Record<string, unknown>;
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.operationName).toBe('GetEstimates');
    expect(call.query).toBe(ESTIMATES_QUERY);
    expect(call.variables.businessId).toBe(BUSINESS_GLOBAL_ID);
    expect(call.variables.sort).toBe('ESTIMATE_DATE_DESC');
    expect(call.variables.activeStatus).toBe('ACTIVE');
    expect(call.variables.draftStatus).toBe('DRAFT');
    expect(out).toHaveProperty('active');
    expect(out).toHaveProperty('draft');
    expect(out).toHaveProperty('all');
  });

  it('wave_create_estimate encodes customerId and productId as composite Relay IDs', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({
      estimateCreate: { didSucceed: true, estimate: { id: 'eid', estimateNumber: '1' } },
    });
    registerEstimateTools(stub.server as never, mock.client);
    await stub.invoke('wave_create_estimate', { customerId: 102532808, items: [ITEM] });
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

  it('wave_create_estimate uses today + the captured defaults when dates omitted', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({ estimateCreate: { didSucceed: true, estimate: { id: 'x' } } });
    registerEstimateTools(stub.server as never, mock.client);
    await stub.invoke('wave_create_estimate', { customerId: 1, items: [ITEM] });
    const input = mock.gql.execute.mock.calls[0]![0].variables.input;
    expect(input.estimateDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input.title).toBe('Estimate');
    expect(input.itemTitle).toBe('Services');
  });

  it('wave_create_estimate passes verbatim CreateEstimate mutation text', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({ estimateCreate: { didSucceed: true, estimate: { id: 'x' } } });
    registerEstimateTools(stub.server as never, mock.client);
    await stub.invoke('wave_create_estimate', { customerId: 1, items: [ITEM] });
    expect(mock.gql.execute.mock.calls[0]![0].query).toBe(CREATE_ESTIMATE_MUTATION);
  });

  it('wave_update_estimate sends PatchEstimate with the supplied global id', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({ estimatePatch: { didSucceed: true } });
    registerEstimateTools(stub.server as never, mock.client);
    await stub.invoke('wave_update_estimate', {
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
  });

  it('wave_delete_estimate sends the estimateId to the delete mutation', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.gql.execute.mockResolvedValueOnce({ estimateDelete: { didSucceed: true } });
    registerEstimateTools(stub.server as never, mock.client);
    await stub.invoke('wave_delete_estimate', { estimateGlobalId: 'EID' });
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(DELETE_ESTIMATE_MUTATION);
    expect(call.variables.input.estimateId).toBe('EID');
  });
});
