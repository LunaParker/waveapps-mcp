import { describe, expect, it } from 'vitest';
import { registerProductTools } from './products.js';
import { BUSINESS_UUID, createMockClient, createStubServer } from './_test_utils.js';

describe('registerProductTools', () => {
  it('registers list, get, create, update, delete', () => {
    const stub = createStubServer();
    const mock = createMockClient();
    registerProductTools(stub.server as never, mock.client);
    expect([...stub.handlers.keys()].sort()).toEqual([
      'wave_create_product',
      'wave_delete_product',
      'wave_get_product',
      'wave_list_products',
      'wave_update_product',
    ]);
  });

  describe('wave_list_products', () => {
    it('passes pagination + active filter to REST GET', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.getPaged.mockResolvedValueOnce({ items: [], meta: { page: 1, pageSize: 50, totalCount: 0, totalPages: 0 } });
      registerProductTools(stub.server as never, mock.client);
      await stub.invoke('wave_list_products', {});
      expect(mock.rest.getPaged).toHaveBeenCalledWith(
        `/businesses/${BUSINESS_UUID}/products/`,
        { page: 1, page_size: 50, sort: '-date_modified', active: true },
      );
    });

    it('omits the active filter when activeOnly is false', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.getPaged.mockResolvedValueOnce({ items: [], meta: { page: 1, pageSize: 50, totalCount: 0, totalPages: 0 } });
      registerProductTools(stub.server as never, mock.client);
      await stub.invoke('wave_list_products', { activeOnly: false });
      const args = mock.rest.getPaged.mock.calls[0]![1] as Record<string, unknown>;
      expect(args['active']).toBeUndefined();
    });
  });

  describe('wave_get_product', () => {
    it('GETs /products/{id}/', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.get.mockResolvedValueOnce({ id: 123, name: 'P' });
      registerProductTools(stub.server as never, mock.client);
      const out = (await stub.parsed('wave_get_product', { productId: 123 })) as { product: { name: string } };
      expect(mock.rest.get).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/products/123/`);
      expect(out.product.name).toBe('P');
    });
  });

  describe('wave_create_product', () => {
    it('POSTs the captured shape with income_account wrapper when isSold', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.post.mockResolvedValueOnce({ id: 134000176, name: 'Test' });
      registerProductTools(stub.server as never, mock.client);
      await stub.invoke('wave_create_product', {
        name: 'Test',
        price: 1.0,
        description: 'created by waveapps-mcp probe',
        incomeAccountId: 729213118,
      });
      expect(mock.rest.post).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/products/`, {
        name: 'Test',
        price: 1.0,
        description: 'created by waveapps-mcp probe',
        is_sold: true,
        is_bought: false,
        default_sales_taxes: [],
        income_account: { id: 729213118 },
      });
    });

    it('includes expense_account when isBought + expenseAccountId provided', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.post.mockResolvedValueOnce({ id: 1 });
      registerProductTools(stub.server as never, mock.client);
      await stub.invoke('wave_create_product', {
        name: 'Bought Thing',
        price: 12.5,
        isSold: false,
        isBought: true,
        expenseAccountId: 999,
      });
      const body = mock.rest.post.mock.calls[0]![1] as Record<string, unknown>;
      expect(body['is_sold']).toBe(false);
      expect(body['is_bought']).toBe(true);
      expect(body['expense_account']).toEqual({ id: 999 });
      expect(body['income_account']).toBeUndefined();
    });

    it('forwards default_sales_taxes', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.post.mockResolvedValueOnce({ id: 1 });
      registerProductTools(stub.server as never, mock.client);
      await stub.invoke('wave_create_product', {
        name: 'Taxable',
        price: 100,
        defaultSalesTaxes: [42, 99],
      });
      const body = mock.rest.post.mock.calls[0]![1] as Record<string, unknown>;
      expect(body['default_sales_taxes']).toEqual([42, 99]);
    });
  });

  describe('wave_update_product', () => {
    it('only sends fields that the caller supplied', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.patch.mockResolvedValueOnce({});
      registerProductTools(stub.server as never, mock.client);
      await stub.invoke('wave_update_product', { productId: 134000176, price: 9.99, description: 'patched description' });
      expect(mock.rest.patch).toHaveBeenCalledWith(
        `/businesses/${BUSINESS_UUID}/products/134000176/`,
        { price: 9.99, description: 'patched description' },
      );
    });

    it('wraps incomeAccountId in the { id } shape', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.patch.mockResolvedValueOnce({});
      registerProductTools(stub.server as never, mock.client);
      await stub.invoke('wave_update_product', { productId: 1, incomeAccountId: 555 });
      expect(mock.rest.patch.mock.calls[0]![1]).toEqual({ income_account: { id: 555 } });
    });

    it('lets the caller null out expenseAccountId explicitly', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.patch.mockResolvedValueOnce({});
      registerProductTools(stub.server as never, mock.client);
      await stub.invoke('wave_update_product', { productId: 1, expenseAccountId: null });
      expect(mock.rest.patch.mock.calls[0]![1]).toEqual({ expense_account: null });
    });

    it('forwards active=false for archiving', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.patch.mockResolvedValueOnce({});
      registerProductTools(stub.server as never, mock.client);
      await stub.invoke('wave_update_product', { productId: 1, active: false });
      expect(mock.rest.patch.mock.calls[0]![1]).toEqual({ active: false });
    });

    it('sends an empty body when no editable fields are supplied (no-op safe)', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.patch.mockResolvedValueOnce({});
      registerProductTools(stub.server as never, mock.client);
      await stub.invoke('wave_update_product', { productId: 1 });
      expect(mock.rest.patch.mock.calls[0]![1]).toEqual({});
    });
  });

  describe('wave_delete_product', () => {
    it('DELETEs /products/{id}/ and reports ok', async () => {
      const stub = createStubServer();
      const mock = createMockClient();
      mock.rest.delete.mockResolvedValueOnce(undefined);
      registerProductTools(stub.server as never, mock.client);
      const out = (await stub.parsed('wave_delete_product', { productId: 42 })) as { ok: boolean; productId: number };
      expect(mock.rest.delete).toHaveBeenCalledWith(`/businesses/${BUSINESS_UUID}/products/42/`);
      expect(out).toEqual({ ok: true, productId: 42 });
    });
  });
});
