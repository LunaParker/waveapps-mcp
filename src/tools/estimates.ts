import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { toCompositeGlobalId } from '../client/ids.js';
import { ESTIMATES_QUERY } from './_queries.js';
import {
  CREATE_ESTIMATE_MUTATION,
  DELETE_ESTIMATE_MUTATION,
  PATCH_ESTIMATE_MUTATION,
} from './_mutations.js';
import { flattenConnection, jsonResult } from './_helpers.js';

const EstimateStatusFilter = z.enum(['ACTIVE', 'DRAFT', 'CONVERTED', 'EXPIRED', 'OVERDUE']);
const EstimateSort = z.enum([
  'ESTIMATE_DATE_DESC',
  'ESTIMATE_DATE_ASC',
  'ESTIMATE_NUMBER_DESC',
  'ESTIMATE_NUMBER_ASC',
]);
const EstimateLifecycleStatus = z.enum(['DRAFT', 'ACTIVE']);

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
    .array(z.string())
    .default([])
    .describe('Composite Relay IDs of taxes to apply. Empty for none.'),
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
  inputErrors?: ReadonlyArray<{ message: string }> | null;
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
    taxes: it.taxIds,
  }));
}

export function registerEstimateTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_list_estimates',
    {
      title: 'List Wave estimates',
      description:
        'Lists estimates for a Wave business. GraphQL returns three buckets at once (all / active / draft) — pick whichever fits.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(25),
        sort: EstimateSort.default('ESTIMATE_DATE_DESC'),
        customerId: z.string().optional(),
        activeStatus: EstimateStatusFilter.default('ACTIVE'),
        draftStatus: EstimateStatusFilter.default('DRAFT'),
        allStatus: EstimateStatusFilter.optional(),
        estimateDateStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        estimateDateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
          activeStatus: args.activeStatus,
          draftStatus: args.draftStatus,
          allStatus: args.allStatus,
          estimateDateStart: args.estimateDateStart,
          estimateDateEnd: args.estimateDateEnd,
          estimateNumber: args.estimateNumber,
        },
      });
      return jsonResult({
        active: {
          items: flattenConnection(data.business.activeEstimates),
          pageInfo: data.business.activeEstimates.pageInfo,
        },
        draft: {
          items: flattenConnection(data.business.draftEstimates),
          pageInfo: data.business.draftEstimates.pageInfo,
        },
        all: {
          items: flattenConnection(data.business.allEstimates),
          pageInfo: data.business.allEstimates.pageInfo,
        },
      });
    },
  );

  server.registerTool(
    'wave_create_estimate',
    {
      title: 'Create a Wave estimate',
      description:
        'Creates a new estimate. Pass the customer\'s integer ID + at least one line item. The estimate saves as a DRAFT by default.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        customerId: z.number().int().positive().describe('Wave integer customer ID.'),
        items: z.array(EstimateItemInput).min(1),
        estimateNumber: z.string().default('1'),
        poNumber: z.string().default(''),
        estimateDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('ISO 8601 date (YYYY-MM-DD). Defaults to today.')
          .optional(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Valid-until date.'),
        currency: z.string().length(3).toUpperCase().default('CAD'),
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
      const today = new Date().toISOString().slice(0, 10);
      const input = {
        exchangeRate: null,
        currency: args.currency,
        businessId: client.businessGlobalId(args.businessId),
        customerId: toCompositeGlobalId(businessUuid, 'Customer', args.customerId),
        estimateNumber: args.estimateNumber,
        poNumber: args.poNumber,
        estimateDate: args.estimateDate ?? today,
        dueDate: args.dueDate ?? today,
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
      return jsonResult(data.estimateCreate);
    },
  );

  server.registerTool(
    'wave_update_estimate',
    {
      title: 'Update a Wave estimate',
      description:
        'Patches an existing estimate. Pass the estimate\'s Relay global ID (see `wave_list_estimates` → `edges.node.id`). All other fields replace the prior values, so pass the full intended state.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        estimateGlobalId: z
          .string()
          .describe('Composite Relay ID of the estimate, base64 `Business:UUID;Estimate:int`.'),
        customerId: z.number().int().positive(),
        items: z.array(EstimateItemInput).min(1),
        status: EstimateLifecycleStatus.default('DRAFT'),
        estimateNumber: z.string(),
        poNumber: z.string().default(''),
        estimateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        currency: z.string().length(3).toUpperCase().default('CAD'),
        exchangeRate: z.string().default('1'),
        memo: z.string().default(''),
        footer: z.string().default(''),
        title: z.string().default('Estimate'),
        subhead: z.string().default(''),
        itemTitle: z.string().default('Services'),
        unitTitle: z.string().default('Hours'),
        priceTitle: z.string().default('Rate'),
        amountTitle: z.string().default('Amount'),
        depositStatus: z.enum(['DISABLED', 'ENABLED']).default('DISABLED'),
        disableCreditCardPayments: z.boolean().default(true),
        disableAmexPayments: z.boolean().default(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const businessUuid = client.businessId(args.businessId);
      const input = {
        id: args.estimateGlobalId,
        status: args.status,
        exchangeRate: args.exchangeRate,
        attachmentIds: [],
        currency: args.currency,
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
        depositUnit: null,
        depositValue: null,
        disableCreditCardPayments: args.disableCreditCardPayments,
        disableAmexPayments: args.disableAmexPayments,
      };
      const data = await client.gql.execute<{ estimatePatch: MutationPayload }>({
        operationName: 'PatchEstimate',
        query: PATCH_ESTIMATE_MUTATION,
        variables: { input },
      });
      return jsonResult(data.estimatePatch);
    },
  );

  server.registerTool(
    'wave_delete_estimate',
    {
      title: 'Delete a Wave estimate',
      description: 'Deletes an estimate by its Relay global ID. Only drafts and unsent estimates can be safely removed.',
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
      return jsonResult(data.estimateDelete);
    },
  );
}
