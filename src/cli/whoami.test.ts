import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeCredentials } from '../auth/credentials.js';
import { runWhoami } from './whoami.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wave-mcp-whoami-'));
  process.env['WAVE_MCP_CONFIG_DIR'] = tmp;
});

afterEach(() => {
  delete process.env['WAVE_MCP_CONFIG_DIR'];
  rmSync(tmp, { recursive: true, force: true });
});

describe('runWhoami', () => {
  it('exits 1 with a hint when no credentials exist', () => {
    const log = vi.fn();
    expect(runWhoami({ console: { log } })).toBe(1);
    expect(log.mock.calls.flat().join('\n')).toMatch(/npx waveapps-mcp login/);
  });

  it('prints masked token + businessId when credentials exist', () => {
    writeCredentials({
      authToken: 'EXAMPLE_FAKE_WAVE_TOKEN_30CHRSAB',
      csrfToken: 'EXAMPLE_FAKE_CSRF_TOKEN_32CHARSEEXX',
      businessId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      email: undefined,
      password: undefined,
      totpSecret: undefined,
    });
    const log = vi.fn();
    expect(runWhoami({ console: { log } })).toBe(0);
    const out = log.mock.calls.flat().join('\n');
    expect(out).toContain('EXAM…AB');
    expect(out).not.toContain('EXAMPLE_FAKE_WAVE_TOKEN_30CHRSAB');
    expect(out).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(out).toMatch(/csrfToken: +EXAM/);
  });

  it('handles a short token without exposing it', () => {
    writeCredentials({ authToken: 'short', csrfToken: undefined, businessId: undefined, email: undefined, password: undefined, totpSecret: undefined });
    const log = vi.fn();
    runWhoami({ console: { log } });
    const out = log.mock.calls.flat().join('\n');
    expect(out).toContain('5 chars');
    expect(out).toContain('(none — mutations will fail)');
    expect(out).toContain('(none — pass to each tool)');
  });

  it('falls back to the global console when no override is supplied', () => {
    writeCredentials({ authToken: 'X', csrfToken: undefined, businessId: undefined, email: undefined, password: undefined, totpSecret: undefined });
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(runWhoami()).toBe(0);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('humanises ages in minutes / hours / days', () => {
    // We hit the seconds branch with the standard writeCredentials test above.
    // Use a hand-crafted mtime to exercise the other branches deterministically.
    const fs = require('node:fs');
    writeCredentials({ authToken: 'X', csrfToken: undefined, businessId: undefined, email: undefined, password: undefined, totpSecret: undefined });
    const filePath = join(tmp, 'credentials.json');
    const now = Date.now();
    const cases: Array<[number, string]> = [
      [60 * 5, 'm'],
      [3600 * 3, 'h'],
      [86_400 * 2, 'd'],
    ];
    for (const [agoSec, suffix] of cases) {
      const past = new Date(now - agoSec * 1000);
      fs.utimesSync(filePath, past, past);
      const log = vi.fn();
      runWhoami({ console: { log } });
      const out = log.mock.calls.flat().join('\n');
      expect(out).toMatch(new RegExp(`~\\d+${suffix} ago`));
    }
  });
});
