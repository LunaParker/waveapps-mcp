// Contract checks against Wave's live API that need no session. Every tool runs with a bogus
// token, so Wave rejects it at auth and nothing can be read or changed. What still gets checked:
//   - REST answers 401 for routes that exist and 404 for ones that don't, so a 401 proves the route.
//   - GraphQL validates the document, input fields and enum values before auth, so a clean
//     UNAUTHENTICATED proves the query or mutation (and its variables) still fit Wave's schema.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { WaveClient } from '../client/index.js';
import { WaveApiError, WaveAuthError, WaveGraphQLError } from '../client/errors.js';
import { registerAllTools } from '../tools/index.js';
import { createStubServer, type StubServer } from '../tools/_test_utils.js';

const BOGUS_AUTH = { authToken: 'FAKE_not-a-real-session', csrfToken: 'FAKE_not-a-real-csrf-token' };
const BUSINESS = '00000000-0000-4000-8000-000000000000';
const RELAY_ID = Buffer.from(`Business:${BUSINESS};Estimate:1`).toString('base64');
const TAX_RELAY_ID = Buffer.from(`Business:${BUSINESS};SalesTax:1`).toString('base64');

const INVOICE_ITEM = { productId: 1, name: 'Contract check', incomeAccountId: 1, price: '1.00', taxes: [1] };
const ESTIMATE_ITEM = {
  productId: 1,
  name: 'Contract check',
  unitPrice: '1.00',
  incomeAccountClassicId: '1',
  taxIds: [1, TAX_RELAY_ID],
};

