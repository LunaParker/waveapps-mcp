import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { requireDidSucceed, type WaveInputError } from '../client/errors.js';
import { toCompositeGlobalId } from '../client/ids.js';
import { ACCOUNT_IDS_QUERY, GET_TRANSACTION_QUERY, LIST_TRANSACTIONS_QUERY } from './_queries.js';
import { CREATE_TRANSACTION_MUTATION, DELETE_TRANSACTION_MUTATION, PATCH_TRANSACTION_MUTATION } from './_mutations.js';
import { flattenConnection, jsonResult } from './_helpers.js';
import { shapeTransaction, type TransactionSummary } from './_shape.js';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Amount = z.string().regex(/^\d+(\.\d{1,2})?$/).describe('Positive decimal string, e.g. "125.00".');
const TransactionSort = z.enum(['DATE_DESC', 'DATE_ASC', 'DATE_CREATED_DESC', 'DATE_CREATED_ASC']);
const transactionId = z.string().min(1).describe('Relay `id` from wave_list_transactions.');
const AccountRef = z.union([z.number().int().positive(), z.string().min(1)]);
const sequence = z.number().int().min(0).optional().describe("The transaction's current `sequence`; read automatically when left out.");

interface Payload {
  didSucceed: boolean;
  inputErrors?: ReadonlyArray<WaveInputError> | null;
  transaction?: unknown;
}

/** Wave's double entry: money into the bank debits it and credits the category; money out does the reverse. */
const ITEM_TYPES = { deposit: { anchor: 'DEBIT', category: 'CREDIT' }, withdrawal: { anchor: 'CREDIT', category: 'DEBIT' } } as const;

