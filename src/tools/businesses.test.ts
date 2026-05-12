import { describe, expect, it } from 'vitest';
import { registerBusinessTools } from './businesses.js';
import { BUSINESS_UUID, createMockClient, createStubServer } from './_test_utils.js';

describe('registerBusinessTools', () => {
  it('registers both business tools by name', () => {
    const stub = createStubServer();
    const mock = createMockClient();
    registerBusinessTools(stub.server as never, mock.client);
    expect([...stub.handlers.keys()].sort()).toEqual(['wave_get_business', 'wave_list_businesses']);
  });

  it('wave_list_businesses GETs /businesses/ with include_personal default true', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.rest.get.mockResolvedValueOnce([{ id: 'one' }, { id: 'two' }]);
    registerBusinessTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_list_businesses', { includePersonal: true })) as { businesses: unknown };
    expect(mock.rest.get).toHaveBeenCalledWith('/businesses/', { include_personal: true });
    expect(out.businesses).toEqual([{ id: 'one' }, { id: 'two' }]);
  });

  it('wave_get_business GETs /businesses/{uuid}/', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.rest.get.mockResolvedValueOnce({ id: 'b', name: 'Acme Co.' });
    registerBusinessTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_get_business', {})) as { business: { name: string } };
    expect(mock.rest.get).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/`);
    expect(out.business.name).toBe('Acme Co.');
  });
});
