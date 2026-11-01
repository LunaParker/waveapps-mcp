import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { requireDidSucceed, type WaveInputError } from '../client/errors.js';
import { LIST_TAGS_QUERY } from './_queries.js';
import { CREATE_TAG_MUTATION, DELETE_TAGS_MUTATION } from './_mutations.js';
import { flattenConnection, jsonResult } from './_helpers.js';
import { shapeTag } from './_shape.js';

export function registerTagTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_list_tags',
    {
      title: 'List Wave tags',
      description: 'Lists the tags used to label transactions. Their `id`s go in `tagIds` on wave_create_transaction, wave_update_transaction and wave_list_transactions.',
      inputSchema: {
        businessId: z.uuid().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(100),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, page, pageSize }) => {
      const data = await client.gql.execute<{ accountingTags: { edges: ReadonlyArray<{ node: unknown }>; pageInfo: unknown } }>({
        operationName: 'ListTags',
        query: LIST_TAGS_QUERY,
        variables: { businessId: client.businessGlobalId(businessId), pagination: { pageNumber: page, resultsPerPage: pageSize } },
      });
      return jsonResult({ tags: flattenConnection(data.accountingTags).map(shapeTag), pageInfo: data.accountingTags.pageInfo });
    },
  );

  server.registerTool(
    'wave_create_tag',
    {
      title: 'Create a Wave tag',
      description: 'Creates a tag for labelling transactions. Returns its `id`.',
      inputSchema: { businessId: z.uuid().optional(), name: z.string().min(1), description: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ businessId, name, description }) => {
      const input: Record<string, unknown> = { businessId: client.businessGlobalId(businessId), name };
      if (description !== undefined) input['description'] = description;
      const data = await client.gql.execute<{ createAccountingTag: { didSucceed: boolean; inputErrors?: ReadonlyArray<WaveInputError> | null; tag?: unknown } }>({
        operationName: 'CreateTag',
        query: CREATE_TAG_MUTATION,
        variables: { input },
      });
      return jsonResult({ tag: shapeTag(requireDidSucceed('CreateTag', data.createAccountingTag).tag) });
    },
  );

  server.registerTool(
    'wave_delete_tag',
    {
      title: 'Delete a Wave tag',
      description: 'Deletes a tag; transactions that carried it lose it. This cannot be undone; confirm with the user first.',
      inputSchema: { businessId: z.uuid().optional(), tagId: z.string().min(1).describe('Tag `id` from wave_list_tags.') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ businessId, tagId }) => {
      const data = await client.gql.execute<{ deleteAccountingTags: { didSucceed: boolean } }>({
        operationName: 'DeleteTags',
        query: DELETE_TAGS_MUTATION,
        variables: { input: { businessId: client.businessGlobalId(businessId), tagIds: [tagId] } },
      });
      requireDidSucceed('DeleteTags', data.deleteAccountingTags);
      return jsonResult({ ok: true, tagId });
    },
  );
}