export function registerTransactionTools(server: McpServer, client: WaveClient): void {
  /** GraphQL wants Relay account ids; callers pass the integer ids wave_list_accounts gives. */
  const accountRelayIds = async (businessId: string | undefined, refs: Array<number | string>): Promise<Map<number | string, string>> => {
    const ids = refs.filter((r): r is number => typeof r === 'number');
    const byRef = new Map<number | string, string>(refs.filter((r): r is string => typeof r === 'string').map((r) => [r, r]));
    if (ids.length === 0) return byRef;
    const data = await client.gql.execute<{ business: { accounts: { edges: ReadonlyArray<{ node: { id: string; classicId: string | null; name: string } }> } } }>({
      operationName: 'ListAccountIds',
      query: ACCOUNT_IDS_QUERY,
      variables: { businessId: client.businessGlobalId(businessId) },
    });
    const nodes = data.business.accounts.edges.map((e) => e.node);
    for (const node of nodes) if (node.classicId !== null) byRef.set(Number(node.classicId), node.id);
    const missing = ids.filter((id) => !byRef.has(id));
    if (missing.length > 0) {
      // System accounts (exchange gains, payroll and so on) have no classicId; match those by their unique name.
      const rest = await client.rest.get<ReadonlyArray<{ id: number; name: string }>>(`/businesses/${client.businessId(businessId)}/accounts/`, { active_only: false });
      for (const id of missing) {
        const name = rest.find((a) => a.id === id)?.name;
        const same = nodes.filter((n) => n.name === name);
        if (name !== undefined && same.length === 1) byRef.set(id, same[0]!.id);
      }
    }
    for (const id of ids) if (!byRef.has(id)) throw new Error(`No active account with id ${id}; pick one from wave_list_accounts.`);
    return byRef;
  };
  /** The shaped transaction, plus the line `order`s a patch must quote (Wave identifies lines by them). */
  const readTransaction = async (businessId: string | undefined, id: string): Promise<TransactionSummary & { anchorOrder: number | null; lineOrders: Array<number | null> }> => {
    const data = await client.gql.execute<{ business: { transaction: unknown } | null }>({
      operationName: 'GetTransaction',
      query: GET_TRANSACTION_QUERY,
      variables: { businessId: client.businessGlobalId(businessId), transactionId: id },
    });
    const raw = data.business?.transaction as { anchorLineItem?: { order?: number } | null; lineItems?: Array<{ order?: number }> } | undefined;
    if (!raw) throw new Error(`No transaction with id ${id} in this business.`);
    return {
      ...shapeTransaction(raw),
      anchorOrder: raw.anchorLineItem?.order ?? null,
      lineOrders: (raw.lineItems ?? []).map((l) => l.order ?? null),
    };
  };
  const customerRelay = (businessId: string | undefined, customerId: number | undefined): Record<string, string> =>
    customerId === undefined ? {} : { customerId: toCompositeGlobalId(client.businessId(businessId), 'Customer', customerId) };

  server.registerTool(
    'wave_list_transactions',
    {
      title: 'List Wave transactions',
      description:
        "Lists bookkeeping transactions (bank and cash activity, manual entries, receipts), newest first. Each has its bank or cash `account`, the category `lines` it splits into, tags and a `sequence` the update and delete tools need. Account `id`s are the integers wave_list_accounts uses. Page with `after` set to the previous `pageInfo.endCursor`.",
      inputSchema: {
        businessId: z.uuid().optional(),
        first: z.number().int().min(1).max(100).default(25),
        after: z.string().optional(),
        startDate: IsoDate.optional(),
        endDate: IsoDate.optional(),
        description: z.string().min(1).optional().describe('Match on the description.'),
        tagIds: z.array(z.string()).optional().describe('Tag `id`s from wave_list_tags.'),
        sort: TransactionSort.default('DATE_DESC'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const filters: Record<string, unknown> = {};
      if (args.startDate !== undefined) filters['startDate'] = args.startDate;
      if (args.endDate !== undefined) filters['endDate'] = args.endDate;
      if (args.description !== undefined) filters['description'] = args.description;
      if (args.tagIds !== undefined) filters['tagIds'] = args.tagIds;
      const data = await client.gql.execute<{ business: { transactions: { pageInfo: unknown; edges: ReadonlyArray<{ node: unknown }> } } }>({
        operationName: 'ListTransactions',
        query: LIST_TRANSACTIONS_QUERY,
        variables: { businessId: client.businessGlobalId(args.businessId), first: args.first, after: args.after ?? null, filters, sort: [args.sort] },
      });
      const conn = data.business.transactions;
      return jsonResult({ transactions: flattenConnection(conn).map(shapeTransaction), pageInfo: conn.pageInfo });
    },
  );

  server.registerTool(
    'wave_get_transaction',
    {
      title: 'Get one Wave transaction',
      description: 'Fetches one transaction with its account, category lines, tags and current `sequence`.',
      inputSchema: { businessId: z.uuid().optional(), transactionId },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, transactionId: id }) => {
      const { anchorOrder: _a, lineOrders: _l, ...transaction } = await readTransaction(businessId, id);
      return jsonResult({ transaction });
    },
  );

  server.registerTool(
    'wave_create_transaction',
    {
      title: 'Record a Wave transaction',
      description:
        "Records money in (deposit) or out (withdrawal) of a bank, cash or credit-card account, categorised to one income or expense account. `accountId` and `categoryAccountId` are integer ids from wave_list_accounts (`is_payment: true` accounts for `accountId`). Sales tax isn't supported here; record taxable sales as invoices.",
      inputSchema: {
        businessId: z.uuid().optional(),
        date: IsoDate,
        description: z.string().min(1),
        amount: Amount,
        direction: z.enum(['deposit', 'withdrawal']),
        accountId: AccountRef.describe('Bank, cash or credit-card account the money moved through: an integer id, or an account `relayId`.'),
        categoryAccountId: AccountRef.describe('Income or expense account to categorise it to: an integer id, or an account `relayId`.'),
        notes: z.string().optional(),
        customerId: z.number().int().positive().optional().describe('Integer `internalId` from wave_list_customers, for income from a customer.'),
        tagIds: z.array(z.string()).optional().describe('Tag `id`s from wave_list_tags.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const ids = await accountRelayIds(args.businessId, [args.accountId, args.categoryAccountId]);
      const types = ITEM_TYPES[args.direction];
      const line: Record<string, unknown> = {
        category: { type: 'ACCOUNT_ID', accountId: ids.get(args.categoryAccountId) },
        amount: args.amount,
        itemType: types.category,
        ...customerRelay(args.businessId, args.customerId),
      };
      if (args.tagIds !== undefined) line['tagIds'] = args.tagIds;
      const input: Record<string, unknown> = {
        businessId: client.businessGlobalId(args.businessId),
        date: args.date,
        description: args.description,
        anchorLineItem: { category: { type: 'ACCOUNT_ID', accountId: ids.get(args.accountId) }, amount: args.amount, itemType: types.anchor },
        lineItems: [line],
      };
      if (args.notes !== undefined) input['notes'] = args.notes;
      const data = await client.gql.execute<{ transactionCreate: Payload }>({ operationName: 'CreateTransaction', query: CREATE_TRANSACTION_MUTATION, variables: { input } });
      return jsonResult({ transaction: shapeTransaction(requireDidSucceed('CreateTransaction', data.transactionCreate).transaction) });
    },
  );

  server.registerTool(
    'wave_update_transaction',
    {
      title: 'Update a Wave transaction',
      description:
        "Changes a transaction's date, description or notes, and for a single-category transaction its amount, category, customer or tags. Fields left out stay as they are. The tool reads the current `sequence` itself.",
      inputSchema: {
        businessId: z.uuid().optional(),
        transactionId,
        sequence,
        date: IsoDate.optional(),
        description: z.string().min(1).optional(),
        notes: z.string().optional(),
        amount: Amount.optional(),
        categoryAccountId: AccountRef.optional().describe('Integer id from wave_list_accounts, or an account `relayId`.'),
        customerId: z.number().int().positive().optional(),
        tagIds: z.array(z.string()).optional().describe('Replaces the tags; [] removes them all.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const lineChange = args.amount !== undefined || args.categoryAccountId !== undefined || args.customerId !== undefined || args.tagIds !== undefined;
      // Line changes rebuild the stored line, so they always need the current transaction.
      const current = lineChange || args.sequence === undefined ? await readTransaction(args.businessId, args.transactionId) : null;
      const input: Record<string, unknown> = { id: args.transactionId, sequence: args.sequence ?? current?.sequence };
      if (args.date !== undefined) input['date'] = args.date;
      if (args.description !== undefined) input['description'] = args.description;
      if (args.notes !== undefined) input['notes'] = args.notes;
      if (lineChange && current) {
        const [line, ...rest] = current.lines;
        if (!line || rest.length > 0) throw new Error('Only a transaction with exactly one category line can change its amount, category, customer or tags here.');
        const ids = args.categoryAccountId === undefined ? null : await accountRelayIds(args.businessId, [args.categoryAccountId]);
        const amount = args.amount ?? String(line.amount ?? current.amount ?? '');
        const next: Record<string, unknown> = {
          order: current.lineOrders[0] ?? 0,
          category: { type: 'ACCOUNT_ID', accountId: ids && args.categoryAccountId !== undefined ? ids.get(args.categoryAccountId) : line.account?.relayId },
          amount,
          itemType: line.itemType,
          tagIds: args.tagIds ?? line.tags.map((t) => t.id).filter((id): id is string => id !== null),
          ...(args.customerId !== undefined ? customerRelay(args.businessId, args.customerId) : line.customer?.id ? { customerId: line.customer.id } : {}),
        };
        if (line.description) next['description'] = line.description;
        input['lineItems'] = [next];
        if (args.amount !== undefined && current.account) {
          input['anchorLineItem'] = {
            order: current.anchorOrder ?? 0,
            category: { type: 'ACCOUNT_ID', accountId: current.account.relayId },
            amount,
            itemType: line.itemType === 'CREDIT' ? 'DEBIT' : 'CREDIT',
          };
        }
      }
      const data = await client.gql.execute<{ transactionPatch: Payload }>({ operationName: 'PatchTransaction', query: PATCH_TRANSACTION_MUTATION, variables: { input } });
      return jsonResult({ transaction: shapeTransaction(requireDidSucceed('PatchTransaction', data.transactionPatch).transaction) });
    },
  );

  server.registerTool(
    'wave_delete_transaction',
    {
      title: 'Delete a Wave transaction',
      description: 'Deletes a transaction from the books. This cannot be undone; confirm with the user first. Transactions in a reconciled period should be left alone.',
      inputSchema: { businessId: z.uuid().optional(), transactionId, sequence },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const seq = args.sequence ?? (await readTransaction(args.businessId, args.transactionId)).sequence;
      const data = await client.gql.execute<{ transactionDelete: { didSucceed: boolean; deletedTransactionIds?: string[] | null } }>({
        operationName: 'DeleteTransaction',
        query: DELETE_TRANSACTION_MUTATION,
        variables: { input: { id: args.transactionId, sequence: seq } },
      });
      requireDidSucceed('DeleteTransaction', data.transactionDelete);
      return jsonResult({ ok: true, deletedTransactionIds: data.transactionDelete.deletedTransactionIds ?? [args.transactionId] });
    },
  );
}