// One call per tool, with arguments that exercise every optional input the tool forwards.
// Write tools that would read first (invoice defaults, partial updates, the next estimate
// number) get every field here, so the write route itself is what Wave rejects.
const CALLS: Record<string, Record<string, unknown>> = {
  wave_list_businesses: {},
  wave_get_business: {},
  wave_list_invoices: { status: 'unpaid' },
  wave_get_invoice: { invoiceId: '1' },
  wave_get_invoice_settings: {},
  wave_create_invoice: {
    customerId: 1,
    items: [INVOICE_ITEM],
    currency: 'CAD',
    dueDate: '2026-01-16',
    memo: '',
    footer: '',
    subhead: '',
    itemTitle: 'Items',
    quantityTitle: 'Quantity',
    priceTitle: 'Price',
    amountTitle: 'Amount',
    invoiceNumberLabel: 'Invoice',
  },
  wave_update_invoice: {
    invoiceId: '1',
    customerId: 1,
    items: [INVOICE_ITEM],
    status: 'saved',
    invoiceNumber: '1',
    poSoNumber: '',
    invoiceDate: '2026-01-01',
    dueDate: '2026-01-16',
    currency: 'CAD',
    exchangeRate: '1.0000000000',
    memo: '',
    footer: '',
    subhead: '',
    itemTitle: 'Items',
    quantityTitle: 'Quantity',
    priceTitle: 'Price',
    amountTitle: 'Amount',
    invoiceNumberLabel: 'Invoice',
  },
  wave_approve_invoice: { invoiceId: '1' },
  wave_mark_invoice_sent: { invoiceId: '1' },
  wave_send_invoice: {
    invoiceId: '1',
    to: ['nobody@example.com'],
    subject: 'Contract check',
    message: 'Contract check',
    fromAddress: 'nobody@example.com',
  },
  wave_list_accounts: {},
  wave_record_invoice_payment: { invoiceId: '1', amount: 1, paymentAccountId: 1, memo: 'Contract check' },
  wave_delete_invoice_payment: { invoiceId: '1', paymentId: '1' },
  wave_delete_invoice: { invoiceId: '1' },
  wave_list_customers: {},
  wave_create_customer: {
    name: 'Contract check',
    email: 'nobody@example.com',
    currency: 'CAD',
    address: { addressLine1: '1 Main St', city: 'Toronto', provinceCode: 'ON', countryCode: 'CA', postalCode: 'M5V 1A1' },
  },
  wave_delete_customer: { customerId: 1 },
  wave_list_estimates: {
    customerId: Buffer.from(`Business:${BUSINESS};Customer:1`).toString('base64'),
    status: 'ACTIVE',
    estimateDateStart: '2026-01-01',
    estimateDateEnd: '2026-12-31',
    estimateNumber: '1',
  },
  wave_create_estimate: {
    customerId: 1,
    items: [ESTIMATE_ITEM],
    estimateNumber: '1',
    currency: 'CAD',
    estimateDate: '2026-01-01',
    dueDate: '2026-01-31',
  },
  wave_update_estimate: {
    estimateGlobalId: RELAY_ID,
    customerId: 1,
    currency: 'CAD',
    items: [ESTIMATE_ITEM],
    estimateNumber: '1',
    estimateDate: '2026-01-01',
    dueDate: '2026-01-31',
  },
  wave_delete_estimate: { estimateGlobalId: RELAY_ID },
  wave_list_bills: {
    vendorId: Buffer.from(`Vendor:${BUSINESS}`).toString('base64'),
    billDateStart: '2026-01-01',
    billDateEnd: '2026-12-31',
  },
  wave_list_receipts: {},
  wave_list_sales_taxes: { includeArchived: false },
  wave_get_estimate: { estimateGlobalId: RELAY_ID },
  wave_approve_estimate: { estimateGlobalId: RELAY_ID },
  wave_send_estimate: {
    estimateGlobalId: RELAY_ID,
    to: ['nobody@example.com'],
    subject: 'Contract check',
    message: 'Contract check',
    fromAddress: 'nobody@example.com',
  },
  wave_mark_estimate_sent: { estimateGlobalId: RELAY_ID, sentAt: '2026-01-01T09:00:00-05:00' },
  wave_accept_estimate: { estimateGlobalId: RELAY_ID },
  wave_reset_estimate_acceptance: { estimateGlobalId: RELAY_ID },
  wave_duplicate_estimate: { estimateGlobalId: RELAY_ID },
  wave_convert_estimate_to_invoice: { estimateGlobalId: RELAY_ID },
  wave_get_estimate_pdf: { estimateGlobalId: RELAY_ID },
  wave_get_report: { report: 'profit_and_loss', startDate: '2026-01-01', endDate: '2026-03-31', basis: 'cash' },
  wave_list_products: {},
  wave_get_product: { productId: 1 },
  wave_create_product: { name: 'Contract check', price: 1, incomeAccountId: 1, defaultSalesTaxes: [1] },
  wave_update_product: { productId: 1, name: 'Contract check', active: false },
  wave_delete_product: { productId: 1 },
};

// Enum inputs, one call per value. GraphQL checks each value against its schema before auth; on
// REST a value picks a route, which must answer 401, not 404. Bases carry no line taxes so a
// failure here points at the enum value alone.
const UNTAXED_ESTIMATE = {
  ...CALLS['wave_update_estimate']!,
  items: [{ ...ESTIMATE_ITEM, taxIds: [] }],
  depositUnit: 'AMOUNT',
  depositValue: '10',
};
const GRAPHQL_ENUM_INPUTS: ReadonlyArray<[tool: string, field: string, base: Record<string, unknown>]> = [
  ['wave_list_estimates', 'sort', {}],
  ['wave_list_estimates', 'status', {}],
  ['wave_list_bills', 'sort', {}],
  ['wave_list_receipts', 'sort', {}],
  ['wave_update_estimate', 'status', UNTAXED_ESTIMATE],
  ['wave_update_estimate', 'depositStatus', UNTAXED_ESTIMATE],
  ['wave_update_estimate', 'depositUnit', { ...UNTAXED_ESTIMATE, depositStatus: 'ENABLED_OPTIONAL' }],
  ['wave_mark_estimate_sent', 'sendMethod', { estimateGlobalId: RELAY_ID }],
  ['wave_get_report', 'report', {}],
];

