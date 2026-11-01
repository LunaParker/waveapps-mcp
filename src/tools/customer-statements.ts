import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { requireDidSucceed, type WaveInputError } from '../client/errors.js';
import { toCompositeGlobalId } from '../client/ids.js';
import { todayIso } from '../util/dates.js';
import {
  CREATE_ACTIVITY_STATEMENT_MUTATION,
  CREATE_OUTSTANDING_STATEMENT_MUTATION,
  SEND_ACTIVITY_STATEMENT_MUTATION,
  SEND_OUTSTANDING_STATEMENT_MUTATION,
} from './_mutations.js';
import { jsonResult } from './_helpers.js';
import { shapeBusiness } from './_shape.js';

const StatementType = z
  .enum(['outstanding_invoices', 'account_activity'])
  .describe('outstanding_invoices lists what the customer still owes; account_activity lists invoices and payments over a date range.');
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

interface Payload {
  didSucceed: boolean;
  inputErrors?: ReadonlyArray<WaveInputError> | null;
  outstandingInvoicesStatement?: Record<string, unknown> | null;
  accountActivityStatement?: Record<string, unknown> | null;
}

const SUBJECT = { outstanding_invoices: 'Statement of outstanding invoices', account_activity: 'Statement of account activity' } as const;

export function registerCustomerStatementTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_create_customer_statement',
    {
      title: 'Create a Wave customer statement',
      description:
        "Builds a customer statement and returns its `statementId` and `shareLink`, a page the customer can open without signing in. account_activity covers `fromDate` to `toDate` (default January 1 of this year to today). Email it with wave_send_customer_statement.",
      inputSchema: {
        businessId: z.uuid().optional(),
        customerId: z.number().int().positive().optional().describe('Integer `internalId` from wave_list_customers.'),
        customerGlobalId: z.string().optional().describe('Relay `id` from wave_list_customers, instead of customerId.'),
        type: StatementType,
        fromDate: IsoDate.optional(),
        toDate: IsoDate.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const customer =
        args.customerGlobalId ??
        (args.customerId != null ? toCompositeGlobalId(client.businessId(args.businessId), 'Customer', args.customerId) : null);
      if (!customer) throw new Error('Provide either customerId or customerGlobalId.');
      if (args.type === 'outstanding_invoices') {
        const data = await client.gql.execute<{ outstandingInvoicesStatementCreate: Payload }>({
          operationName: 'CreateOutstandingInvoicesStatement',
          query: CREATE_OUTSTANDING_STATEMENT_MUTATION,
          variables: { input: { customerId: customer } },
        });
        const s = requireDidSucceed('CreateOutstandingInvoicesStatement', data.outstandingInvoicesStatementCreate).outstandingInvoicesStatement ?? {};
        return jsonResult({ statementId: s['id'] ?? null, type: args.type, reportDate: s['reportDate'] ?? null, shareLink: s['shareLink'] ?? null });
      }
      const today = todayIso();
      const fromDate = args.fromDate ?? `${today.slice(0, 4)}-01-01`;
      const toDate = args.toDate ?? today;
      const data = await client.gql.execute<{ accountActivityStatementCreate: Payload }>({
        operationName: 'CreateAccountActivityStatement',
        query: CREATE_ACTIVITY_STATEMENT_MUTATION,
        variables: { input: { customerId: customer, fromDate, toDate } },
      });
      const s = requireDidSucceed('CreateAccountActivityStatement', data.accountActivityStatementCreate).accountActivityStatement ?? {};
      return jsonResult({ statementId: s['id'] ?? null, type: args.type, fromDate: s['fromDate'] ?? fromDate, toDate: s['toDate'] ?? toDate, shareLink: s['shareLink'] ?? null });
    },
  );

  server.registerTool(
    'wave_send_customer_statement',
    {
      title: 'Email a Wave customer statement',
      description:
        "Emails a statement from wave_create_customer_statement (pass its `statementId` and `type`). This cannot be undone; confirm the recipients with the user first. `fromAddress` defaults to the business's default verified sender (`invoice_sending_emails` on wave_get_business); the subject defaults to the statement type and business name.",
      inputSchema: {
        businessId: z.uuid().optional(),
        statementId: z.string().min(1),
        type: StatementType,
        to: z.array(z.email()).min(1).max(10).describe("Recipients, usually the customer's email from wave_get_customer."),
        subject: z.string().min(1).optional(),
        message: z.string().default('Here is your latest statement.'),
        fromAddress: z.email().optional(),
        ccMyself: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      let { fromAddress, subject } = args;
      if (fromAddress === undefined || subject === undefined) {
        const id = client.businessId(args.businessId);
        const business = shapeBusiness(await client.rest.get<unknown>(`/businesses/${id}/`));
        const senders = business.invoice_sending_emails.filter((e) => e.verified && e.email);
        fromAddress ??= (senders.find((e) => e.default) ?? senders[0])?.email ?? undefined;
        if (!fromAddress) throw new Error('This business has no verified sending address; pass fromAddress.');
        subject ??= `${SUBJECT[args.type]} from ${business.company_name ?? 'us'}`;
      }
      const input = { id: args.statementId, to: args.to, subject, message: args.message, fromAddress, ccMyself: args.ccMyself };
      const [operationName, query, field] =
        args.type === 'outstanding_invoices'
          ? (['SendOutstandingInvoicesStatement', SEND_OUTSTANDING_STATEMENT_MUTATION, 'outstandingInvoicesStatementSend'] as const)
          : (['SendAccountActivityStatement', SEND_ACTIVITY_STATEMENT_MUTATION, 'accountActivityStatementSend'] as const);
      const data = await client.gql.execute<Record<string, Payload>>({ operationName, query, variables: { input } });
      requireDidSucceed(operationName, data[field]);
      return jsonResult({ ok: true, statementId: args.statementId, to: args.to, fromAddress, subject });
    },
  );
}
