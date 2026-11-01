import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerInvoiceActionTools } from './invoice-actions.js';
import { DUPLICATE_INVOICE_MUTATION, INVOICE_PDF_MUTATION, INVOICE_REMINDER_MUTATION, PAYMENT_RECEIPT_MUTATION } from './_mutations.js';
import { WaveMutationError } from '../client/errors.js';
import { BUSINESS_UUID, createMockClient, createStubServer } from './_test_utils.js';

const rel = (type: string, id: string): string => Buffer.from(`Business:${BUSINESS_UUID};${type}:${id}`, 'utf8').toString('base64');
const INVOICE = '2520825210135910924';

function setup() {
  const stub = createStubServer();
  const mock = createMockClient();
  registerInvoiceActionTools(stub.server as never, mock.client);
  return { stub, mock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerInvoiceActionTools', () => {
  it('registers the invoice action tools', () => {
    const { stub } = setup();
    expect([...stub.handlers.keys()].sort()).toEqual(['wave_duplicate_invoice', 'wave_get_invoice_pdf', 'wave_send_invoice_reminder', 'wave_send_payment_receipt']);
  });

  it('wave_get_invoice_pdf embeds the PDF from the signed link', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ invoiceGeneratePdf: { didSucceed: true, pdfUrl: 'https://files.example.com/i.pdf?sig=TEST_SIG' } });
    const pdf = new TextEncoder().encode('%PDF-1.7 test');
    const fetchSpy = vi.fn(async () => new Response(pdf, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const result = (await stub.invoke('wave_get_invoice_pdf', { invoiceId: INVOICE })) as { content: Array<Record<string, any>> };
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(INVOICE_PDF_MUTATION);
    expect(call.variables).toEqual({ input: { invoiceId: rel('Invoice', INVOICE) } });
    expect(fetchSpy).toHaveBeenCalledWith('https://files.example.com/i.pdf?sig=TEST_SIG');
    expect(JSON.parse(result.content[0]!['text'])).toMatchObject({ invoiceId: INVOICE, fileName: `invoice-${INVOICE}.pdf`, embedded: true });
    expect(result.content[1]!['resource']).toMatchObject({ mimeType: 'application/pdf', blob: Buffer.from(pdf).toString('base64') });
  });

  it('wave_duplicate_invoice returns the copy as an integer invoice id', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ invoiceClone: { didSucceed: true, invoice: { id: rel('Invoice', '99'), invoiceNumber: '227', status: 'DRAFT' } } });
    const out = await stub.parsed('wave_duplicate_invoice', { invoiceId: INVOICE });
    expect(mock.gql.execute.mock.calls[0]![0].query).toBe(DUPLICATE_INVOICE_MUTATION);
    expect(out).toEqual({ invoiceId: '99', invoiceNumber: '227', status: 'DRAFT', copiedFrom: INVOICE });
  });

  it('wave_send_invoice_reminder sends only the email fields it was given', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ invoiceReminderCreate: { didSucceed: true } });
    await stub.invoke('wave_send_invoice_reminder', { invoiceId: INVOICE, to: ['client@example.com'], subject: 'Reminder' });
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(INVOICE_REMINDER_MUTATION);
    expect(call.variables.input).toEqual({ invoiceId: rel('Invoice', INVOICE), to: ['client@example.com'], ccMyself: false, subject: 'Reminder' });
  });

  it('wave_send_payment_receipt composes the InvoicePayment Relay id from the REST payment id', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ invoicePaymentReceiptSend: { didSucceed: true } });
    await stub.invoke('wave_send_payment_receipt', { invoiceId: INVOICE, paymentId: '777', to: ['client@example.com'], fromAddress: 'me@example.com' });
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(PAYMENT_RECEIPT_MUTATION);
    expect(call.variables.input).toEqual({
      invoiceId: rel('Invoice', INVOICE), invoicePaymentId: rel('InvoicePayment', '777'),
      to: ['client@example.com'], ccMyself: false, fromAddress: 'me@example.com', attachPdf: false,
    });
  });

  it('turns a refused reminder into a WaveMutationError', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ invoiceReminderCreate: { didSucceed: false, inputErrors: [{ message: 'Invoice is paid' }] } });
    await expect(stub.invoke('wave_send_invoice_reminder', { invoiceId: INVOICE, to: ['c@example.com'] })).rejects.toThrow(WaveMutationError);
  });
});
