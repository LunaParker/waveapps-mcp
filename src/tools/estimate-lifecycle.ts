import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { requireDidSucceed, type WaveInputError } from '../client/errors.js';
import { fromCompositeGlobalId } from '../client/ids.js';
import { GET_ESTIMATE_QUERY } from './_queries.js';
import {
  ACCEPT_ESTIMATE_MUTATION,
  APPROVE_ESTIMATE_MUTATION,
  CONVERT_ESTIMATE_MUTATION,
  DUPLICATE_ESTIMATE_MUTATION,
  ESTIMATE_PDF_MUTATION,
  MARK_ESTIMATE_SENT_MUTATION,
  RESET_ESTIMATE_ACCEPTANCE_MUTATION,
  SEND_ESTIMATE_MUTATION,
} from './_mutations.js';
import { jsonResult } from './_helpers.js';
import { downloadPdf, pdfResult } from './_pdf.js';
import { shapeEstimateDetail, shapeEstimateRef } from './_shape.js';

// Wave's EstimateSendMethod also has NOT_SENT, SKIPPED and WAVE, which don't describe a manual send.
const MarkSentMethod = z.enum(['MARKED_SENT', 'EXPORT_PDF', 'SHARED_LINK', 'GMAIL', 'OUTLOOK', 'YAHOO']);

const estimateGlobalId = z
  .string()
  .min(1)
  .describe('Relay id of the estimate: `id` from wave_list_estimates or wave_get_estimate.');

interface Payload {
  didSucceed: boolean;
  inputErrors?: ReadonlyArray<WaveInputError> | null;
  estimate?: unknown;
  invoiceId?: string | null;
  pdfUrl?: string | null;
}

