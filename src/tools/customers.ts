import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { toCompositeGlobalId } from '../client/ids.js';
import { CUSTOMER_LIST_QUERY } from './_queries.js';
import { CREATE_CUSTOMER_MUTATION, DELETE_CUSTOMER_MUTATION } from './_mutations.js';
import { flattenConnection, jsonResult } from './_helpers.js';

interface CustomerListResponse {
  business: {
    id: string;
    customers: {
      pageInfo: { currentPage: number; totalPages: number };
      edges: ReadonlyArray<{ node: unknown }>;
    };
  };
}

interface CustomerMutationResponse<TPayload extends string> {
  [key: string]: {
    didSucceed: boolean;
    inputErrors?: ReadonlyArray<{ message: string; path?: ReadonlyArray<string | number> }> | null;
  } & Partial<Record<TPayload, unknown>>;
}

export function registerCustomerTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_list_customers',
    {
      title: 'List Wave customers',
      description:
        'Returns the customer roster for a Wave business. GraphQL-backed; includes addresses, phones, outstanding/overdue amounts, additional contacts, saved cards.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(500).default(100),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, page, pageSize }) => {
      const data = await client.gql.execute<CustomerListResponse>({
        operationName: 'CustomerListListCustomers',
        query: CUSTOMER_LIST_QUERY,
        variables: { businessId: client.businessGlobalId(businessId), page, pageSize },
      });
      return jsonResult({
        customers: flattenConnection(data.business.customers),
        pageInfo: data.business.customers.pageInfo,
      });
    },
  );

  server.registerTool(
    'wave_create_customer',
    {
      title: 'Create a Wave customer',
      description:
        'Creates a new customer in Wave. Only `name` is required; everything else is optional. Returns the full customer record (including the new `internalId` you can pass to invoice/estimate tools as `customerId`).',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        name: z.string().min(1).describe('Business or person name. Required.'),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        mobile: z.string().optional(),
        fax: z.string().optional(),
        tollFree: z.string().optional(),
        website: z.string().optional(),
        displayId: z.string().optional().describe('Custom display ID / account number.'),
        internalNotes: z.string().optional(),
        currency: z
          .string()
          .length(3)
          .toUpperCase()
          .optional()
          .describe('ISO 4217 currency code (e.g. CAD, USD). Defaults to the business currency.'),
        address: z
          .object({
            addressLine1: z.string().optional(),
            addressLine2: z.string().optional(),
            city: z.string().optional(),
            provinceCode: z.string().optional().describe('e.g. "ON" for Ontario.'),
            countryCode: z.string().length(2).optional().describe('ISO 3166-1 alpha-2.'),
            postalCode: z.string().optional(),
          })
          .optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const input = {
        businessId: client.businessGlobalId(args.businessId),
        name: args.name,
        firstName: args.firstName ?? '',
        lastName: args.lastName ?? '',
        email: args.email ?? '',
        phone: args.phone ?? '',
        mobile: args.mobile ?? '',
        fax: args.fax ?? '',
        tollFree: args.tollFree ?? '',
        website: args.website ?? '',
        displayId: args.displayId ?? '',
        internalNotes: args.internalNotes ?? '',
        currency: args.currency ?? null,
        address: {
          addressLine1: args.address?.addressLine1 ?? '',
          addressLine2: args.address?.addressLine2 ?? '',
          city: args.address?.city ?? '',
          provinceCode: args.address?.provinceCode ?? '',
          countryCode: args.address?.countryCode ?? null,
          postalCode: args.address?.postalCode ?? '',
        },
        shippingDetails: null,
        additionalContacts: null,
      };
      const data = await client.gql.execute<CustomerMutationResponse<'customer'>>({
        operationName: 'CreateCustomer',
        query: CREATE_CUSTOMER_MUTATION,
        variables: { input },
      });
      return jsonResult(data['customerCreate']);
    },
  );

  server.registerTool(
    'wave_delete_customer',
    {
      title: 'Delete a Wave customer',
      description:
        'Deletes a customer. Wave warns this cannot be undone; the customer is removed from lists but historical invoices keep their reference. Pass the customer\'s integer `internalId` (or the full Relay global ID via `customerGlobalId`).',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        customerId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Wave integer customer ID (e.g. 102532808). Mutually exclusive with customerGlobalId.'),
        customerGlobalId: z
          .string()
          .optional()
          .describe('The Relay composite ID, base64 of `Business:UUID;Customer:int`. Use when you already have it.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ businessId, customerId, customerGlobalId }) => {
      const id = customerGlobalId ?? (customerId != null
        ? toCompositeGlobalId(client.businessId(businessId), 'Customer', customerId)
        : null);
      if (!id) throw new Error('Provide either customerId or customerGlobalId.');
      const data = await client.gql.execute<CustomerMutationResponse<never>>({
        operationName: 'DeleteCustomer',
        query: DELETE_CUSTOMER_MUTATION,
        variables: { input: { id } },
      });
      return jsonResult(data['customerDelete']);
    },
  );
}
