// Read-only contract checks against your real Wave account. Skipped unless WAVE_LIVE_SIGNED_IN=1
// (`npm run test:live:signed-in`), so an expired session never fails a normal run. Each schema
// pins only the fields the tools forward or their descriptions point the model at.
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { WaveClient, loadAuth } from '../client/index.js';
import { WaveAuthError } from '../client/errors.js';
import { registerAllTools } from '../tools/index.js';
import { createStubServer, type StubServer } from '../tools/_test_utils.js';
import { cliCommand } from '../util/cli-command.js';

const signedIn = process.env['WAVE_LIVE_SIGNED_IN'] === '1';

const Uuid = z.string().uuid();
const IntId = z.number().int().positive();
const NumericString = z.string().regex(/^\d+$/);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const PageMeta = z.object({ page: z.number(), pageSize: z.number(), totalCount: z.number().int().nonnegative() }).passthrough();
const OffsetPageInfo = z.object({ currentPage: z.literal(1), totalPages: z.number().int() }).passthrough();

const Business = z
  .object({
    id: Uuid,
    company_name: z.string(),
    is_personal: z.boolean(),
    is_default_business: z.boolean(),
    currency: z.string().length(3),
  })
  .passthrough();

// Wave's untrimmed business record, which beforeAll reads directly to pick the business under test.
const RawBusiness = z.object({ id: Uuid, is_personal: z.boolean(), is_default_business: z.boolean() });

const RestCustomer = z.object({ id: IntId, name: z.string() }).passthrough();

const InvoiceSummary = z
  .object({
    id: NumericString,
    invoice_number: z.string(),
    status: z.string(),
    invoice_date: IsoDate,
    due_date: IsoDate,
    invoice_total: z.number(),
    invoice_amount_due: z.number(),
    currency: z.string().length(3),
    customer: RestCustomer,
  })
  .passthrough();

const Product = z
  .object({
    id: IntId,
    name: z.string(),
    price: z.number(),
    active: z.boolean(),
    is_sold: z.boolean(),
    income_account: z.object({ id: IntId }).passthrough().nullable(),
    default_sales_taxes: z.array(z.unknown()),
  })
  .passthrough();

// wave_create_invoice's descriptions send the model to items[].product.id,
// items[].product.income_account.id and items[].taxes[].sales_tax.id.
const InvoiceDetail = InvoiceSummary.extend({
  items: z.array(
    z
      .object({
        product: z
          .object({ id: IntId, name: z.string(), income_account: z.object({ id: IntId }).passthrough().nullable() })
          .passthrough(),
        price: z.number(),
        quantity: z.number(),
        taxes: z.array(z.object({ sales_tax: z.object({ id: IntId }).passthrough() }).passthrough()),
      })
      .passthrough(),
  ),
  payments: z.array(z.object({ id: z.union([IntId, NumericString]) }).passthrough()),
}).passthrough();

const Account = z
  .object({ id: IntId, name: z.string(), active: z.boolean(), account_type: z.string(), is_payment: z.boolean() })
  .passthrough();

const GqlCustomer = z.object({ id: z.string(), internalId: NumericString, name: z.string() }).passthrough();

const Estimate = z
  .object({ id: z.string(), status: z.string(), estimateNumber: z.string(), customer: z.object({ id: z.string() }).passthrough() })
  .passthrough();

const Bill = z
  .object({ id: z.string(), billNumber: z.string(), billDate: IsoDate, total: z.string(), currency: z.string() })
  .passthrough();

const Receipt = z
  .object({ id: z.string(), amount: z.unknown(), currency: z.string(), dateCreated: z.string() })
  .passthrough();

