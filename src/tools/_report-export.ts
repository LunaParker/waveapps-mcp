import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ReportResult, ReportRow } from './_shape.js';

// Wave has no export endpoint: its Export menu re-runs the report and renders the file in the browser.
// These renderers do the same from the shaped report, so the files match what Wave's own menu gives.
export interface ReportDocument {
  title: string;
  businessName: string;
  periodLine: string;
  basisLine: string | null;
  result: ReportResult;
}

function csvField(value: string | null): string {
  const s = value ?? '';
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Wave's layout: four title lines, then `""` before each section's header and rows, padded to the section's width. No indentation, no notes. */
export function reportToCsv(doc: ReportDocument): string {
  const lines = [doc.title, doc.businessName, doc.periodLine, doc.basisLine].filter((l): l is string => l !== null).map(csvField);
  for (const section of doc.result.sections) {
    lines.push('""');
    const width = Math.max(section.columns.length, ...section.rows.map((r) => r.cells.length));
    const pad = (cells: Array<string | null>): string => [...cells, ...Array<string>(width - cells.length).fill('')].map(csvField).join(',');
    if (section.columns.length > 0) lines.push(pad(section.columns));
    for (const row of section.rows) lines.push(pad(row.cells));
  }
  return `${lines.join('\r\n')}\r\n`;
}

const BOLD_ROWS = new Set(['header', 'section', 'total', 'subtotal']);
const GREY = rgb(0.45, 0.45, 0.45);
const RULE = rgb(0.8, 0.8, 0.8);
const MARGIN = 40;
const BODY = 9;
const LINE = 14;
const NOTE = 7;
const INDENT = 12;

/** Helvetica is WinAnsi-only; anything else would make pdf-lib throw, so it becomes `?`. */
function safe(s: string | null): string {
  return (s ?? '').replace(/\s+/g, ' ').replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…€™]/g, '?');
}

