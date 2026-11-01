import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadPdf, pdfResult } from './_pdf.js';
import { WaveApiError } from '../client/errors.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('downloadPdf', () => {
  it('refuses a link that is not https', async () => {
    await expect(downloadPdf('http://files.example.com/x.pdf', 'x.pdf')).rejects.toThrow(/isn't https/);
  });

  it('raises WaveApiError without the signed query string when the download fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    const err = await downloadPdf('https://files.example.com/x.pdf?sig=TEST_SIG', 'x.pdf').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WaveApiError);
    expect((err as WaveApiError).url).toBe('https://files.example.com/x.pdf');
  });

  it('drops the bytes when the file is over the limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(20), { status: 200 })));
    const file = await downloadPdf('https://files.example.com/x.pdf', 'x.pdf', 10);
    expect(file.bytes).toBeNull();
    const result = pdfResult(file, {});
    expect(result.content).toHaveLength(1);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ embedded: false, bytes: null });
  });
});