describe.skipIf(!signedIn)('Wave read endpoints, signed in (npm run test:live:signed-in)', () => {
  let tools: StubServer;
  let businessId: string;

  async function call<T extends z.ZodTypeAny>(tool: string, schema: T, args: Record<string, unknown> = {}): Promise<z.infer<T>> {
    const body = await tools.parsed(tool, { businessId, ...args });
    const result = schema.safeParse(body);
    if (!result.success) throw new Error(`${tool} drifted from its contract:\n${result.error.message}`);
    return result.data;
  }

  beforeAll(async () => {
    // No refresher: a stale session fails fast here instead of launching a headless login.
    const client = new WaveClient(loadAuth());
    tools = createStubServer();
    registerAllTools(tools.server as never, client);
    let listed: z.infer<typeof RawBusiness>[];
    try {
      listed = z.array(RawBusiness).parse(await client.rest.get('/businesses/', { include_personal: true }));
    } catch (err) {
      if (err instanceof WaveAuthError) {
        throw new Error(`Wave session expired. Run \`${cliCommand('login')}\` to sign in again, then re-run.`);
      }
      throw err;
    }
    let configured: string | undefined;
    try {
      configured = client.businessId();
    } catch {
      configured = undefined;
    }
    const fallback = listed.find((b) => b.is_default_business && !b.is_personal) ?? listed.find((b) => !b.is_personal);
    const picked = configured ?? fallback?.id;
    if (!picked) throw new Error('No business to test against: set WAVE_BUSINESS_ID or store one with `paste`.');
    businessId = picked;
  });

  it('wave_list_businesses', async () => {
    const { businesses } = await call('wave_list_businesses', z.object({ businesses: z.array(Business).min(1) }));
    expect(businesses.map((b) => b.id)).toContain(businessId);
  });

  it('wave_get_business', async () => {
    const { business } = await call('wave_get_business', z.object({ business: Business }));
    expect(business.id).toBe(businessId);
  });

  describe('invoices', () => {
    it('wave_list_invoices pages with a total count', async () => {
      const page = await call('wave_list_invoices', z.object({ items: z.array(InvoiceSummary), meta: PageMeta }), { pageSize: 5 });
      expect(page.items.length).toBeLessThanOrEqual(5);
      expect(page.meta.totalCount).toBeGreaterThanOrEqual(page.items.length);
    });

    it.each(['draft', 'unpaid', 'paid', 'overdue', 'partial'])('wave_list_invoices accepts status=%s', async (status) => {
      await call('wave_list_invoices', z.object({ items: z.array(InvoiceSummary) }).passthrough(), { status, pageSize: 1 });
    });

    it.each(['-invoice_date', 'invoice_date', '-due_date', 'due_date', '-amount_due', 'amount_due'])(
      'wave_list_invoices accepts sort=%s',
      async (sort) => {
        await call('wave_list_invoices', z.object({ items: z.array(InvoiceSummary) }).passthrough(), { sort, pageSize: 1 });
      },
    );

    it('wave_get_invoice embeds items, products, taxes and payments', async ({ skip }) => {
      const page = await call('wave_list_invoices', z.object({ items: z.array(InvoiceSummary) }).passthrough(), { pageSize: 1 });
      const first = page.items[0];
      if (!first) return skip('no invoices to fetch');
      const { invoice } = await call('wave_get_invoice', z.object({ invoice: InvoiceDetail }), { invoiceId: first.id });
      expect(invoice.id).toBe(first.id);
    });

    it('wave_get_invoice raw: true returns Wave\'s full record', async ({ skip }) => {
      const page = await call('wave_list_invoices', z.object({ items: z.array(InvoiceSummary) }).passthrough(), { pageSize: 1 });
      const first = page.items[0];
      if (!first) return skip('no invoices to fetch');
      const { invoice } = await call('wave_get_invoice', z.object({ invoice: z.object({ invoice_currency: z.object({ code: z.string() }).passthrough() }).passthrough() }), { invoiceId: first.id, raw: true });
      expect(invoice.invoice_currency.code).toHaveLength(3);
    });

    it('wave_get_invoice_settings', async () => {
      await call(
        'wave_get_invoice_settings',
        z.object({
          settings: z.object({ default_payment_terms: z.number(), default_footer: z.string(), standard_memo: z.string() }).passthrough(),
        }),
      );
    });

    it('wave_list_accounts includes payment accounts', async () => {
      const { accounts } = await call('wave_list_accounts', z.object({ accounts: z.array(Account).min(1) }));
      expect(accounts.some((a) => a.is_payment)).toBe(true);
    });
  });

  describe('products', () => {
    it('wave_list_products returns only active products by default', async () => {
      const page = await call('wave_list_products', z.object({ items: z.array(Product), meta: PageMeta }), { pageSize: 5 });
      expect(page.items.every((p) => p.active)).toBe(true);
    });

    it.each(['name', '-name', 'date_created', '-date_created', 'date_modified', '-date_modified'])(
      'wave_list_products accepts sort=%s',
      async (sort) => {
        await call('wave_list_products', z.object({ items: z.array(Product) }).passthrough(), { sort, pageSize: 1 });
      },
    );

    it('wave_get_product', async ({ skip }) => {
      const page = await call('wave_list_products', z.object({ items: z.array(Product) }).passthrough(), { pageSize: 1 });
      const first = page.items[0];
      if (!first) return skip('no products to fetch');
      const { product } = await call('wave_get_product', z.object({ product: Product }), { productId: first.id });
      expect(product.id).toBe(first.id);
    });
  });

  it('wave_list_customers exposes the integer internalId the write tools take', async () => {
    await call('wave_list_customers', z.object({ customers: z.array(GqlCustomer), pageInfo: OffsetPageInfo }), { pageSize: 5 });
  });

  it('wave_list_estimates returns one trimmed list', async () => {
    await call(
      'wave_list_estimates',
      z.object({ estimates: z.array(Estimate), pageInfo: OffsetPageInfo.extend({ totalCount: z.number().int() }) }),
      { pageSize: 5 },
    );
  });

  it('wave_get_estimate gives the fields wave_update_estimate takes', async ({ skip }) => {
    const list = await call('wave_list_estimates', z.object({ estimates: z.array(Estimate) }), { status: 'ALL', pageSize: 1 });
    const first = list.estimates[0];
    if (!first) return skip('no estimates to fetch');
    const Item = z.object({ productId: IntId, name: z.string(), unitPrice: z.union([z.string(), z.number()]), incomeAccountClassicId: z.string() });
    const { estimate } = await call(
      'wave_get_estimate',
      z.object({ estimate: z.object({ id: z.string(), status: z.string(), items: z.array(Item) }) }),
      { estimateGlobalId: first.id },
    );
    expect(estimate.id).toBe(first.id);
  });

  it('wave_list_bills', async () => {
    const out = await call(
      'wave_list_bills',
      z.object({ bills: z.array(Bill), totalCount: z.number().int() }),
      { pageSize: 5 },
    );
    expect(out.totalCount).toBeGreaterThanOrEqual(out.bills.length);
  });

  it('wave_list_receipts', async () => {
    await call('wave_list_receipts', z.object({ receipts: z.array(Receipt) }), { first: 5 });
  });

  it('wave_list_sales_taxes gives integer ids and numeric rates', async () => {
    const SalesTax = z.object({ id: IntId, relayId: z.string(), name: z.string(), rate: z.number().nullable(), isArchived: z.boolean() });
    const active = await call('wave_list_sales_taxes', z.object({ salesTaxes: z.array(SalesTax) }));
    expect(active.salesTaxes.every((t) => !t.isArchived)).toBe(true);
    const all = await call('wave_list_sales_taxes', z.object({ salesTaxes: z.array(SalesTax) }), { includeArchived: true });
    expect(all.salesTaxes.length).toBeGreaterThanOrEqual(active.salesTaxes.length);
  });
});

