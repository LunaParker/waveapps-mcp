import { describe, expect, it, vi } from 'vitest';
import { registerReportTools } from './reports.js';
import { BUSINESS_UUID, createMockClient, createStubServer } from './_test_utils.js';

const cell = (value: unknown, params: Record<string, unknown> = {}) => ({ value, cell_type: { value: 0, display_name: 'Text Cell' }, params: { col_span: 1, ...params } });
const RAW_PL = {
  overview: { comparison_mode: false, summary: [{ label: 'Income', total: { currency: { code: 'CAD' }, value: '1000.00', formatted_string: '$1,000.00' }, is_positive: null, subtitle: null }] },
  reports: {
    summary: [{
      meta: { width: 2 },
      header: { row_type: { value: 0, display_name: 'Header Row' }, cells: [cell(['ACCOUNTS']), cell(['Jan 1, 2026', 'to Nov 1, 2026'])], params: { indentation_level: 0 } },
      rows: [
        { row_type: { value: 2, display_name: 'Data Row' }, cells: [cell(['Income']), cell(['1000.00'])], params: { indentation_level: 0 } },
        { row_type: { value: 1, display_name: 'Section Row' }, cells: [cell(['Gross Profit'], { subtitle: 'As a percentage of Total Income' }), cell(['1000.00'], { subtitle: '100.00%' })], params: { indentation_level: 0 } },
      ],
      columns: [{ width: 1 }, { width: 1 }],
    }],
    detailed: [],
  },
  filters: { date_periods: [{ start_date: '2026-01-01', end_date: '2026-11-01' }], report_type: 1 },
  version: 2,
};

function setup(raw: unknown = RAW_PL) {
  const stub = createStubServer();
  const mock = createMockClient();
  mock.rest.post.mockResolvedValueOnce(raw);
  registerReportTools(stub.server as never, mock.client);
  return { stub, mock };
}

describe('registerReportTools', () => {
  it('posts the period, basis and version Wave expects for profit and loss', async () => {
    const { stub, mock } = setup();
    const out = await stub.parsed('wave_get_report', { report: 'profit_and_loss', startDate: '2026-01-01', endDate: '2026-11-01', basis: 'cash' });
    const [path, body] = mock.rest.post.mock.calls[0]!;
    expect(path).toBe(`/businesses/${BUSINESS_UUID}/reports/profit_and_loss/`);
    expect(body).toMatchObject({ filters: { date_periods: [{ start_date: '2026-01-01', end_date: '2026-11-01' }], report_type: '2' }, version: 2 });
    expect(out).toEqual({
      report: 'profit_and_loss',
      startDate: '2026-01-01',
      endDate: '2026-11-01',
      basis: 'cash',
      detail: 'summary',
      overview: [{ label: 'Income', value: '1000.00', currency: 'CAD' }],
      sections: [{
        title: 'ACCOUNTS',
        columns: ['ACCOUNTS', 'Jan 1, 2026 to Nov 1, 2026'],
        rows: [
          { type: 'data', indent: 0, cells: ['Income', '1000.00'] },
          { type: 'section', indent: 0, cells: ['Gross Profit', '1000.00'], notes: ['As a percentage of Total Income', '100.00%'] },
        ],
      }],
    });
  });

  it('sends an as-of date and no basis for the aged reports, and reads value grids', async () => {
    const raw = {
      overview: {},
      reports: { summary: null, detailed: [{ report_engine_type: { value: 1, display_name: 'Title' }, values: [[{ value: '', params: {} }, { value: 'Number of Days Overdue', params: {} }]] }] },
    };
    const { stub, mock } = setup(raw);
    const out = (await stub.parsed('wave_get_report', { report: 'aged_receivables', asOf: '2026-10-31' })) as Record<string, unknown>;
    const body = mock.rest.post.mock.calls[0]![1];
    expect(body.filters).toEqual({ report_date: '2026-10-31' });
    expect(body.version).toBe(1);
    expect(out).toMatchObject({ report: 'aged_receivables', asOf: '2026-10-31', detail: 'detailed', sections: [{ title: 'Title', rows: [{ cells: ['', 'Number of Days Overdue'] }] }] });
    expect(out).not.toHaveProperty('basis');
  });

  it('defaults a range report to January 1 of this year through today', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15, 12));
    try {
      const { stub, mock } = setup({ overview: {}, reports: { summary: [], detailed: null } });
      await stub.invoke('wave_get_report', { report: 'income_by_customer' });
      expect(mock.rest.post.mock.calls[0]![1].filters).toEqual({ start_date: '2026-01-01', end_date: '2026-07-15' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('labels a headline figure by its key when Wave leaves the name empty', async () => {
    const raw = { overview: { balance_after_payments: { name: '', balance: { currency: { code: 'CAD' }, value: '5.00' } }, comparison_mode: false }, reports: { summary: [] } };
    const { stub } = setup(raw);
    const out = (await stub.parsed('wave_get_report', { report: 'balance_sheet' })) as { overview: unknown };
    expect(out.overview).toEqual([{ label: 'balance after payments', value: '5.00', currency: 'CAD' }]);
  });
});
