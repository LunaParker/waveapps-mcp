import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCredentials } from '../auth/credentials.js';
import { PASTE_EXIT_NO_TOKEN, PASTE_EXIT_OK, runPaste, sanitise } from './paste.js';

const BUSINESS_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wave-mcp-paste-'));
  process.env['WAVE_MCP_CONFIG_DIR'] = tmp;
});

afterEach(() => {
  delete process.env['WAVE_MCP_CONFIG_DIR'];
  rmSync(tmp, { recursive: true, force: true });
});

function scriptedAsk(answers: ReadonlyArray<string>): (q: string) => Promise<string> {
  let i = 0;
  return async () => answers[i++] ?? '';
}

const silent = { log: () => undefined, error: () => undefined };

describe('sanitise', () => {
  it('trims whitespace', () => {
    expect(sanitise('  hello  ')).toBe('hello');
  });

  it('strips paired double quotes', () => {
    expect(sanitise('"abc"')).toBe('abc');
  });

  it('strips paired single quotes', () => {
    expect(sanitise("'abc'")).toBe('abc');
  });

  it('keeps unmatched quotes', () => {
    expect(sanitise('"abc')).toBe('"abc');
    expect(sanitise("abc'")).toBe("abc'");
  });

  it('handles empty input', () => {
    expect(sanitise('')).toBe('');
    expect(sanitise('   ')).toBe('');
  });
});

describe('runPaste', () => {
  it('saves all three values when provided', async () => {
    const code = await runPaste({
      ask: scriptedAsk(['TOKENVAL', 'CSRFVAL', BUSINESS_UUID]),
      console: silent,
    });
    expect(code).toBe(PASTE_EXIT_OK);
    expect(readCredentials()).toMatchObject({
      authToken: 'TOKENVAL',
      csrfToken: 'CSRFVAL',
      businessId: BUSINESS_UUID,
    });
  });

  it('saves auth-only when CSRF + business are blank', async () => {
    const code = await runPaste({
      ask: scriptedAsk(['TOKEN', '', '']),
      console: silent,
    });
    expect(code).toBe(PASTE_EXIT_OK);
    const stored = readCredentials();
    expect(stored?.authToken).toBe('TOKEN');
    expect(stored?.csrfToken).toBeUndefined();
    expect(stored?.businessId).toBeUndefined();
  });

  it('strips quotes + whitespace on every field', async () => {
    const code = await runPaste({
      ask: scriptedAsk(['  "TOKEN"  ', "'CSRF'", `"${BUSINESS_UUID}"`]),
      console: silent,
    });
    expect(code).toBe(PASTE_EXIT_OK);
    expect(readCredentials()).toMatchObject({
      authToken: 'TOKEN',
      csrfToken: 'CSRF',
      businessId: BUSINESS_UUID,
    });
  });

  it('rejects non-UUID business IDs and saves without a default', async () => {
    const log = vi.fn();
    const err = vi.fn();
    const code = await runPaste({
      ask: scriptedAsk(['TOKEN', '', 'not-a-uuid']),
      console: { log, error: err },
    });
    expect(code).toBe(PASTE_EXIT_OK);
    expect(readCredentials()?.businessId).toBeUndefined();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('not a valid UUID'));
  });

  it('aborts with NO_TOKEN when authToken is empty', async () => {
    const err = vi.fn();
    const code = await runPaste({
      ask: scriptedAsk(['', 'CSRF', BUSINESS_UUID]),
      console: { log: () => undefined, error: err },
    });
    expect(code).toBe(PASTE_EXIT_NO_TOKEN);
    expect(readCredentials()).toBeNull();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('No token'));
  });

  it('falls back to the global console when no override is given (early exit path)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const code = await runPaste({ ask: scriptedAsk(['']) });
      expect(code).toBe(PASTE_EXIT_NO_TOKEN);
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it('warns about missing CSRF when only auth is provided', async () => {
    const log = vi.fn();
    await runPaste({
      ask: scriptedAsk(['TOKEN', '', '']),
      console: { log, error: () => undefined },
    });
    const all = log.mock.calls.flat().join('\n');
    expect(all).toMatch(/No CSRF token saved/);
  });
});
