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
      'wave_accept_estimate',
      'wave_approve_estimate',
      'wave_approve_invoice',
      'wave_convert_estimate_to_invoice',
      'wave_create_customer',
      'wave_create_customer_statement',
      'wave_create_estimate',
      'wave_create_invoice',
      'wave_create_product',
      'wave_create_tag',
      'wave_create_transaction',
      'wave_delete_customer',
      'wave_delete_estimate',
      'wave_delete_invoice',
      'wave_delete_invoice_payment',
      'wave_delete_product',
      'wave_delete_tag',
      'wave_delete_transaction',
      'wave_duplicate_estimate',
      'wave_duplicate_invoice',
      'wave_get_business',
      'wave_get_customer',
      'wave_get_estimate',
      'wave_get_estimate_pdf',
      'wave_get_invoice',
      'wave_get_invoice_pdf',
      'wave_get_invoice_settings',
      'wave_get_product',
      'wave_get_recurring_invoice',
      'wave_get_report',
      'wave_get_transaction',
      'wave_list_accounts',
      'wave_list_bills',
      'wave_list_businesses',
      'wave_list_customers',
      'wave_list_estimates',
      'wave_list_invoices',
      'wave_list_products',
      'wave_list_receipts',
      'wave_list_recurring_invoices',
      'wave_list_sales_taxes',
      'wave_list_tags',
      'wave_list_transactions',
      'wave_mark_estimate_sent',
      'wave_mark_invoice_sent',
      'wave_record_invoice_payment',
      'wave_reset_estimate_acceptance',
      'wave_send_customer_statement',
      'wave_send_estimate',
      'wave_send_invoice',
      'wave_send_invoice_reminder',
      'wave_send_payment_receipt',
      'wave_update_customer',
      'wave_update_estimate',
      'wave_update_invoice',
      'wave_update_product',
      'wave_update_transaction',
    ]);
    expect(names).toHaveLength(57);
  });

  it('marks every tool that emails someone as destructive, so clients ask before it runs', () => {
    const stub = createStubServer();
    registerAllTools(stub.server as never, createMockClient().client);
    const senders = [...stub.configs.entries()].filter(([name]) => name.startsWith('wave_send_'));
    expect(senders.length).toBeGreaterThan(0);
    for (const [name, config] of senders) {
      expect((config as { annotations?: { destructiveHint?: boolean } }).annotations?.destructiveHint, name).toBe(true);
    }
  });
});
