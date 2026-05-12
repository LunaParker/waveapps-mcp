import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { jsonResult } from './_helpers.js';

const ProductSort = z.enum(['name', '-name', 'date_created', '-date_created', 'date_modified', '-date_modified']);

export function registerProductTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_list_products',
    {
      title: 'List Wave products & services',
      description:
        'Lists products/services for a Wave business via REST (`GET /businesses/{id}/products/`). Each line item on an invoice references a product by integer `id`, so use this to find existing items before creating invoices. Filter by `active` to skip archived ones.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(50),
        sort: ProductSort.default('-date_modified'),
        activeOnly: z.boolean().default(true).describe('When true, hides archived products. Wave keeps soft-deleted products around.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, page, pageSize, sort, activeOnly }) => {
      const id = client.businessId(businessId);
      const paged = await client.rest.getPaged<unknown>(`/businesses/${id}/products/`, {
        page,
        page_size: pageSize,
        sort,
        active: activeOnly ? true : undefined,
      });
      return jsonResult(paged);
    },
  );

  server.registerTool(
    'wave_get_product',
    {
      title: 'Get one Wave product',
      description: 'Fetches a single product by integer ID. Useful for double-checking the `income_account.id` and `price` before referencing it on an invoice.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        productId: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, productId }) => {
      const id = client.businessId(businessId);
      const product = await client.rest.get<unknown>(`/businesses/${id}/products/${productId}/`);
      return jsonResult({ product });
    },
  );

  server.registerTool(
    'wave_create_product',
    {
      title: 'Create a Wave product or service',
      description:
        'Creates a new product/service via `POST /businesses/{id}/products/`. The minimum required fields are `name`, `price`, and (for sellable items) an `incomeAccountId` from `wave_list_accounts`. Returns the full product including the new integer `id` you can hand to `wave_create_invoice`.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        name: z.string().min(1),
        price: z.number().nonnegative().describe('Default sale price as a decimal number (e.g. 150.00).'),
        description: z.string().default(''),
        isSold: z.boolean().default(true).describe('Set false for items you only buy (e.g. inventory you re-bill on bills).'),
        isBought: z.boolean().default(false),
        incomeAccountId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Required when isSold=true. From `wave_list_accounts` (typical: "Sales", "Consulting Income").'),
        expenseAccountId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Required when isBought=true. From `wave_list_accounts`.'),
        defaultSalesTaxes: z
          .array(z.number().int().positive())
          .default([])
          .describe('Integer tax IDs to apply by default when this product is added to an invoice.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const id = client.businessId(args.businessId);
      const body: Record<string, unknown> = {
        name: args.name,
        price: args.price,
        description: args.description,
        is_sold: args.isSold,
        is_bought: args.isBought,
        default_sales_taxes: args.defaultSalesTaxes,
      };
      if (args.incomeAccountId !== undefined) body['income_account'] = { id: args.incomeAccountId };
      if (args.expenseAccountId !== undefined) body['expense_account'] = { id: args.expenseAccountId };
      const product = await client.rest.post<unknown>(`/businesses/${id}/products/`, body);
      return jsonResult({ product });
    },
  );

  server.registerTool(
    'wave_update_product',
    {
      title: 'Update a Wave product',
      description:
        'Patches a product via `PATCH /businesses/{id}/products/{productId}/`. Only the fields you supply are changed — existing values are preserved. Useful for bumping the price of a recurring service or fixing a typo.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        productId: z.number().int().positive(),
        name: z.string().min(1).optional(),
        price: z.number().nonnegative().optional(),
        description: z.string().optional(),
        isSold: z.boolean().optional(),
        isBought: z.boolean().optional(),
        incomeAccountId: z.number().int().positive().optional(),
        expenseAccountId: z.number().int().positive().nullable().optional(),
        defaultSalesTaxes: z.array(z.number().int().positive()).optional(),
        active: z.boolean().optional().describe('Set false to archive without deleting (preserves history on past invoices).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const id = client.businessId(args.businessId);
      const body: Record<string, unknown> = {};
      if (args.name !== undefined) body['name'] = args.name;
      if (args.price !== undefined) body['price'] = args.price;
      if (args.description !== undefined) body['description'] = args.description;
      if (args.isSold !== undefined) body['is_sold'] = args.isSold;
      if (args.isBought !== undefined) body['is_bought'] = args.isBought;
      if (args.incomeAccountId !== undefined) body['income_account'] = { id: args.incomeAccountId };
      if (args.expenseAccountId !== undefined) {
        body['expense_account'] = args.expenseAccountId === null ? null : { id: args.expenseAccountId };
      }
      if (args.defaultSalesTaxes !== undefined) body['default_sales_taxes'] = args.defaultSalesTaxes;
      if (args.active !== undefined) body['active'] = args.active;
      const product = await client.rest.patch<unknown>(
        `/businesses/${id}/products/${args.productId}/`,
        body,
      );
      return jsonResult({ product });
    },
  );

  server.registerTool(
    'wave_delete_product',
    {
      title: 'Delete a Wave product',
      description:
        'Deletes a product via `DELETE /businesses/{id}/products/{productId}/`. Returns 204 on success. Wave preserves historical line items that referenced this product on past invoices — they stay readable, but new invoices won\'t be able to use it. Consider archiving (`wave_update_product` with `active: false`) instead of deleting.',
      inputSchema: {
        businessId: z.string().uuid().optional(),
        productId: z.number().int().positive(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ businessId, productId }) => {
      const id = client.businessId(businessId);
      await client.rest.delete(`/businesses/${id}/products/${productId}/`);
      return jsonResult({ ok: true, productId });
    },
  );
}
