import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCredentials, writeCredentials } from '../auth/credentials.js';
import { memorySecretStore, secretStore } from '../auth/secrets.js';
import {
  SAVE_PW_EXIT_BAD_TOTP,
  SAVE_PW_EXIT_DECLINED,
  SAVE_PW_EXIT_NO_INPUT,
  SAVE_PW_EXIT_OK,
  SAVE_PW_EXIT_STORE_FAILED,
  runSavePassword,
} from './save-password.js';
import type { PromptIo } from './prompter.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wave-mcp-savepw-'));
  process.env['WAVE_MCP_CONFIG_DIR'] = tmp;
});

afterEach(() => {
  delete process.env['WAVE_MCP_CONFIG_DIR'];
  rmSync(tmp, { recursive: true, force: true });
});

/** Scripted prompter — separate queues for echoed vs secret prompts so order matches the CLI flow. */
function scriptedIo(asks: ReadonlyArray<string>, secrets: ReadonlyArray<string>): PromptIo & { askLog: string[]; secretLog: string[] } {
  let askIdx = 0;
  let secretIdx = 0;
  const askLog: string[] = [];
  const secretLog: string[] = [];
  return {
    async ask(question) {
      askLog.push(question);
      return asks[askIdx++] ?? '';
    },
    async askSecret(question) {
      secretLog.push(question);
      return secrets[secretIdx++] ?? '';
    },
    close() {},
    askLog,
    secretLog,
  };
}

function seed(): void {
  writeCredentials({
    authToken: 'EXISTING_TOKEN',
    csrfToken: 'EXISTING_CSRF',
    businessId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    email: undefined,
  });
}

const silent = { log: () => undefined, error: () => undefined };

