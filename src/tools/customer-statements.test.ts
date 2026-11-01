import { describe, expect, it, vi } from 'vitest';
import { registerCustomerStatementTools } from './customer-statements.js';
import {
  CREATE_ACTIVITY_STATEMENT_MUTATION,
  CREATE_OUTSTANDING_STATEMENT_MUTATION,
  SEND_ACTIVITY_STATEMENT_MUTATION,
  SEND_OUTSTANDING_STATEMENT_MUTATION,
} from './_mutations.js';
import { BUSINESS_UUID, createMockClient, createStubServer } from './_test_utils.js';

const CUSTOMER = Buffer.from(`Business:${BUSINESS_UUID};Customer:201`, 'utf8').toString('base64');

function setup() {
  const stub = createStubServer();
  const mock = createMockClient();
  registerCustomerStatementTools(stub.server as never, mock.client);
  return { stub, mock };
}

describe('registerCustomerStatementTools', () => {
  it('creates an outstanding-invoices statement and returns its share link', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ outstandingInvoicesStatementCreate: { didSucceed: true, outstandingInvoicesStatement: { id: 'st1', reportDate: '2026-11-01', shareLink: 'https://example.com/s' } } });
    const out = await stub.parsed('wave_create_customer_statement', { customerId: 201, type: 'outstanding_invoices' });
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(CREATE_OUTSTANDING_STATEMENT_MUTATION);
    expect(call.variables).toEqual({ input: { customerId: CUSTOMER } });
    expect(out).toEqual({ statementId: 'st1', type: 'outstanding_invoices', reportDate: '2026-11-01', shareLink: 'https://example.com/s' });
  });

  it('defaults an account-activity statement to January 1 through today', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 20, 12));
    try {
      const { stub, mock } = setup();
      mock.gql.execute.mockResolvedValueOnce({ accountActivityStatementCreate: { didSucceed: true, accountActivityStatement: { id: 'st2', shareLink: 'l' } } });
      const out = await stub.parsed('wave_create_customer_statement', { customerGlobalId: CUSTOMER, type: 'account_activity' });
      const call = mock.gql.execute.mock.calls[0]![0];
      expect(call.query).toBe(CREATE_ACTIVITY_STATEMENT_MUTATION);
      expect(call.variables.input).toEqual({ customerId: CUSTOMER, fromDate: '2026-01-01', toDate: '2026-05-20' });
      expect(out).toMatchObject({ statementId: 'st2', fromDate: '2026-01-01', toDate: '2026-05-20' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends from the default verified sender with a subject naming the business', async () => {
    const { stub, mock } = setup();
    mock.rest.get.mockResolvedValueOnce({
      id: BUSINESS_UUID, company_name: 'Example Co',
      invoice_sending_emails: [{ email: 'unverified@example.com', default: false, verified: false }, { email: 'billing@example.com', default: true, verified: true }],
    });
    mock.gql.execute.mockResolvedValueOnce({ accountActivityStatementSend: { didSucceed: true } });
    const out = await stub.parsed('wave_send_customer_statement', { statementId: 'st2', type: 'account_activity', to: ['client@example.com'] });
    const call = mock.gql.execute.mock.calls[0]![0];
    expect(call.query).toBe(SEND_ACTIVITY_STATEMENT_MUTATION);
    expect(call.variables.input).toEqual({
      id: 'st2', to: ['client@example.com'], subject: 'Statement of account activity from Example Co',
      message: 'Here is your latest statement.', fromAddress: 'billing@example.com', ccMyself: false,
    });
    expect(out).toMatchObject({ ok: true, fromAddress: 'billing@example.com' });
  });

  it('skips the business read when sender and subject are given', async () => {
    const { stub, mock } = setup();
    mock.gql.execute.mockResolvedValueOnce({ outstandingInvoicesStatementSend: { didSucceed: true } });
    await stub.invoke('wave_send_customer_statement', { statementId: 'st1', type: 'outstanding_invoices', to: ['c@example.com'], subject: 'S', fromAddress: 'me@example.com' });
    expect(mock.rest.get).not.toHaveBeenCalled();
    expect(mock.gql.execute.mock.calls[0]![0].query).toBe(SEND_OUTSTANDING_STATEMENT_MUTATION);
  });
});
