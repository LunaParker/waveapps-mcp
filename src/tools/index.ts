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

export function registerAllTools(server: McpServer, client: WaveClient): void {
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
}
