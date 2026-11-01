import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { todayIso } from '../util/dates.js';
import { jsonResult } from './_helpers.js';
import { shapeReport } from './_shape.js';

type FilterKind = 'periods' | 'range' | 'asOf';

/** Each report's route, how it takes dates, whether it has a cash/accrual basis, and the version Wave expects. */
const REPORTS = {
  profit_and_loss: { filters: 'periods', basis: true, version: 2 },
  balance_sheet: { filters: 'asOf', basis: true, version: 2 },
  cash_flow: { filters: 'periods', basis: true, version: 2 },
  trial_balance: { filters: 'asOf', basis: true, version: 2 },
  sales_tax: { filters: 'range', basis: true, version: 1 },
  income_by_customer: { filters: 'range', basis: false, version: 1 },
  purchases_by_vendor: { filters: 'range', basis: false, version: 1 },
  account_balances: { filters: 'range', basis: false, version: 1 },
  aged_receivables: { filters: 'asOf', basis: false, version: 1 },
  aged_payables: { filters: 'asOf', basis: false, version: 1 },
} as const satisfies Record<string, { filters: FilterKind; basis: boolean; version: number }>;

const ReportName = z.enum(Object.keys(REPORTS) as [keyof typeof REPORTS, ...Array<keyof typeof REPORTS>]);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Wave's report_type: 1 counts unpaid invoices and bills (accrual), 2 only what's been paid (cash).
const BASIS = { accrual: '1', cash: '2' } as const;

export function registerReportTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_get_report',
    {
      title: 'Run a Wave report',
      description:
        "Runs one of Wave's financial reports and returns its headline figures and tables as labelled rows (`type` is header, section, data or total; `indent` is the nesting level; `cells` are the column values). Period reports (profit_and_loss, cash_flow, sales_tax, income_by_customer, purchases_by_vendor, account_balances) take `startDate` and `endDate`, defaulting to January 1 of this year through today. Point-in-time reports (balance_sheet, trial_balance, aged_receivables, aged_payables) take `asOf`, defaulting to today. profit_and_loss, balance_sheet, cash_flow, trial_balance and sales_tax take `basis`: accrual counts unpaid invoices and bills, cash only what has been paid.",
      inputSchema: {
        businessId: z.uuid().optional(),
        report: ReportName,
        startDate: IsoDate.optional(),
        endDate: IsoDate.optional(),
        asOf: IsoDate.optional(),
        basis: z.enum(['accrual', 'cash']).default('accrual'),
        detail: z.enum(['summary', 'detailed']).default('summary').describe('detailed breaks totals down by account; some reports only come one way.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const id = client.businessId(args.businessId);
      const spec = REPORTS[args.report];
      const today = todayIso();
      const start = args.startDate ?? `${today.slice(0, 4)}-01-01`;
      const end = args.endDate ?? today;
      const asOf = args.asOf ?? today;
      const filters: Record<string, unknown> =
        spec.filters === 'periods'
          ? { date_periods: [{ start_date: start, end_date: end }] }
          : spec.filters === 'range'
            ? { start_date: start, end_date: end }
            : { report_date: asOf };
      if (spec.basis) filters['report_type'] = BASIS[args.basis];
      // Reading a report is a POST in Wave's API, so it needs the CSRF token like any other.
      const raw = await client.rest.post<unknown>(`/businesses/${id}/reports/${args.report}/`, {
        filters,
        version: spec.version,
        client_request_date: today,
      });
      const period = spec.filters === 'asOf' ? { asOf } : { startDate: start, endDate: end };
      return jsonResult({ report: args.report, ...period, ...(spec.basis ? { basis: args.basis } : {}), ...shapeReport(raw, args.detail) });
    },
  );
}
