import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { registerBusinessTools } from './businesses.js';
import { registerInvoiceTools } from './invoices.js';
import { registerCustomerTools } from './customers.js';
import { registerEstimateTools } from './estimates.js';
import { registerBillTools } from './bills.js';
import { registerReceiptTools } from './receipts.js';
import { registerProductTools } from './products.js';

export function registerAllTools(server: McpServer, client: WaveClient): void {
  registerBusinessTools(server, client);
  registerInvoiceTools(server, client);
  registerCustomerTools(server, client);
  registerEstimateTools(server, client);
  registerBillTools(server, client);
  registerReceiptTools(server, client);
  registerProductTools(server, client);
}
