import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { requireDidSucceed } from '../client/errors.js';
import { toCompositeGlobalId } from '../client/ids.js';
import { CUSTOMER_LIST_QUERY } from './_queries.js';
import { CREATE_CUSTOMER_MUTATION, DELETE_CUSTOMER_MUTATION } from './_mutations.js';
import { flattenConnection, jsonResult } from './_helpers.js';
import { shapeCustomer, type CustomerSummary } from './_shape.js';

interface CustomerListResponse {
  business: {
    id: string;
    customers: {
      pageInfo: { currentPage: number; totalPages: number };
      edges: ReadonlyArray<{ node: unknown }>;
    };
  };
}

interface MutationPayload {
  didSucceed: boolean;
  inputErrors?: ReadonlyArray<{ message: string; path?: ReadonlyArray<string | number> | null }> | null;
  customer?: unknown;
}

/** A search reads up to SEARCH_MAX_PAGES pages of SEARCH_PAGE_SIZE customers. */
const SEARCH_PAGE_SIZE = 500;
const SEARCH_MAX_PAGES = 10;

function matches(c: CustomerSummary, needle: string): boolean {
  return [c.name, c.firstName, c.lastName, c.email, c.displayId].some((v) => v !== null && v.toLowerCase().includes(needle));
}

export function registerCustomerTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_list_customers',
    {
      title: 'List Wave customers',
      description:
        'Lists customers with contact details, address, outstanding and overdue balances. `internalId` is the integer id that wave_create_invoice, wave_create_estimate and wave_delete_customer take as `customerId`; `id` is the Relay id wave_list_estimates takes. Use `search` to find one customer by name or email.',
      inputSchema: {
        businessId: z.uuid().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(500).default(100),
        search: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Case-insensitive match on name, first or last name, email or display id. Walks up to 5000 customers and ignores page and pageSize; `searchedAllPages: false` in the result means the roster was larger than that.',
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, page, pageSize, search }) => {
      const businessGlobalId = client.businessGlobalId(businessId);
      const fetchPage = (p: number, size: number) =>
        client.gql.execute<CustomerListResponse>({
          operationName: 'CustomerListListCustomers',
          query: CUSTOMER_LIST_QUERY,
          variables: { businessId: businessGlobalId, page: p, pageSize: size },
        });
      if (search === undefined) {
        const data = await fetchPage(page, pageSize);
        return jsonResult({ customers: flattenConnection(data.business.customers).map(shapeCustomer), pageInfo: data.business.customers.pageInfo });
      }
      // The list query has no search argument, so walk the pages (capped) and filter here.
      const needle = search.toLowerCase();
      const matched: CustomerSummary[] = [];
      let totalPages = 1;
      for (let p = 1; p <= totalPages && p <= SEARCH_MAX_PAGES; p += 1) {
        const data = await fetchPage(p, SEARCH_PAGE_SIZE);
        totalPages = data.business.customers.pageInfo.totalPages;
        for (const c of flattenConnection(data.business.customers).map(shapeCustomer)) if (matches(c, needle)) matched.push(c);
      }
      return jsonResult({
        customers: matched,
        pageInfo: { currentPage: 1, totalPages },
        matched: matched.length,
        searchedAllPages: totalPages <= SEARCH_MAX_PAGES,
      });
    },
  );

  server.registerTool(
    'wave_create_customer',
    {
      title: 'Create a Wave customer',
      description:
        'Creates a new customer in Wave. Only `name` is required; everything else is optional. Returns the customer; its `internalId` is the integer the invoice and estimate tools take as `customerId`.',
      inputSchema: {
        businessId: z.uuid().optional(),
        name: z.string().min(1).describe('Business or person name. Required.'),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.email().optional(),
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
      const data = await client.gql.execute<{ customerCreate: MutationPayload }>({
        operationName: 'CreateCustomer',
        query: CREATE_CUSTOMER_MUTATION,
        variables: { input },
      });
      const payload = requireDidSucceed('CreateCustomer', data.customerCreate);
      return jsonResult({ customer: shapeCustomer(payload.customer) });
    },
  );

  server.registerTool(
    'wave_delete_customer',
    {
      title: 'Delete a Wave customer',
      description:
        'Deletes a customer. Wave warns this cannot be undone; the customer is removed from lists but historical invoices keep their reference. Pass the customer\'s integer `internalId` (or the full Relay global ID via `customerGlobalId`).',
      inputSchema: {
        businessId: z.uuid().optional(),
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
      const data = await client.gql.execute<{ customerDelete: MutationPayload }>({
        operationName: 'DeleteCustomer',
        query: DELETE_CUSTOMER_MUTATION,
        variables: { input: { id } },
      });
      requireDidSucceed('DeleteCustomer', data.customerDelete);
      return jsonResult({ ok: true });
    },
  );
}