// Explicit auth and business: nothing is read from env or ~/.config, and no refresher is wired.
const client = new WaveClient(BOGUS_AUTH, { defaultBusinessId: BUSINESS });
const tools: StubServer = createStubServer();
registerAllTools(tools.server as never, client);

/** Run a tool and require Wave's auth rejection; any other error explains what drifted. */
async function expectAuthRejection(tool: string, args: Record<string, unknown>): Promise<void> {
  let caught: unknown;
  try {
    await tools.invoke(tool, args);
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected an auth rejection, got: ${describeError(caught)}`).toBeInstanceOf(WaveAuthError);
}

function describeError(err: unknown): string {
  if (err === undefined) return 'no error (Wave accepted a bogus session?)';
  if (err instanceof WaveApiError) return `${err.message} ${JSON.stringify(err.body)}`;
  if (err instanceof WaveGraphQLError) {
    return err.errors.map((e) => `${JSON.stringify(e.extensions)} ${e.message}`).join('; ');
  }
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function enumValues(tool: string, field: string): readonly string[] {
  const shape = (tools.configs.get(tool) as { inputSchema: z.ZodRawShape }).inputSchema;
  let schema = shape[field] as z.ZodTypeAny;
  while (schema instanceof z.ZodDefault || schema instanceof z.ZodOptional) {
    schema = schema instanceof z.ZodDefault ? schema.removeDefault() : schema.unwrap();
  }
  if (!(schema instanceof z.ZodEnum)) throw new Error(`${tool}.${field} is not an enum`);
  return schema.options as readonly string[];
}

describe('the check itself still discriminates', () => {
  it('REST answers 404, not 401, for a route that does not exist', async () => {
    const err = await client.rest.get(`/businesses/${BUSINESS}/definitely-not-a-route/`).catch((e: unknown) => e);
    expect(err, describeError(err)).toBeInstanceOf(WaveApiError);
    expect((err as WaveApiError).status).toBe(404);
  });

  it('GraphQL validates fields before auth', async () => {
    const err = await client.gql
      .execute({ operationName: 'Probe', query: 'query Probe { business(id: "eA==") { id notARealField } }', variables: {} })
      .catch((e: unknown) => e);
    expect(err, describeError(err)).toBeInstanceOf(WaveGraphQLError);
    expect((err as WaveGraphQLError).errors[0]?.extensions).toMatchObject({ code: 'GRAPHQL_VALIDATION_FAILED' });
  });

  it('GraphQL checks input fields before auth', async () => {
    const err = await client.gql
      .execute({
        operationName: 'Probe',
        query: 'mutation Probe($input: CustomerDeleteInput!) { customerDelete(input: $input) { didSucceed } }',
        variables: { input: { id: 'eA==', notARealField: 1 } },
      })
      .catch((e: unknown) => e);
    expect(err, describeError(err)).toBeInstanceOf(WaveGraphQLError);
    expect((err as WaveGraphQLError).errors[0]?.extensions).toMatchObject({ code: 'VARIABLE_VALUE' });
  });
});

describe('every tool still reaches a live route or schema', () => {
  it('covers every registered tool', () => {
    expect(Object.keys(CALLS).sort()).toEqual([...tools.handlers.keys()].sort());
  });

  it.each(Object.entries(CALLS))('%s', async (tool, args) => {
    await expectAuthRejection(tool, args);
  });
});

describe('GraphQL enum values the tools offer are still in Wave\'s schema', () => {
  const cases = GRAPHQL_ENUM_INPUTS.flatMap(([tool, field, base]) =>
    enumValues(tool, field).map((value) => ({ tool, field, value, base })),
  );

  it.each(cases)('$tool $field=$value', async ({ tool, field, value, base }) => {
    await expectAuthRejection(tool, { ...base, [field]: value });
  });
});
