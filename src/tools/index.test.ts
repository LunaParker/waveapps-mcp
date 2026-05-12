import { describe, expect, it } from 'vitest';
import { registerAllTools } from './index.js';
import { createMockClient, createStubServer } from './_test_utils.js';

describe('registerAllTools', () => {
  it('registers the full Wave MCP tool surface', () => {
    const stub = createStubServer();
    const mock = createMockClient();
    registerAllTools(stub.server as never, mock.client);
    const names = [...stub.handlers.keys()].sort();
    expect(names).toEqual([
      'wave_approve_invoice',
      'wave_create_customer',
      'wave_create_estimate',
      'wave_create_invoice',
      'wave_create_product',
      'wave_delete_customer',
      'wave_delete_estimate',
      'wave_delete_invoice',
      'wave_delete_invoice_payment',
      'wave_delete_product',
      'wave_get_business',
      'wave_get_invoice',
      'wave_get_invoice_settings',
      'wave_get_product',
      'wave_list_accounts',
      'wave_list_bills',
      'wave_list_businesses',
      'wave_list_customers',
      'wave_list_estimates',
      'wave_list_invoices',
      'wave_list_products',
      'wave_list_receipts',
      'wave_mark_invoice_sent',
      'wave_record_invoice_payment',
      'wave_send_invoice',
      'wave_update_estimate',
      'wave_update_invoice',
      'wave_update_product',
    ]);
    expect(names).toHaveLength(28);
  });
});