function fit(s: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  let cut = s;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Shrink long text by up to three points before cutting it short. */
function shrink(s: string, font: PDFFont, size: number, maxWidth: number): { text: string; size: number } {
  for (let candidate = size; candidate >= size - 3; candidate -= 1) {
    if (font.widthOfTextAtSize(s, candidate) <= maxWidth) return { text: s, size: candidate };
  }
  return { text: fit(s, font, size - 3, maxWidth), size: size - 3 };
}

/** Cells that read as money, a count or a percentage (`$1.00`, `3 invoices`, `100.00%`, `-`) sit in narrow right-aligned columns. */
const AMOUNT = /^[-–—(]?\s*[$€£¥]?\s*-?[\d,]+(\.\d+)?\s*%?\)?(\s[A-Za-z]{1,10})?$|^[-–—]$/;

interface Column { x: number; width: number; align: 'left' | 'right' }

/** One slot per cell index: `null` drops a column no data row fills (Wave's empty ACCOUNT NUMBER). */
function layoutColumns(sections: ReportDocument['result']['sections'], usable: number, headerWidth: (text: string) => number): Array<Column | null> {
  const count = Math.max(1, ...sections.map((s) => Math.max(s.columns.length, ...s.rows.map((r) => r.cells.length))));
  const filled = Array<number>(count).fill(0);
  const amounts = Array<number>(count).fill(0);
  for (const section of sections) {
    for (const row of section.rows) {
      row.cells.forEach((cell, i) => {
        const text = safe(cell).trim();
        if (text === '') return;
        filled[i] = (filled[i] ?? 0) + 1;
        if (AMOUNT.test(text)) amounts[i] = (amounts[i] ?? 0) + 1;
      });
    }
  }
  const used = filled.map((n) => n > 0);
  if (!used.some(Boolean)) used[0] = true;
  // Value grids label their columns in an ordinary row, so a column is numeric when most of its cells are.
  const numeric = filled.map((n, i) => n > 0 && (amounts[i] ?? 0) * 2 >= n);
  const numCount = used.filter((u, i) => u && numeric[i]).length;
  const textCount = used.filter((u, i) => u && !numeric[i]).length;
  const widestHeader = Math.max(0, ...sections.flatMap((s) => s.columns.map((c, i) => (used[i] && numeric[i] ? headerWidth(safe(c)) + 8 : 0))));
  const numWidth = numCount === 0 ? 0 : textCount === 0 ? usable / numCount : Math.min((usable * 0.65) / numCount, Math.max(70, widestHeader));
  const textWidth = textCount === 0 ? 0 : (usable - numCount * numWidth) / textCount;
  let x = MARGIN;
  return used.map((u, i) => {
    if (!u) return null;
    const width = numeric[i] ? numWidth : textWidth;
    const column: Column = { x, width, align: numeric[i] ? 'right' : 'left' };
    x += width;
    return column;
  });
}

export async function reportToPdf(doc: ReportDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.businessName} ${doc.title}`.trim());
  pdf.setProducer('waveapps-mcp');
  pdf.setCreator('waveapps-mcp');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const sections = doc.result.sections;
  const headerWidth = (text: string): number => bold.widthOfTextAtSize(text, BODY);
  const landscape = layoutColumns(sections, 1, headerWidth).filter(Boolean).length > 5;
  const [width, height] = landscape ? [PageSizes.Letter[1], PageSizes.Letter[0]] : PageSizes.Letter;
  const usable = width - 2 * MARGIN;
  const layout = layoutColumns(sections, usable, headerWidth);
  const firstText = layout.find((c) => c?.align === 'left') ?? null;

  let page: PDFPage = pdf.addPage([width, height]);
  let y = height - MARGIN;
  const ensure = (needed: number): void => {
    if (y - needed >= MARGIN + LINE) return;
    page = pdf.addPage([width, height]);
    y = height - MARGIN;
  };
  const line = (text: string | null, font: PDFFont, size: number, color = rgb(0, 0, 0)): void => {
    y -= size + 4;
    page.drawText(fit(safe(text), font, size, usable), { x: MARGIN, y, size, font, color });
  };
  const cells = (values: Array<string | null>, font: PDFFont, size: number, indent: number, color = rgb(0, 0, 0)): void => {
    values.forEach((value, i) => {
      const column = layout[i];
      const text = safe(value);
      if (!column || text === '') return;
      const pad = column === firstText ? indent * INDENT : 0;
      const shown = shrink(text, font, size, column.width - 6 - pad);
      const x = column.align === 'left' ? column.x + pad : column.x + column.width - font.widthOfTextAtSize(shown.text, shown.size);
      page.drawText(shown.text, { x, y, size: shown.size, font, color });
    });
  };
  const rule = (color = RULE): void => {
    page.drawLine({ start: { x: MARGIN, y: y - 3 }, end: { x: width - MARGIN, y: y - 3 }, thickness: 0.5, color });
  };

  line(doc.title, bold, 16);
  line(doc.businessName, regular, 11);
  line(doc.periodLine, regular, BODY, GREY);
  if (doc.basisLine) line(doc.basisLine, regular, BODY, GREY);
  y -= 10;

  for (const section of sections) {
    ensure(LINE * 3);
    if (section.columns.length > 0) {
      y -= LINE;
      cells(section.columns, bold, BODY, 0);
      rule(GREY);
      y -= 4;
    }
    for (const row of section.rows) {
      const isBold = row.type !== null && BOLD_ROWS.has(row.type);
      const notes = noteCells(row);
      ensure(LINE + (notes ? NOTE + 3 : 0));
      y -= LINE;
      if (row.type === 'total' || row.type === 'subtotal') rule();
      cells(row.cells, isBold ? bold : regular, BODY, row.indent ?? 0);
      if (notes) {
        y -= NOTE + 3;
        cells(notes, regular, NOTE, row.indent ?? 0, GREY);
      }
    }
    y -= LINE / 2;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: width - MARGIN - regular.widthOfTextAtSize(label, 8), y: MARGIN / 2, size: 8, font: regular, color: GREY });
  });
  return pdf.save();
}

function noteCells(row: ReportRow): Array<string | null> | null {
  return row.notes && row.notes.some((n) => n !== null && n !== '') ? row.notes : null;
}