describe('runSavePassword', () => {
  describe('warning banner + confirmation', () => {
    it('prints a boxed warning that mentions insecurity, 2FA, and includes ⚠️ characters', async () => {
      seed();
      const log = vi.fn();
      const io = scriptedIo(['n'], []); // 'n' aborts at the confirmation prompt
      await runSavePassword({ io, console: { log, error: () => undefined } });
      const banner = log.mock.calls.flat().join('\n');
      expect(banner).toContain('⚠️');
      expect(banner).toMatch(/WARNING — THIS IS INSECURE/);
      expect(banner).toContain('╔');
      expect(banner).toContain('╚');
      expect(banner).toMatch(/Keychain/);
      expect(banner).toMatch(/2FA/);
    });

    it('renders every banner line at the same visual width as the top border', async () => {
      seed();
      const log = vi.fn();
      const io = scriptedIo(['n'], []);
      await runSavePassword({ io, console: { log, error: () => undefined } });
      // The banner is a contiguous block of lines that start with one of the box-drawing
      // characters. Compare each one's visual width to the top border's.
      const bannerLines = log.mock.calls
        .flat()
        .filter((s): s is string => typeof s === 'string')
        .filter((s) => /^[║╔╚]/.test(s));
      expect(bannerLines.length).toBeGreaterThan(5);
      const visualWidth = (text: string): number =>
        [...text].reduce((acc, ch) => {
          if (ch === '⚠') return acc + 2;
          if (ch === '️') return acc + 0;
          return acc + 1;
        }, 0);
      const top = bannerLines[0]!;
      const topWidth = visualWidth(top);
      for (const line of bannerLines) {
        expect(visualWidth(line)).toBe(topWidth);
      }
    });

    it('aborts with DECLINED when the user does not type y', async () => {
      seed();
      const io = scriptedIo(['n'], []);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_DECLINED);
      expect(secretStore().get('password')).toBeNull();
    });

    it.each(['', 'no', 'nope', 'maybe', '?'])('treats "%s" as a decline', async (reply) => {
      seed();
      const io = scriptedIo([reply], []);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_DECLINED);
    });

    it.each(['y', 'Y', 'yes', 'YES'])('accepts "%s" as confirmation', async (reply) => {
      seed();
      const io = scriptedIo([reply, 'me@example.com', 'n'], ['pw']);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_OK);
    });

    it('skips the confirmation when options.skipConfirmation is true', async () => {
      seed();
      const io = scriptedIo(['me@example.com', 'n'], ['pw']);
      const code = await runSavePassword({ io, console: silent }, { skipConfirmation: true });
      expect(code).toBe(SAVE_PW_EXIT_OK);
      // First ask should have been the email prompt, NOT the confirmation.
      expect(io.askLog[0]).toMatch(/Wave email/);
    });
  });

  describe('email / password prompts', () => {
    it('stores email + password when 2FA is declined', async () => {
      seed();
      const io = scriptedIo(['y', 'me@example.com', 'n'], ['pw']);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_OK);
      const out = readCredentials();
      expect(out?.email).toBe('me@example.com');
      expect(secretStore().get('password')).toBe('pw');
      expect(secretStore().get('totp-secret')).toBeNull();
      expect(out?.authToken).toBe('EXISTING_TOKEN'); // existing fields preserved
    });

    it('uses askSecret (not ask) for the password prompt', async () => {
      seed();
      const io = scriptedIo(['y', 'me@example.com', 'n'], ['pw']);
      await runSavePassword({ io, console: silent });
      // The password prompt must have gone to askSecret, never to ask.
      expect(io.secretLog.some((q) => /password/i.test(q))).toBe(true);
      expect(io.askLog.every((q) => !/password/i.test(q))).toBe(true);
    });

    it('falls back to the existing email when the user just hits Enter', async () => {
      writeCredentials({
        authToken: 'T', csrfToken: undefined, businessId: undefined,
        email: 'old@example.com',
      });
      const io = scriptedIo(['y', '', 'n'], ['pw']);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_OK);
      expect(readCredentials()?.email).toBe('old@example.com');
    });

    it('refuses an empty password', async () => {
      seed();
      const io = scriptedIo(['y', 'me@example.com'], ['']);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_NO_INPUT);
    });

    it('refuses if no credentials.json exists yet (need login first)', async () => {
      const err = vi.fn();
      const io = scriptedIo(['y', 'me@example.com'], ['pw']);
      const code = await runSavePassword({ io, console: { log: () => undefined, error: err } });
      expect(code).toBe(SAVE_PW_EXIT_NO_INPUT);
      expect(err.mock.calls.flat().join('\n')).toMatch(/login/);
    });
  });

  describe('2FA gating', () => {
    it('does NOT ask for the TOTP secret when the user says they have no 2FA', async () => {
      seed();
      const io = scriptedIo(['y', 'me@example.com', 'n'], ['pw']);
      await runSavePassword({ io, console: silent });
      expect(io.secretLog.length).toBe(1); // password only — no TOTP prompt
    });

    it('asks for + stores TOTP secret when 2FA is enabled', async () => {
      seed();
      const io = scriptedIo(['y', 'me@example.com', 'y'], ['pw', 'JBSWY3DPEHPK3PXP']);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_OK);
      expect(secretStore().get('totp-secret')).toBe('JBSWY3DPEHPK3PXP');
      // Both password and TOTP secret went through askSecret.
      expect(io.secretLog).toHaveLength(2);
      expect(io.secretLog[1]).toMatch(/TOTP/);
    });

    it('rejects a malformed TOTP secret with BAD_TOTP', async () => {
      seed();
      const io = scriptedIo(['y', 'me@example.com', 'yes'], ['pw', '!!!not-base32!!!']);
      const code = await runSavePassword({ io, console: silent });
      expect(code).toBe(SAVE_PW_EXIT_BAD_TOTP);
      expect(secretStore().get('totp-secret')).toBeNull();
      expect(secretStore().get('password')).toBeNull();
    });

    it('skips silently if the user opts in but pastes nothing', async () => {
      seed();
      const log = vi.fn();
      const io = scriptedIo(['y', 'me@example.com', 'y'], ['pw', '']);
      const code = await runSavePassword({ io, console: { log, error: () => undefined } });
      expect(code).toBe(SAVE_PW_EXIT_OK);
      expect(secretStore().get('totp-secret')).toBeNull();
      expect(log.mock.calls.flat().join('\n')).toMatch(/keeping any stored one/);
    });

    it('keeps an existing TOTP secret when the user opts in but pastes nothing', async () => {
      seed();
      secretStore().set('totp-secret', 'JBSWY3DPEHPK3PXP');
      const io = scriptedIo(['y', 'me@example.com', 'y'], ['pw', '']);
      expect(await runSavePassword({ io, console: silent })).toBe(SAVE_PW_EXIT_OK);
      expect(secretStore().get('totp-secret')).toBe('JBSWY3DPEHPK3PXP');
    });

    it('removes a stored TOTP secret when the user says 2FA is off', async () => {
      seed();
      secretStore().set('totp-secret', 'JBSWY3DPEHPK3PXP');
      const io = scriptedIo(['y', 'me@example.com', 'n'], ['pw']);
      expect(await runSavePassword({ io, console: silent })).toBe(SAVE_PW_EXIT_OK);
      expect(secretStore().get('totp-secret')).toBeNull();
    });
  });

  describe('credential store', () => {
    it('never writes the password or TOTP secret into credentials.json', async () => {
      seed();
      const io = scriptedIo(['y', 'me@example.com', 'y'], ['hunter2', 'JBSWY3DPEHPK3PXP']);
      await runSavePassword({ io, console: silent });
      const raw = readFileSync(join(tmp, 'credentials.json'), 'utf8');
      expect(raw).not.toContain('hunter2');
      expect(raw).not.toContain('JBSWY3DPEHPK3PXP');
    });

    it('reports STORE_FAILED and leaves credentials.json alone when the store rejects the write', async () => {
      seed();
      const before = readFileSync(join(tmp, 'credentials.json'), 'utf8');
      const store = { ...memorySecretStore(), set: (): void => { throw new Error('keychain locked'); } };
      const io = scriptedIo(['y', 'me@example.com', 'n'], ['pw']);
      expect(await runSavePassword({ io, console: silent, store })).toBe(SAVE_PW_EXIT_STORE_FAILED);
      expect(readFileSync(join(tmp, 'credentials.json'), 'utf8')).toBe(before);
    });
  });
});
