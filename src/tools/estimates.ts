import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { toCompositeGlobalId } from '../client/ids.js';
import { requireDidSucceed } from '../client/errors.js';
import { addDays, todayIso } from '../util/dates.js';
import { ESTIMATES_QUERY } from './_queries.js';
import {
  CREATE_ESTIMATE_MUTATION,
  DELETE_ESTIMATE_MUTATION,
  PATCH_ESTIMATE_MUTATION,
} from './_mutations.js';
import { flattenConnection, jsonResult } from './_helpers.js';
import { shapeBusiness, shapeEstimate } from './_shape.js';

const EstimateSort = z.enum([
  'ESTIMATE_DATE_DESC',
  'ESTIMATE_DATE_ASC',
  'ESTIMATE_NUMBER_DESC',
  'ESTIMATE_NUMBER_ASC',
]);
const EstimateLifecycleStatus = z.enum(['DRAFT', 'SENT', 'VIEWED', 'APPROVED', 'ACCEPTED', 'CONVERTED', 'EXPIRED']);
const EstimateDepositStatus = z.enum(['DISABLED', 'ENABLED_OPTIONAL', 'ENABLED_MANDATORY']);
const EstimateDepositUnit = z.enum(['AMOUNT', 'PERCENTAGE']);
// Values checked against Wave's live schema (npm run test:live re-checks every one); ALL means no filter.
const EstimateListStatus = z.enum(['ALL', 'ACTIVE', 'DRAFT', 'SENT', 'VIEWED', 'APPROVED', 'ACCEPTED', 'CONVERTED', 'EXPIRED', 'PAID', 'UNPAID']);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const DEFAULT_VALIDITY_DAYS = 30;

const EstimateItemInput = z.object({
  productId: z
    .number()
    .int()
    .positive()
    .describe('Wave integer product ID. From `wave_list_invoices` (`items[].product.id`) or the legacy products UI.'),
  name: z.string().min(1).describe('Display name on the estimate line.'),
  description: z.string().nullish(),
  unitPrice: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .describe('Decimal as a string. e.g. "150.00".'),
  quantity: z.string().regex(/^\d+(\.\d+)?$/).default('1'),
  incomeAccountClassicId: z
    .string()
    .describe('Integer income account ID as a string. From `wave_list_invoices` (`items[].product.income_account.id`).'),
  taxIds: z
    .array(z.union([z.number().int().positive(), z.string().min(1)]))
    .default([])
    .describe(
      "Sales taxes to apply to this line: integer `id`s from wave_list_sales_taxes (the same ids invoices take), or its `relayId` strings. Empty for none.",
    ),
});

interface EstimateBucket {
  edges: ReadonlyArray<{ node: unknown }>;
  pageInfo: { currentPage: number; totalCount: number; totalPages: number };
}
interface EstimatesResponse {
  business: {
    id: string;
    allEstimates: EstimateBucket;
    draftEstimates: EstimateBucket;
    activeEstimates: EstimateBucket;
  };
}

interface MutationPayload {
  didSucceed: boolean;
  inputErrors?: ReadonlyArray<{ message: string; path?: ReadonlyArray<string | number> | null }> | null;
  estimate?: { id: string; estimateNumber: string } | null;
}

function itemsForApi(
  items: ReadonlyArray<z.infer<typeof EstimateItemInput>>,
  businessUuid: string,
): unknown[] {
  return items.map((it) => ({
    productId: toCompositeGlobalId(businessUuid, 'Product', it.productId),
    name: it.name,
    description: it.description ?? null,
    unitPrice: it.unitPrice,
    quantity: it.quantity,
    incomeAccountClassicId: it.incomeAccountClassicId,
    // Wave wants { salesTaxId } objects here; a bare ID fails as "Expected type EstimateCreateItemTaxInput".
    taxes: it.taxIds.map((id) => ({
      salesTaxId: typeof id === 'number' ? toCompositeGlobalId(businessUuid, 'SalesTax', id) : id,
    })),
  }));
}

const NUMBER_CHECK_LIMIT = 20;

async function listEstimateNumbers(client: WaveClient, businessGlobalId: string, variables: Record<string, unknown>): Promise<string[]> {
  const data = await client.gql.execute<EstimatesResponse>({
    operationName: 'GetEstimates',
    query: ESTIMATES_QUERY,
    variables: { businessId: businessGlobalId, page: 1, pageSize: 50, activeStatus: 'ACTIVE', draftStatus: 'DRAFT', ...variables },
  });
  return flattenConnection(data.business.allEstimates)
    .map((n) => shapeEstimate(n).estimateNumber)
    .filter((n): n is string => n !== null);
}

