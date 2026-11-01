import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { reportToCsv, reportToPdf, type ReportDocument } from './_report-export.js';

const DOC: ReportDocument = {
  title: 'Profit and Loss',
  businessName: 'Owl, Shy "Studios"',
  periodLine: 'Date Range: 2026-01-01 to 2026-11-01',
  basisLine: 'Report Type: Accrual (Paid & Unpaid)',
  result: {
    detail: 'detailed',
    overview: [{ label: 'Income', value: '7244.72', currency: 'CAD' }],
    sections: [
      {
        title: 'ACCOUNT NUMBER',
        columns: ['ACCOUNT NUMBER', 'ACCOUNTS', 'Jan 01, 2026 to Nov 01, 2026'],
        rows: [
          { type: 'section', indent: 0, cells: ['', 'Income', null] },
          { type: 'data', indent: 1, cells: ['', 'Sales', '$7,244.72'] },
          { type: 'total', indent: 0, cells: ['', 'Total Income', '$7,244.72'], notes: [null, 'As a percentage of Total Income', '100.00%'] },
        ],
      },
      { title: null, columns: [], rows: [{ type: 'section', indent: 0, cells: ['', 'Operating Expenses'] }, { type: 'data', indent: 0, cells: ['', 'Computer – Software', '$1,223.76'] }] },
    ],
  },
};

describe('reportToCsv', () => {
  it("mirrors Wave's export: title lines, a blank line before each section, rows padded to the section's width, quoted fields, CRLF", () => {
    expect(reportToCsv(DOC)).toBe(
      [
        'Profit and Loss',
        '"Owl, Shy ""Studios"""',
        'Date Range: 2026-01-01 to 2026-11-01',
        'Report Type: Accrual (Paid & Unpaid)',
        '""',
        'ACCOUNT NUMBER,ACCOUNTS,"Jan 01, 2026 to Nov 01, 2026"',
        ',Income,',
        ',Sales,"$7,244.72"',
        ',Total Income,"$7,244.72"',
        '""',
        ',Operating Expenses,',
        ',Computer – Software,"$1,223.76"',
        '',
      ].join('\r\n'),
    );
  });

  it('leaves the basis line out for reports without one', () => {
    const csv = reportToCsv({ ...DOC, basisLine: null, periodLine: 'As of: 2026-10-31', result: { detail: 'summary', overview: [], sections: [] } });
    expect(csv).toBe('Profit and Loss\r\n"Owl, Shy ""Studios"""\r\nAs of: 2026-10-31\r\n');
  });
});

describe('reportToPdf', () => {
  it('produces a titled, single-page portrait PDF for a narrow report', async () => {
    const bytes = await reportToPdf(DOC);
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getTitle()).toBe('Owl, Shy "Studios" Profit and Loss');
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(height).toBeGreaterThan(width);
  });

  it('goes landscape for wide tables, paginates long ones and survives text Helvetica cannot encode', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      type: 'data',
      indent: i % 3,
      cells: [`Customer ${i} 日本`, '1.00', '2.00', '3.00', '4.00', '5.00', '6.00'],
    }));
    const bytes = await reportToPdf({ ...DOC, result: { detail: 'summary', overview: [], sections: [{ title: null, columns: [], rows }] } });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
  });
});
