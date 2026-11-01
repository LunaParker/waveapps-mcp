import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WaveClient } from '../client/index.js';
import { todayIso } from '../util/dates.js';
import { jsonResult } from './_helpers.js';
import { fileResult } from './_pdf.js';
import { reportToCsv, reportToPdf } from './_report-export.js';
import { shapeReport, type ReportResult } from './_shape.js';

type FilterKind = 'periods' | 'range' | 'asOf';

/** Each report's route, how it takes dates, whether it has a cash/accrual basis, the version Wave expects, and its title. */
const REPORTS = {
  profit_and_loss: { filters: 'periods', basis: true, version: 2, title: 'Profit and Loss' },
  balance_sheet: { filters: 'asOf', basis: true, version: 2, title: 'Balance Sheet' },
  cash_flow: { filters: 'periods', basis: true, version: 2, title: 'Cash Flow' },
  trial_balance: { filters: 'asOf', basis: true, version: 2, title: 'Trial Balance' },
  sales_tax: { filters: 'range', basis: true, version: 1, title: 'Sales Tax Report' },
  income_by_customer: { filters: 'range', basis: false, version: 1, title: 'Income by Customer' },
  purchases_by_vendor: { filters: 'range', basis: false, version: 1, title: 'Purchases by Vendor' },
  account_balances: { filters: 'range', basis: false, version: 1, title: 'Account Balances' },
  aged_receivables: { filters: 'asOf', basis: false, version: 1, title: 'Aged Receivables' },
  aged_payables: { filters: 'asOf', basis: false, version: 1, title: 'Aged Payables' },
} as const satisfies Record<string, { filters: FilterKind; basis: boolean; version: number; title: string }>;

type ReportName = keyof typeof REPORTS;
const ReportName = z.enum(Object.keys(REPORTS) as [ReportName, ...ReportName[]]);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Wave's report_type: 1 counts unpaid invoices and bills (accrual), 2 only what's been paid (cash).
const BASIS = { accrual: '1', cash: '2' } as const;
const BASIS_LABEL = { accrual: 'Accrual (Paid & Unpaid)', cash: 'Cash Basis (Paid Only)' } as const;

const DATES_DESCRIPTION =
  'Period reports (profit_and_loss, cash_flow, sales_tax, income_by_customer, purchases_by_vendor, account_balances) take `startDate` and `endDate`, defaulting to January 1 of this year through today. Point-in-time reports (balance_sheet, trial_balance, aged_receivables, aged_payables) take `asOf`, defaulting to today. profit_and_loss, balance_sheet, cash_flow, trial_balance and sales_tax take `basis`: accrual counts unpaid invoices and bills, cash only what has been paid.';

const reportInput = {
  businessId: z.uuid().optional(),
  report: ReportName,
  startDate: IsoDate.optional(),
  endDate: IsoDate.optional(),
  asOf: IsoDate.optional(),
  basis: z.enum(['accrual', 'cash']).default('accrual'),
  detail: z.enum(['summary', 'detailed']).default('summary').describe('detailed breaks totals down by account; some reports only come one way.'),
};
type ReportArgs = z.infer<z.ZodObject<typeof reportInput>>;

interface RanReport {
  report: ReportName;
  title: string;
  period: { startDate: string; endDate: string } | { asOf: string };
  basis: 'accrual' | 'cash' | null;
  result: ReportResult;
}

async function runReport(client: WaveClient, args: ReportArgs): Promise<RanReport> {
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
  return {
    report: args.report,
    title: spec.title,
    period: spec.filters === 'asOf' ? { asOf } : { startDate: start, endDate: end },
    basis: spec.basis ? args.basis : null,
    result: shapeReport(raw, args.detail),
  };
}

function summarise(ran: RanReport): Record<string, unknown> {
  return { report: ran.report, ...ran.period, ...(ran.basis ? { basis: ran.basis } : {}) };
}

export function registerReportTools(server: McpServer, client: WaveClient): void {
  server.registerTool(
    'wave_get_report',
    {
      title: 'Run a Wave report',
      description: `Runs one of Wave's financial reports and returns its headline figures and tables as labelled rows (\`type\` is header, section, data or total; \`indent\` is the nesting level; \`cells\` are the column values). ${DATES_DESCRIPTION}`,
      inputSchema: reportInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const ran = await runReport(client, args);
      return jsonResult({ ...summarise(ran), ...ran.result });
    },
  );

  server.registerTool(
    'wave_export_report',
    {
      title: 'Export a Wave report as CSV or PDF',
      description: `Runs one of Wave's financial reports and returns it as a file: the same CSV Wave's Export menu produces (title, business, period and basis lines, then each table with its header row), or a PDF of the same tables. The file comes back as an embedded resource (\`text/csv\` as text, \`application/pdf\` as base64) after a JSON summary. Use wave_get_report instead to read the figures. ${DATES_DESCRIPTION}`,
      inputSchema: { ...reportInput, format: z.enum(['csv', 'pdf']) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ format, ...args }) => {
      const ran = await runReport(client, args);
      const business = await client.rest.get<{ company_name?: unknown; name?: unknown }>(`/businesses/${client.businessId(args.businessId)}/`);
      const businessName = [business.company_name, business.name].find((n): n is string => typeof n === 'string' && n !== '') ?? '';
      const doc = {
        title: ran.title,
        businessName,
        periodLine: 'asOf' in ran.period ? `As of: ${ran.period.asOf}` : `Date Range: ${ran.period.startDate} to ${ran.period.endDate}`,
        basisLine: ran.basis ? `Report Type: ${BASIS_LABEL[ran.basis]}` : null,
        result: ran.result,
      };
      const fileName = `${ran.report}-${todayIso()}.${format}`;
      const summary = { ...summarise(ran), detail: ran.result.detail, format };
      return format === 'csv'
        ? fileResult(fileName, 'text/csv', reportToCsv(doc), summary)
        : fileResult(fileName, 'application/pdf', await reportToPdf(doc), summary);
    },
  );
}
