import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerEstimateLifecycleTools } from './estimate-lifecycle.js';
import { GET_ESTIMATE_QUERY } from './_queries.js';
import {
  ACCEPT_ESTIMATE_MUTATION,
  APPROVE_ESTIMATE_MUTATION,
  CONVERT_ESTIMATE_MUTATION,
  DUPLICATE_ESTIMATE_MUTATION,
  ESTIMATE_PDF_MUTATION,
  MARK_ESTIMATE_SENT_MUTATION,
  RESET_ESTIMATE_ACCEPTANCE_MUTATION,
  SEND_ESTIMATE_MUTATION,
} from './_mutations.js';
import { WaveMutationError } from '../client/errors.js';
import { BUSINESS_GLOBAL_ID, BUSINESS_UUID, createMockClient, createStubServer } from './_test_utils.js';

const rel = (type: string, id: number | string): string => Buffer.from(`Business:${BUSINESS_UUID};${type}:${id}`, 'utf8').toString('base64');
const EST = rel('Estimate', 77);

function setup() {
  const stub = createStubServer();
  const mock = createMockClient();
  registerEstimateLifecycleTools(stub.server as never, mock.client);
  return { stub, mock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerEstimateLifecycleTools', () => {
  it('registers the estimate lifecycle tools', () => {
    const { stub } = setup();
    expect([...stub.handlers.keys()].sort()).toEqual([
      'wave_accept_estimate',
      'wave_approve_estimate',
      'wave_convert_estimate_to_invoice',
      'wave_duplicate_estimate',
      'wave_get_estimate',
      'wave_get_estimate_pdf',
      'wave_mark_estimate_sent',
      'wave_reset_estimate_acceptance',
      'wave_send_estimate',
    ]);
  });

  it('wave_get_estimate shapes the estimate with the fields wave_update_estimate takes', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({
      business: {
        id: BUSINESS_GLOBAL_ID,
        estimate: {
          id: EST, estimateNumber: '12', status: 'DRAFT', title: 'Estimate', subhead: '', estimateDate: '2026-11-01', dueDate: '2026-12-01',
          poNumber: 'PO-1', memo: 'm', footer: 'f', currency: { code: 'CAD' }, exchangeRate: '1', customer: { id: rel('Customer', 5), name: 'Test Co', email: 't@example.com' },
          items: [{
            id: rel('EstimateItem', 1), product: { id: rel('Product', 9), name: 'Design' }, description: 'logo', quantity: '2', unitPrice: '50',
            account: { classicId: '301', name: 'Sales' }, subtotal: { value: '100.00' }, total: { value: '113.00' },
            taxes: [{ salesTax: { id: rel('SalesTax', 401), name: 'Harmonized Sales Tax', abbreviation: 'HST', rate: '0.13' }, amount: { value: '13.00' } }],
          }],
          itemTitle: 'Items', unitTitle: 'Quantity', priceTitle: 'Price', amountTitle: 'Amount', subtotal: { value: '100.00' },
          discountTotal: { value: '0.00' }, taxTotal: { value: '13.00' }, total: { value: '113.00' }, amountDue: { value: '113.00' },
          amountPaid: { value: '0.00' }, createdAt: '2026-11-01T10:00:00Z', lastSentAt: null, lastSentVia: null, lastViewedAt: null,
          viewUrl: 'https://example.com/v', dontCarryOverNotesToInvoice: false, disableCreditCardPayments: true, disableAmexPayments: true,
          depositStatus: 'DISABLED', depositUnit: null, depositValue: null, depositPaymentStatus: null,
        },
      },
    });
    const out = (await stub.parsed('wave_get_estimate', { estimateGlobalId: EST })) as { estimate: Record<string, unknown> };
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(GET_ESTIMATE_QUERY);
    expect(call.variables).toEqual({ businessId: BUSINESS_GLOBAL_ID, estimateId: EST });
    expect(out.estimate).toMatchObject({
      id: EST, internalId: '77', estimateNumber: '12', status: 'DRAFT', poNumber: 'PO-1', currency: 'CAD', total: '113.00', taxTotal: '13.00',
      customer: { id: rel('Customer', 5), name: 'Test Co', email: 't@example.com' },
      items: [{
        productId: 9, name: 'Design', description: 'logo', quantity: '2', unitPrice: '50', incomeAccountClassicId: '301', incomeAccountName: 'Sales',
        taxes: [{ salesTaxId: 401, name: 'Harmonized Sales Tax', abbreviation: 'HST', rate: 0.13, amount: '13.00' }],
      }],
    });
  });

  it('wave_get_estimate throws when the estimate is missing', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ business: { id: BUSINESS_GLOBAL_ID, estimate: null } });
    await expect(stub.invoke('wave_get_estimate', { estimateGlobalId: EST })).rejects.toThrow(/No estimate/);
  });

  it.each([
    ['wave_approve_estimate', APPROVE_ESTIMATE_MUTATION, 'estimateApprove', 'APPROVED'],
    ['wave_accept_estimate', ACCEPT_ESTIMATE_MUTATION, 'estimateMarkAccepted', 'ACCEPTED'],
    ['wave_reset_estimate_acceptance', RESET_ESTIMATE_ACCEPTANCE_MUTATION, 'estimateResetAcceptance', 'APPROVED'],
    ['wave_duplicate_estimate', DUPLICATE_ESTIMATE_MUTATION, 'estimateClone', 'DRAFT'],
  ])('%s sends the estimate id and returns the estimate', async (tool, query, field, status) => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ [field]: { didSucceed: true, inputErrors: null, estimate: { id: EST, estimateNumber: '12', status } } });
    const out = await stub.parsed(tool, { estimateGlobalId: EST });
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(query);
    expect(call.variables).toEqual({ input: { estimateId: EST } });
    expect(out).toEqual({ estimate: { id: EST, internalId: '77', estimateNumber: '12', status } });
  });

  it('turns didSucceed: false into a WaveMutationError with Wave\'s reason', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ estimateApprove: { didSucceed: false, inputErrors: [{ message: 'Estimate is not a draft', path: ['estimateId'] }] } });
    await expect(stub.invoke('wave_approve_estimate', { estimateGlobalId: EST })).rejects.toThrow(WaveMutationError);
  });

  it('wave_send_estimate leaves optional fields out and defaults ccMyself off', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ estimateSend: { didSucceed: true, inputErrors: null } });
    await stub.invoke('wave_send_estimate', { estimateGlobalId: EST, to: ['client@example.com'] });
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(SEND_ESTIMATE_MUTATION);
    expect(call.variables.input).toEqual({ estimateId: EST, to: ['client@example.com'], ccMyself: false, attachPDF: true, includeAttachments: false });
  });

  it('wave_send_estimate forwards subject, message and sender when given', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ estimateSend: { didSucceed: true } });
    await stub.invoke('wave_send_estimate', { estimateGlobalId: EST, to: ['a@example.com'], subject: 'S', message: 'M', fromAddress: 'me@example.com' });
    expect(mock.gql.execute.mock.calls[0]![0].variables.input).toMatchObject({ subject: 'S', message: 'M', fromAddress: 'me@example.com' });
  });

  it('wave_mark_estimate_sent defaults to MARKED_SENT and passes sentAt through', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValue({ estimateMarkSent: { didSucceed: true, estimate: { id: EST, status: 'SENT' } } });
    await stub.invoke('wave_mark_estimate_sent', { estimateGlobalId: EST });
    expect(mock.gql.execute.mock.calls[0]![0].query).toBe(MARK_ESTIMATE_SENT_MUTATION);
    expect(mock.gql.execute.mock.calls[0]![0].variables.input).toEqual({ estimateId: EST, sendMethod: 'MARKED_SENT' });
    await stub.invoke('wave_mark_estimate_sent', { estimateGlobalId: EST, sendMethod: 'GMAIL', sentAt: '2026-11-01T09:00:00-04:00' });
    expect(mock.gql.execute.mock.calls[1]![0].variables.input).toEqual({ estimateId: EST, sendMethod: 'GMAIL', sentAt: '2026-11-01T09:00:00-04:00' });
  });

  it('wave_convert_estimate_to_invoice returns the integer invoice id the invoice tools take', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ convertEstimateToInvoice: { didSucceed: true, invoiceId: rel('Invoice', '2520825210135910924') } });
    const out = await stub.parsed('wave_convert_estimate_to_invoice', { estimateGlobalId: EST });
    expect(mock.gql.execute.mock.calls[0]![0].query).toBe(CONVERT_ESTIMATE_MUTATION);
    expect(out).toEqual({ invoiceId: '2520825210135910924', invoiceGlobalId: rel('Invoice', '2520825210135910924'), estimateGlobalId: EST });
  });

  it('wave_get_estimate_pdf embeds the downloaded PDF without sending Wave credentials', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ estimateGeneratePdf: { didSucceed: true, pdfUrl: 'https://files.example.com/e.pdf?sig=TEST_SIG' } });
    const pdf = new TextEncoder().encode('%PDF-1.4 test');
    const fetchSpy = vi.fn(async () => new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const result = (await stub.invoke('wave_get_estimate_pdf', { estimateGlobalId: EST })) as { content: Array<Record<string, unknown>> };
    expect(mock.gql.execute.mock.calls[0]![0].query).toBe(ESTIMATE_PDF_MUTATION);
    expect(fetchSpy).toHaveBeenCalledWith('https://files.example.com/e.pdf?sig=TEST_SIG');
    const meta = JSON.parse(result.content[0]!['text'] as string);
    expect(meta).toMatchObject({ estimateGlobalId: EST, fileName: 'estimate-77.pdf', bytes: pdf.byteLength, embedded: true });
    expect(result.content[1]).toEqual({
      type: 'resource',
      resource: { uri: 'wave-pdf:///estimate-77.pdf', mimeType: 'application/pdf', blob: Buffer.from(pdf).toString('base64') },
    });
  });
});
