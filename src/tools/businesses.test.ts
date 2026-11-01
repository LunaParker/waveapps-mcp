import { describe, expect, it } from 'vitest';
import { registerBusinessTools } from './businesses.js';
import { BUSINESS_UUID, createMockClient, createStubServer } from './_test_utils.js';

const RAW_BUSINESS = (id: string, name: string) => ({
  id, url: 'u', company_name: name, primary_currency: { url: 'u', code: 'CAD', symbol: '$', name: 'Canadian dollar', plural: null },
  is_owner: true, is_admin: true, is_default_business: true, is_personal: false, timezone_id: 'America/Toronto',
  country: { name: 'Canada', country_code: 'CA' }, apps: [], scopes: 'all',
  invoice_sending_emails: [{ email: 'billing@example.com', default: true, is_collaborator: false, verified: true }],
});

describe('registerBusinessTools', () => {
  it('registers both business tools by name', () => {
    const stub = createStubServer();
    const mock = createMockClient();
    registerBusinessTools(stub.server as never, mock.client);
    expect([...stub.handlers.keys()].sort()).toEqual(['wave_get_business', 'wave_list_businesses']);
  });

  it('wave_list_businesses GETs /businesses/ with include_personal and returns trimmed businesses', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.rest.get.mockResolvedValueOnce([RAW_BUSINESS('one', 'One Co'), RAW_BUSINESS('two', 'Two Co')]);
    registerBusinessTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_list_businesses', { includePersonal: true })) as { businesses: Array<Record<string, unknown>> };
    expect(mock.rest.get).toHaveBeenCalledWith('/businesses/', { include_personal: true });
    expect(out.businesses.map((b) => b['id'])).toEqual(['one', 'two']);
    expect(out.businesses[0]).toEqual({
      id: 'one', company_name: 'One Co', currency: 'CAD', country: 'CA', timezone_id: 'America/Toronto',
      is_personal: false, is_default_business: true, is_owner: true, is_admin: true,
      invoice_sending_emails: [{ email: 'billing@example.com', default: true, verified: true }],
    });
  });

  it('wave_get_business GETs /businesses/{uuid}/ and returns the trimmed business', async () => {
    const stub = createStubServer();
    const mock = createMockClient();
    mock.rest.get.mockResolvedValueOnce(RAW_BUSINESS(BUSINESS_UUID, 'Acme Co.'));
    registerBusinessTools(stub.server as never, mock.client);
    const out = (await stub.parsed('wave_get_business', {})) as { business: { company_name: string; currency: string } };
    expect(mock.rest.get).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/`);
    expect(out.business.company_name).toBe('Acme Co.');
    expect(out.business.currency).toBe('CAD');
  });
});
