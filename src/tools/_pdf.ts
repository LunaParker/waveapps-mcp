import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { WaveApiError } from '../client/errors.js';

/** PDFs over this size come back as a link only; base64 inflates them by a third. */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export interface PdfFile {
  url: string;
  fileName: string;
  bytes: Uint8Array | null;
}

/**
 * Download a PDF from the short-lived signed link Wave hands out. Plain fetch, no Wave
 * headers: the link carries its own signature, and the session token must not leave Wave's hosts.
 */
export async function downloadPdf(url: string, fileName: string, maxBytes = MAX_PDF_BYTES): Promise<PdfFile> {
  if (!url.startsWith('https://')) throw new Error(`Wave returned a PDF link that isn't https: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new WaveApiError({ status: res.status, url: url.split('?')[0] ?? url, body: await res.text().catch(() => '') });
  const declared = Number(res.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) return { url, fileName, bytes: null };
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { url, fileName, bytes: bytes.byteLength > maxBytes ? null : bytes };
}

/** A tool result carrying the PDF as an embedded resource, plus a JSON summary with the link. */
export function pdfResult(file: PdfFile, summary: Record<string, unknown>): CallToolResult {
  const meta = {
    ...summary,
    fileName: file.fileName,
    pdfUrl: file.url,
    bytes: file.bytes?.byteLength ?? null,
    embedded: file.bytes !== null,
    note: file.bytes === null ? `PDF is over ${MAX_PDF_BYTES / (1024 * 1024)} MB, so only the link is returned; it expires after a short while.` : 'The link expires after a short while.',
  };
  const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(meta, null, 2) }];
  if (file.bytes !== null) {
    content.push({
      type: 'resource',
      resource: { uri: `wave-pdf:///${encodeURIComponent(file.fileName)}`, mimeType: 'application/pdf', blob: Buffer.from(file.bytes).toString('base64') },
    });
  }
  return { content };
}

/** A tool result carrying a file the server built itself (CSV as text, anything else as base64), plus a JSON summary. */
export function fileResult(fileName: string, mimeType: string, body: string | Uint8Array, summary: Record<string, unknown>): CallToolResult {
  const bytes = typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.byteLength;
  const meta = { ...summary, fileName, mimeType, bytes, embedded: true };
  const uri = `wave-export:///${encodeURIComponent(fileName)}`;
  const resource = typeof body === 'string' ? { uri, mimeType, text: body } : { uri, mimeType, blob: Buffer.from(body).toString('base64') };
  return { content: [{ type: 'text', text: JSON.stringify(meta, null, 2) }, { type: 'resource', resource }] };
}
