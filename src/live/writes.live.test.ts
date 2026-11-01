// Live write flows against a throwaway test customer. Skipped unless WAVE_LIVE_WRITES=1
// (`npm run test:live:writes`) and WAVE_LIVE_TEST_CUSTOMER_ID names a customer whose name contains
// "test". Every record a test creates is deleted afterwards, and emails only ever go to that
// customer's own address. Deleted invoices and estimates still use up their numbers in Wave.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { WaveClient, loadAuth } from '../client/index.js';
import { WaveAuthError } from '../client/errors.js';
import { toCompositeGlobalId } from '../client/ids.js';
import { registerAllTools } from '../tools/index.js';
import { createStubServer, type StubServer } from '../tools/_test_utils.js';
import { cliCommand } from '../util/cli-command.js';

const writes = process.env['WAVE_LIVE_WRITES'] === '1';
const customerEnv = process.env['WAVE_LIVE_TEST_CUSTOMER_ID'];

const EstimateRef = z.object({ id: z.string(), internalId: z.string(), estimateNumber: z.string(), status: z.string() });

describe.skipIf(!writes)('Wave write flows on the test customer (npm run test:live:writes)', () => {
  let tools: StubServer;
  let businessId: string;
  let customer: { id: number; email: string };
  let line: { productId: number; name: string; incomeAccountClassicId: string };
  let taxId: number | undefined;
  const cleanups: Array<{ what: string; run: () => Promise<unknown> }> = [];

  const call = async (tool: string, args: Record<string, unknown> = {}): Promise<any> => tools.parsed(tool, { businessId, ...args });
  const onCleanup = (what: string, run: () => Promise<unknown>): void => {
    cleanups.push({ what, run });
  };

  beforeAll(async () => {
    if (!customerEnv || !/^\d+$/.test(customerEnv)) {
      throw new Error('Set WAVE_LIVE_TEST_CUSTOMER_ID to the integer id of a throwaway test customer.');
    }
    // No refresher: a stale session fails fast here instead of launching a headless login.
    const client = new WaveClient(loadAuth());
    tools = createStubServer();
    registerAllTools(tools.server as never, client);
    try {
      businessId = client.businessId();
    } catch {
      throw new Error('Set WAVE_BUSINESS_ID or store a business with `paste` before running write tests.');
    }
    let raw: Record<string, unknown>;
    try {
      raw = await client.rest.get(`/businesses/${businessId}/customers/${customerEnv}/`);
    } catch (err) {
      if (err instanceof WaveAuthError) throw new Error(`Wave session expired. Run \`${cliCommand('login')}\` to sign in again, then re-run.`);
      throw err;
    }
    const name = String(raw['name'] ?? '');
    const email = String(raw['email'] ?? '');
    if (!/test/i.test(name)) throw new Error(`Customer ${customerEnv} is "${name}"; write tests only run against a customer whose name contains "test".`);
    if (!email.includes('@')) throw new Error(`Customer ${customerEnv} has no email; the send checks need one.`);
    customer = { id: Number(customerEnv), email };

    const products = await call('wave_list_products', { pageSize: 50 });
    const product = (products.items as Array<{ id: number; name: string; is_sold: boolean; income_account: { id: number } | null }>).find(
      (p) => p.is_sold && p.income_account,
    );
    if (!product) throw new Error('Write tests need one active product that is sold and has an income account.');
    line = { productId: product.id, name: 'Contract check', incomeAccountClassicId: String(product.income_account!.id) };
    const taxes = await call('wave_list_sales_taxes');
    taxId = (taxes.salesTaxes as Array<{ id: number }>)[0]?.id;
  });

  afterEach(async () => {
    const failed: string[] = [];
    while (cleanups.length > 0) {
      const { what, run } = cleanups.pop()!;
      try {
        await run();
      } catch (err) {
        failed.push(`${what}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failed.length > 0) throw new Error(`Cleanup left records behind in Wave:\n${failed.join('\n')}`);
  });

  const createEstimate = async (): Promise<z.infer<typeof EstimateRef>> => {
    const created = await call('wave_create_estimate', {
      customerId: customer.id,
      items: [{ ...line, unitPrice: '1.00', quantity: '1', taxIds: taxId === undefined ? [] : [taxId] }],
      memo: 'TEST - live contract check, deleted automatically',
    });
    const id = z.object({ id: z.string() }).parse(created.estimate).id;
    onCleanup(`estimate ${id}`, () => call('wave_delete_estimate', { estimateGlobalId: id }));
    const { estimate } = await call('wave_get_estimate', { estimateGlobalId: id });
    return EstimateRef.parse(estimate);
  };

  it('walks an estimate through approve, PDF, mark sent, accept, reset, duplicate and convert', async () => {
    const est = await createEstimate();
    expect(est.status).toBe('DRAFT');

    const { estimate: detail } = await call('wave_get_estimate', { estimateGlobalId: est.id });
    expect(detail.customer.id).toBe(toCompositeGlobalId(businessId, 'Customer', customer.id));
    expect(detail.items[0]).toMatchObject({ productId: line.productId, incomeAccountClassicId: line.incomeAccountClassicId });
    if (taxId !== undefined) expect(detail.items[0].taxes[0].salesTaxId).toBe(taxId);

    expect((await call('wave_approve_estimate', { estimateGlobalId: est.id })).estimate.status).toBe('APPROVED');

    const pdf = (await tools.invoke('wave_get_estimate_pdf', { estimateGlobalId: est.id })) as { content: Array<Record<string, any>> };
    expect(JSON.parse(pdf.content[0]!['text'])).toMatchObject({ embedded: true });
    expect(pdf.content[1]!['resource'].mimeType).toBe('application/pdf');
    expect(Buffer.from(pdf.content[1]!['resource'].blob, 'base64').subarray(0, 5).toString()).toBe('%PDF-');

    expect((await call('wave_mark_estimate_sent', { estimateGlobalId: est.id })).estimate.status).toBe('SENT');
    expect((await call('wave_accept_estimate', { estimateGlobalId: est.id })).estimate.status).toBe('ACCEPTED');
    expect((await call('wave_reset_estimate_acceptance', { estimateGlobalId: est.id })).estimate.status).toBe('APPROVED');

    const dup = EstimateRef.parse((await call('wave_duplicate_estimate', { estimateGlobalId: est.id })).estimate);
    onCleanup(`duplicate estimate ${dup.id}`, () => call('wave_delete_estimate', { estimateGlobalId: dup.id }));
    expect(dup.status).toBe('DRAFT');
    expect(dup.id).not.toBe(est.id);

    const converted = await call('wave_convert_estimate_to_invoice', { estimateGlobalId: est.id });
    expect(converted.invoiceId).toMatch(/^\d+$/);
    onCleanup(`converted invoice ${converted.invoiceId}`, () => call('wave_delete_invoice', { invoiceId: converted.invoiceId }));
    const { invoice } = await call('wave_get_invoice', { invoiceId: converted.invoiceId });
    expect(invoice.customer.id).toBe(customer.id);
    expect((await call('wave_get_estimate', { estimateGlobalId: est.id })).estimate.status).toBe('CONVERTED');
  });

  it('updates the customer without losing its address, shipping details or contacts, then restores it', async () => {
    const { customer: before } = await call('wave_get_customer', { customerId: customer.id });
    const restore = {
      customerId: customer.id,
      internalNotes: before.internalNotes ?? '',
      address: {
        addressLine1: before.address?.addressLine1 ?? '', addressLine2: before.address?.addressLine2 ?? '', city: before.address?.city ?? '',
        provinceCode: before.address?.province ?? '', countryCode: before.address?.country ?? undefined, postalCode: before.address?.postalCode ?? '',
      },
      shippingDetails: before.shippingDetails,
      additionalContacts: (before.additionalContacts as Array<{ name: string; email: string | null; phone: string | null }>).map((c) => ({
        name: c.name, ...(c.email ? { email: c.email } : {}), ...(c.phone ? { phone: c.phone } : {}),
      })),
    };
    onCleanup('customer restore', () => call('wave_update_customer', restore));

    const { customer: noted } = await call('wave_update_customer', { customerId: customer.id, internalNotes: 'TEST - live contract check' });
    expect(noted.internalNotes).toBe('TEST - live contract check');
    expect(noted.address).toEqual(before.address);
    expect(noted.shippingDetails).toEqual(before.shippingDetails);

    const { customer: moved } = await call('wave_update_customer', { customerId: customer.id, address: { city: 'Testville' } });
    expect(moved.address).toEqual({ ...before.address, city: 'Testville' });

    const { customer: withContact } = await call('wave_update_customer', { customerId: customer.id, additionalContacts: [{ name: 'TEST - contact', email: customer.email }] });
    expect(withContact.additionalContacts.map((c: { name: string }) => c.name)).toEqual(['TEST - contact']);
  });

  it("creates statements and emails one to the test customer's own address", async () => {
    const outstanding = await call('wave_create_customer_statement', { customerId: customer.id, type: 'outstanding_invoices' });
    expect(outstanding.shareLink).toMatch(/^https:\/\//);
    const activity = await call('wave_create_customer_statement', { customerId: customer.id, type: 'account_activity' });
    expect(activity.statementId).toEqual(expect.any(String));
    await call('wave_send_customer_statement', {
      statementId: activity.statementId,
      type: 'account_activity',
      to: [customer.email],
      subject: 'TEST - statement send check',
      message: 'Automated contract check; please ignore.',
    });
  });

  it("emails an estimate to the test customer's own address", async () => {
    const est = await createEstimate();
    await call('wave_approve_estimate', { estimateGlobalId: est.id });
    await call('wave_send_estimate', {
      estimateGlobalId: est.id,
      to: [customer.email],
      subject: 'TEST - estimate send check',
      message: 'Automated contract check; please ignore.',
      ccMyself: false,
    });
    expect((await call('wave_get_estimate', { estimateGlobalId: est.id })).estimate.status).toBe('SENT');
  });
});
