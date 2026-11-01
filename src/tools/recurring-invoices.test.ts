import { describe, expect, it } from 'vitest';
import { registerRecurringInvoiceTools } from './recurring-invoices.js';
import { BUSINESS_UUID, createMockClient, createStubServer } from './_test_utils.js';

const RAW = {
  id: '9001', business_id: BUSINESS_UUID, state: 'active', purchase_order_id: '', notes: 'n', subheading: '', footer: 'f',
  invoice_number_label: 'Invoice', currency_code: 'CAD', currency_symbol: '$', payment_terms: 'Within 30 Days',
  first_invoice_date: '2026-01-01', num_generated_to_date: 10, previous_invoice_date: '2026-10-01', next_invoice_date: '2026-11-01',
  date_added: '2025-12-15T10:00:00Z', date_modified: '2026-10-01T10:00:00Z', can_edit: true, source_id: null, source_type: null, total: 113,
  customer: { id: '201' },
  line_items: [{ product_id: 7, name: 'Retainer', quantity: 1, price: 100, description: 'Monthly', sort_order_index: null, taxes: [{ tax_type_id: 401 }] }],
  column_settings: { item_title: 'Items' }, delivery_settings: { auto_send_enabled: true }, payment_settings: null,
  schedule_settings: { recurrence_unit: 'month', recurrence_interval: 1 }, notifications: [],
};

function setup() {
  const stub = createStubServer();
  const mock = createMockClient();
  registerRecurringInvoiceTools(stub.server as never, mock.client);
  return { stub, mock };
}

describe('registerRecurringInvoiceTools', () => {
  it('lists with page_index paging and the filters Wave takes', async () => {
    const { stub, mock } = setup();
    mock.rest.getPaged.mockResolvedValueOnce({ items: [RAW], meta: { page: 1, pageSize: 10, totalCount: 1, totalPages: 1 } });
    const out = await stub.parsed('wave_list_recurring_invoices', { state: 'active', customerId: 201, page: 2, pageSize: 10 });
    const [path, query] = mock.rest.getPaged.mock.calls[0]!;
    expect(path).toBe(`/businesses/${BUSINESS_UUID}/recurring-invoices/`);
    expect(query).toEqual({ page_index: 2, page_size: 10, sort: '-date_added', state: 'active', customer_id: 201 });
    expect(out).toEqual({
      items: [{
        id: '9001', state: 'active', customerId: 201, currency: 'CAD', total: 113, paymentTerms: 'Within 30 Days', firstInvoiceDate: '2026-01-01',
        previousInvoiceDate: '2026-10-01', nextInvoiceDate: '2026-11-01', invoicesGenerated: 10, dateAdded: '2025-12-15T10:00:00Z', canEdit: true,
      }],
      meta: { page: 2, pageSize: 10, totalCount: 1, totalPages: 1 },
    });
  });

  it('gets one with line items and passes the schedule through', async () => {
    const { stub, mock } = setup();
    mock.rest.get.mockResolvedValueOnce(RAW);
    const out = (await stub.parsed('wave_get_recurring_invoice', { recurringInvoiceId: '9001' })) as { recurringInvoice: Record<string, unknown> };
    expect(mock.rest.get.mock.calls[0]![0]).toBe(`/businesses/${BUSINESS_UUID}/recurring-invoices/9001/`);
    expect(out.recurringInvoice).toMatchObject({
      id: '9001', notes: 'n', footer: 'f',
      lineItems: [{ productId: 7, name: 'Retainer', description: 'Monthly', quantity: 1, price: 100, taxes: [{ tax_type_id: 401 }] }],
      schedule: { recurrence_unit: 'month', recurrence_interval: 1 },
      delivery: { auto_send_enabled: true },
    });
  });
});