/** One more than the highest integer number, checked against Wave because its number sort may be textual. Keeps zero padding. */
async function nextEstimateNumber(client: WaveClient, businessGlobalId: string): Promise<string> {
  const numbers = await listEstimateNumbers(client, businessGlobalId, { sort: 'ESTIMATE_NUMBER_DESC' });
  if (numbers.length === 0) return '1';
  const integers = numbers.filter((n) => /^\d+$/.test(n));
  if (integers.length === 0) {
    throw new Error(`Existing estimate numbers are not plain integers (latest: ${numbers[0]}); pass estimateNumber explicitly.`);
  }
  const widest = integers.reduce((a, b) => (b.length > a.length ? b : a));
  const width = widest.startsWith('0') ? widest.length : 0;
  let candidate = Math.max(...integers.map(Number)) + 1;
  for (let attempt = 0; attempt < NUMBER_CHECK_LIMIT; attempt += 1) {
    const text = String(candidate).padStart(width, '0');
    const taken = await listEstimateNumbers(client, businessGlobalId, { estimateNumber: text });
    if (!taken.includes(text)) return text;
    candidate += 1;
  }
  throw new Error(`Could not find a free estimate number after ${NUMBER_CHECK_LIMIT} tries; pass estimateNumber explicitly.`);
}

async function businessCurrency(client: WaveClient, businessUuid: string): Promise<string> {
  return shapeBusiness(await client.rest.get<unknown>(`/businesses/${businessUuid}/`)).currency ?? 'USD';
}