export function registerEstimateLifecycleTools(server: McpServer, client: WaveClient): void {
  const mutate = async (operationName: string, query: string, field: string, input: Record<string, unknown>): Promise<Payload> => {
    const data = await client.gql.execute<Record<string, Payload>>({ operationName, query, variables: { input } });
    return requireDidSucceed(operationName, data[field]);
  };
  const estimateAction = (
    name: string,
    title: string,
    description: string,
    operationName: string,
    query: string,
    field: string,
    idempotent: boolean,
  ): void => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: { estimateGlobalId },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: idempotent, openWorldHint: true },
      },
      async (args) => {
        const payload = await mutate(operationName, query, field, { estimateId: args.estimateGlobalId });
        return jsonResult({ estimate: shapeEstimateRef(payload.estimate) });
      },
    );
  };

  server.registerTool(
    'wave_get_estimate',
    {
      title: 'Get one Wave estimate',
      description:
        "Fetches one estimate with its line items, taxes, totals, customer, column headings, deposit settings and status. Items carry `productId`, `name`, `unitPrice`, `quantity`, `incomeAccountClassicId` and each tax's `salesTaxId`, which is what wave_update_estimate takes, so read this before a change. `viewUrl` is the customer's link to the estimate.",
      inputSchema: { businessId: z.uuid().optional(), estimateGlobalId },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ businessId, estimateGlobalId: id }) => {
      const data = await client.gql.execute<{ business: { estimate: unknown } | null }>({
        operationName: 'GetEstimate',
        query: GET_ESTIMATE_QUERY,
        variables: { businessId: client.businessGlobalId(businessId), estimateId: id },
      });
      const estimate = data.business?.estimate;
      if (!estimate) throw new Error(`No estimate with id ${id} in this business.`);
      return jsonResult({ estimate: shapeEstimateDetail(estimate) });
    },
  );

  estimateAction(
    'wave_approve_estimate',
    'Approve a Wave estimate draft',
    'Approves a draft estimate (status DRAFT to APPROVED) so it can be sent or marked as sent.',
    'ApproveEstimate',
    APPROVE_ESTIMATE_MUTATION,
    'estimateApprove',
    true,
  );

  server.registerTool(
    'wave_send_estimate',
    {
      title: 'Send a Wave estimate by email',
      description:
        "Emails an estimate through Wave with a link to view it and, by default, the PDF attached; its status becomes SENT. This cannot be undone; confirm the recipients with the user first. `fromAddress` must be one of the verified `invoice_sending_emails` on wave_get_business; Wave uses its default sender when it is left out.",
      inputSchema: {
        estimateGlobalId,
        to: z.array(z.email()).min(1).max(10).describe('Recipient email addresses.'),
        subject: z.string().min(1).optional().describe("Defaults to Wave's estimate email subject."),
        message: z.string().optional().describe('Body text shown above the estimate link.'),
        fromAddress: z.email().optional(),
        ccMyself: z.boolean().default(false).describe('Send a copy to the sending address.'),
        attachPDF: z.boolean().default(true),
        includeAttachments: z.boolean().default(false).describe('Also attach files uploaded to the estimate.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const input: Record<string, unknown> = {
        estimateId: args.estimateGlobalId,
        to: args.to,
        ccMyself: args.ccMyself,
        attachPDF: args.attachPDF,
        includeAttachments: args.includeAttachments,
      };
      if (args.subject !== undefined) input['subject'] = args.subject;
      if (args.message !== undefined) input['message'] = args.message;
      if (args.fromAddress !== undefined) input['fromAddress'] = args.fromAddress;
      await mutate('SendEstimate', SEND_ESTIMATE_MUTATION, 'estimateSend', input);
      return jsonResult({ ok: true, estimateGlobalId: args.estimateGlobalId, to: args.to });
    },
  );

  server.registerTool(
    'wave_mark_estimate_sent',
    {
      title: 'Mark a Wave estimate as sent',
      description:
        'Marks an approved estimate as sent without Wave emailing it, for when you delivered it yourself. Status becomes SENT.',
      inputSchema: {
        estimateGlobalId,
        sendMethod: MarkSentMethod.default('MARKED_SENT').describe('How it went out; MARKED_SENT when it doesn\'t matter.'),
        sentAt: z.iso.datetime({ offset: true }).optional().describe('When it was sent, ISO 8601. Defaults to now.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const input: Record<string, unknown> = { estimateId: args.estimateGlobalId, sendMethod: args.sendMethod };
      if (args.sentAt !== undefined) input['sentAt'] = args.sentAt;
      const payload = await mutate('MarkEstimateSent', MARK_ESTIMATE_SENT_MUTATION, 'estimateMarkSent', input);
      return jsonResult({ estimate: shapeEstimateRef(payload.estimate) });
    },
  );

  estimateAction(
    'wave_accept_estimate',
    'Mark a Wave estimate as accepted',
    'Records that the customer accepted the estimate (status ACCEPTED). Undo with wave_reset_estimate_acceptance.',
    'AcceptEstimate',
    ACCEPT_ESTIMATE_MUTATION,
    'estimateMarkAccepted',
    true,
  );

  estimateAction(
    'wave_reset_estimate_acceptance',
    'Undo a Wave estimate acceptance',
    'Clears an acceptance recorded with wave_accept_estimate or by the customer; the estimate goes back to APPROVED.',
    'ResetEstimateAcceptance',
    RESET_ESTIMATE_ACCEPTANCE_MUTATION,
    'estimateResetAcceptance',
    true,
  );

  estimateAction(
    'wave_duplicate_estimate',
    'Duplicate a Wave estimate',
    'Copies an estimate into a new draft with the next estimate number. Returns the new estimate.',
    'DuplicateEstimate',
    DUPLICATE_ESTIMATE_MUTATION,
    'estimateClone',
    false,
  );

  server.registerTool(
    'wave_convert_estimate_to_invoice',
    {
      title: 'Convert a Wave estimate to an invoice',
      description:
        'Creates an invoice from an estimate, carrying over its customer and line items, and marks the estimate CONVERTED. Returns `invoiceId`, the integer string wave_get_invoice and the other invoice tools take.',
      inputSchema: { estimateGlobalId },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const payload = await mutate('ConvertEstimate', CONVERT_ESTIMATE_MUTATION, 'convertEstimateToInvoice', { estimateId: args.estimateGlobalId });
      const invoiceGlobalId = payload.invoiceId ?? null;
      let invoiceId: string | null = null;
      if (invoiceGlobalId) {
        try {
          invoiceId = fromCompositeGlobalId(invoiceGlobalId).internalId;
        } catch {
          invoiceId = null;
        }
      }
      return jsonResult({ invoiceId, invoiceGlobalId, estimateGlobalId: args.estimateGlobalId });
    },
  );

  server.registerTool(
    'wave_get_estimate_pdf',
    {
      title: "Get a Wave estimate's PDF",
      description:
        "Renders the estimate as Wave's PDF and returns the file itself as an embedded application/pdf resource, plus a download link that expires after a short while. Files over 10 MB come back as the link only.",
      inputSchema: { estimateGlobalId },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const payload = await mutate('GenerateEstimatePdf', ESTIMATE_PDF_MUTATION, 'estimateGeneratePdf', { estimateId: args.estimateGlobalId });
      if (!payload.pdfUrl) throw new Error('Wave generated no PDF link for this estimate.');
      let internalId: string;
      try {
        internalId = fromCompositeGlobalId(args.estimateGlobalId).internalId;
      } catch {
        internalId = 'estimate';
      }
      const file = await downloadPdf(payload.pdfUrl, `estimate-${internalId}.pdf`);
      return pdfResult(file, { estimateGlobalId: args.estimateGlobalId });
    },
  );
}
