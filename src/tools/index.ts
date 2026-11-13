import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { registerBusinessTools } from './businesses.js';
import { registerInvoiceTools } from './invoices.js';
import { registerCustomerTools } from './customers.js';
import { registerEstimateTools } from './estimates.js';
import { registerEstimateLifecycleTools } from './estimate-lifecycle.js';
import { registerBillTools } from './bills.js';
import { registerReceiptTools } from './receipts.js';
import { registerProductTools } from './products.js';
import { registerAccountTools } from './accounts.js';
import { registerPaymentTools } from './payments.js';
import { registerSalesTaxTools } from './sales-taxes.js';
import { registerReportTools } from './reports.js';
import { registerCustomerStatementTools } from './customer-statements.js';
import { registerInvoiceActionTools } from './invoice-actions.js';
import { registerTransactionTools } from './transactions.js';
import { registerTagTools } from './tags.js';
import { registerRecurringInvoiceTools } from './recurring-invoices.js';

export interface RegisterOptions {
  /** Register only the tools annotated `readOnlyHint: true` (WAVE_MCP_READ_ONLY). */
  readOnly?: boolean;
}

export function registerAllTools(server: McpServer, client: WaveClient, opts: RegisterOptions = {}): void {
  if (opts.readOnly) server = readOnlyView(server);
  registerBusinessTools(server, client);
  registerInvoiceTools(server, client);
  registerCustomerTools(server, client);
  registerEstimateTools(server, client);
  registerEstimateLifecycleTools(server, client);
  registerBillTools(server, client);
  registerReceiptTools(server, client);
  registerProductTools(server, client);
  registerAccountTools(server, client);
  registerPaymentTools(server, client);
  registerSalesTaxTools(server, client);
  registerReportTools(server, client);
  registerCustomerStatementTools(server, client);
  registerInvoiceActionTools(server, client);
  registerTransactionTools(server, client);
  registerTagTools(server, client);
  registerRecurringInvoiceTools(server, client);
}

/** `server` with a registerTool that drops every tool not annotated `readOnlyHint: true`. */
export function readOnlyView(server: McpServer): McpServer {
  const view = Object.create(server) as McpServer;
  // Dropped tools return undefined; no register function uses the RegisteredTool it gets back.
  view.registerTool = ((name, config, cb) =>
    config.annotations?.readOnlyHint === true ? server.registerTool(name, config, cb) : undefined) as McpServer['registerTool'];
  return view;
}