export function registerEstimateTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_list_estimates',
    {
      title: 'List Wave estimates',
      description:
        'Lists estimates with status, dates, totals and customer. Each estimate\'s `id` is the Relay id wave_update_estimate and wave_delete_estimate take as `estimateGlobalId`.',
      inputSchema: {
        businessId: z.uuid().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(25),
        sort: EstimateSort.default('ESTIMATE_DATE_DESC'),
        customerId: z
          .string()
          .optional()
          .describe('Relay `id` of a customer from wave_list_customers, to list one customer\'s estimates.'),
        status: EstimateListStatus.default('ALL').describe('Filter by lifecycle status; ALL returns every estimate.'),
        estimateDateStart: IsoDate.optional(),
        estimateDateEnd: IsoDate.optional(),
        estimateNumber: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const data = await client.gql.execute<EstimatesResponse>({
        operationName: 'GetEstimates',
        query: ESTIMATES_QUERY,
        variables: {
          businessId: client.businessGlobalId(args.businessId),
          page: args.page,
          pageSize: args.pageSize,
          sort: args.sort,
          customerId: args.customerId,
          activeStatus: 'ACTIVE',
          draftStatus: 'DRAFT',
          allStatus: args.status === 'ALL' ? undefined : args.status,
          estimateDateStart: args.estimateDateStart,
          estimateDateEnd: args.estimateDateEnd,
          estimateNumber: args.estimateNumber,
        },
      });
      return jsonResult({
        estimates: flattenConnection(data.business.allEstimates).map(shapeEstimate),
        pageInfo: data.business.allEstimates.pageInfo,
      });
    },
  );

  server.registerTool(
    'wave_create_estimate',
    {
      title: 'Create a Wave estimate',
      description:
        'Creates an estimate as a DRAFT. Needs the customer\'s integer id (wave_list_customers `internalId`) and at least one line. The number defaults to the next integer after the highest existing one, the currency to the business currency and the validity to 30 days.',
      inputSchema: {
        businessId: z.uuid().optional(),
        customerId: z.number().int().positive().describe('Wave integer customer ID.'),
        items: z.array(EstimateItemInput).min(1),
        estimateNumber: z.string().optional().describe('Defaults to the next number after the highest existing estimate.'),
        poNumber: z.string().default(''),
        estimateDate: IsoDate.optional().describe('YYYY-MM-DD. Defaults to today.'),
        dueDate: IsoDate.optional().describe('Valid-until date. Defaults to 30 days after estimateDate.'),
        currency: z.string().length(3).toUpperCase().optional().describe('ISO 4217 code. Defaults to the business currency.'),
        memo: z.string().default(''),
        footer: z.string().default(''),
        title: z.string().default('Estimate'),
        subhead: z.string().default(''),
        itemTitle: z.string().default('Services'),
        unitTitle: z.string().default('Hours'),
        priceTitle: z.string().default('Rate'),
        amountTitle: z.string().default('Amount'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const businessUuid = client.businessId(args.businessId);
      const businessGlobalId = client.businessGlobalId(args.businessId);
      const [estimateNumber, currency] = await Promise.all([
        args.estimateNumber ?? nextEstimateNumber(client, businessGlobalId),
        args.currency ?? businessCurrency(client, businessUuid),
      ]);
      const estimateDate = args.estimateDate ?? todayIso();
      const input = {
        exchangeRate: null,
        currency,
        businessId: businessGlobalId,
        customerId: toCompositeGlobalId(businessUuid, 'Customer', args.customerId),
        estimateNumber,
        poNumber: args.poNumber,
        estimateDate,
        dueDate: args.dueDate ?? addDays(estimateDate, DEFAULT_VALIDITY_DAYS),
        footer: args.footer,
        memo: args.memo,
        title: args.title,
        subhead: args.subhead,
        items: itemsForApi(args.items, businessUuid),
        discounts: [],
        itemTitle: args.itemTitle,
        unitTitle: args.unitTitle,
        priceTitle: args.priceTitle,
        amountTitle: args.amountTitle,
        hideName: false,
        hideDescription: false,
        hideUnit: false,
        hidePrice: false,
        hideAmount: false,
        attachmentIds: [],
      };
      const data = await client.gql.execute<{ estimateCreate: MutationPayload }>({
        operationName: 'CreateEstimate',
        query: CREATE_ESTIMATE_MUTATION,
        variables: { input },
      });
      const payload = requireDidSucceed('CreateEstimate', data.estimateCreate);
      return jsonResult({ estimate: payload.estimate ?? null });
    },
  );

  server.registerTool(
    'wave_update_estimate',
    {
      title: 'Update a Wave estimate',
      description:
        'Replaces an estimate\'s content. Pass the estimate\'s Relay `id` from wave_list_estimates as `estimateGlobalId` and the full intended state: every field replaces the stored value.',
      inputSchema: {
        businessId: z.uuid().optional(),
        estimateGlobalId: z
          .string()
          .describe('Composite Relay ID of the estimate, base64 `Business:UUID;Estimate:int`.'),
        customerId: z.number().int().positive(),
        items: z.array(EstimateItemInput).min(1),
        status: EstimateLifecycleStatus.default('DRAFT').describe(
          "Pass the estimate's current `status` from `wave_list_estimates` to leave it unchanged.",
        ),
        estimateNumber: z.string(),
        poNumber: z.string().default(''),
        estimateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        currency: z.string().length(3).toUpperCase().optional().describe('ISO 4217 code. Defaults to the business currency.'),
        exchangeRate: z.string().default('1'),
        memo: z.string().default(''),
        footer: z.string().default(''),
        title: z.string().default('Estimate'),
        subhead: z.string().default(''),
        itemTitle: z.string().default('Services'),
        unitTitle: z.string().default('Hours'),
        priceTitle: z.string().default('Rate'),
        amountTitle: z.string().default('Amount'),
        depositStatus: EstimateDepositStatus.default('DISABLED').describe(
          'ENABLED_OPTIONAL asks the customer for a deposit; ENABLED_MANDATORY requires it. Both need depositUnit and depositValue.',
        ),
        depositUnit: EstimateDepositUnit.optional(),
        depositValue: z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .optional()
          .describe('Deposit as a decimal string: a currency amount for AMOUNT, a percent for PERCENTAGE (e.g. "25").'),
        disableCreditCardPayments: z.boolean().default(true),
        disableAmexPayments: z.boolean().default(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const businessUuid = client.businessId(args.businessId);
      const depositEnabled = args.depositStatus !== 'DISABLED';
      if (depositEnabled && (args.depositUnit === undefined || args.depositValue === undefined)) {
        throw new Error(`depositStatus ${args.depositStatus} needs both depositUnit and depositValue.`);
      }
      const currency = args.currency ?? (await businessCurrency(client, businessUuid));
      const input = {
        id: args.estimateGlobalId,
        status: args.status,
        exchangeRate: args.exchangeRate,
        attachmentIds: [],
        currency,
        customerId: toCompositeGlobalId(businessUuid, 'Customer', args.customerId),
        estimateNumber: args.estimateNumber,
        poNumber: args.poNumber,
        estimateDate: args.estimateDate,
        dueDate: args.dueDate,
        footer: args.footer,
        memo: args.memo,
        title: args.title,
        subhead: args.subhead,
        items: itemsForApi(args.items, businessUuid),
        discounts: [],
        itemTitle: args.itemTitle,
        unitTitle: args.unitTitle,
        priceTitle: args.priceTitle,
        amountTitle: args.amountTitle,
        hideName: false,
        hideDescription: false,
        hideUnit: false,
        hidePrice: false,
        hideAmount: false,
        depositStatus: args.depositStatus,
        depositUnit: depositEnabled ? args.depositUnit : null,
        depositValue: depositEnabled ? args.depositValue : null,
        disableCreditCardPayments: args.disableCreditCardPayments,
        disableAmexPayments: args.disableAmexPayments,
      };
      const data = await client.gql.execute<{ estimatePatch: MutationPayload }>({
        operationName: 'PatchEstimate',
        query: PATCH_ESTIMATE_MUTATION,
        variables: { input },
      });
      requireDidSucceed('PatchEstimate', data.estimatePatch);
      return jsonResult({ ok: true, estimateGlobalId: args.estimateGlobalId });
    },
  );

  server.registerTool(
    'wave_delete_estimate',
    {
      title: 'Delete a Wave estimate',
      description:
        'Deletes an estimate by its Relay `id` from wave_list_estimates. Only drafts and unsent estimates should be deleted; confirm with the user first.',
      inputSchema: {
        estimateGlobalId: z.string().describe('Composite Relay ID of the estimate.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ estimateGlobalId }) => {
      const data = await client.gql.execute<{ estimateDelete: MutationPayload }>({
        operationName: 'DeleteEstimate',
        query: DELETE_ESTIMATE_MUTATION,
        variables: { input: { estimateId: estimateGlobalId } },
      });
      requireDidSucceed('DeleteEstimate', data.estimateDelete);
      return jsonResult({ ok: true, estimateGlobalId });
    },
  );
}
