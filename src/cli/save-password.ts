import { credentialsPath, patchCredentials, readCredentials } from '../auth/credentials.js';
import { secretStore, type SecretStore } from '../auth/secrets.js';
import { totp } from '../auth/totp.js';
import { Prompter, type PromptIo } from './prompter.js';

export interface RunSavePasswordDeps {
  /** Test injection — defaults to a real `Prompter` bound to stdin/stdout. */
  io?: PromptIo;
  console?: Pick<Console, 'log' | 'error'>;
  /** Where the password and TOTP secret go. Defaults to the OS credential store. */
  store?: SecretStore;
}

export interface RunSavePasswordOptions {
  /** Skip the interactive "type y to confirm" gate. Wired from CLI `-y` / `--yes`. */
  skipConfirmation?: boolean;
}

export const SAVE_PW_EXIT_OK = 0;
export const SAVE_PW_EXIT_NO_INPUT = 1;
export const SAVE_PW_EXIT_BAD_TOTP = 2;
export const SAVE_PW_EXIT_DECLINED = 3;
export const SAVE_PW_EXIT_STORE_FAILED = 4;

const BANNER_WIDTH = 70;
const HR = '═'.repeat(BANNER_WIDTH - 2);
// ║ + 2 padding + INNER + 2 padding + ║  →  inner width = BANNER_WIDTH - 6
const INNER_WIDTH = BANNER_WIDTH - 6;

const BANNER_LINES: ReadonlyArray<string> = [
  `╔${HR}╗`,
  centred('⚠️  WARNING — THIS IS INSECURE  ⚠️'),
  `║${' '.repeat(BANNER_WIDTH - 2)}║`,
  wrap('This command stores your Wave password in the OS credential'),
  wrap('store (macOS Keychain, Windows Credential Manager, Linux'),
  wrap('Secret Service) so the server can sign back in on its own.'),
  wrap('Anything that can run as your user can read it back.'),
  `║${' '.repeat(BANNER_WIDTH - 2)}║`,
  wrap('If you ALSO store the TOTP secret, this machine alone is'),
  wrap('enough to sign in as you. You have effectively turned 2FA'),
  wrap('off for anyone who can run code here.'),
  `║${' '.repeat(BANNER_WIDTH - 2)}║`,
  wrap('Only enable this if you have weighed the trade-off:'),
  wrap('  • single-user dev machine'),
  wrap('  • full-disk encryption on'),
  wrap('  • no shared / synced home directory'),
  wrap('  • you accept that this machine is now a higher-value target'),
  wrap('    than the 18-hour session cookie it replaces'),
  `║${' '.repeat(BANNER_WIDTH - 2)}║`,
  wrap('Wipe at any time with:  npx waveapps-mcp logout'),
  `╚${HR}╝`,
];

function wrap(text: string): string {
  return `║  ${text.padEnd(INNER_WIDTH, ' ').slice(0, INNER_WIDTH)}  ║`;
}

function centred(text: string): string {
  const width = visualWidth(text);
  const left = Math.max(0, Math.floor((INNER_WIDTH - width) / 2));
  const right = Math.max(0, INNER_WIDTH - width - left);
  return `║  ${' '.repeat(left)}${text}${' '.repeat(right)}  ║`;
}

/**
 * Width of `text` in terminal columns. We use ⚠️ (emoji presentation, U+26A0 U+FE0F)
 * which reliably renders as 2 columns. The variation selector itself is invisible — count
 * it as zero so emoji-modified glyphs aren't over-counted.
 */
function visualWidth(text: string): number {
  return [...text].reduce((acc, ch) => {
    if (ch === '⚠') return acc + 2;
    if (ch === '️') return acc + 0; // variation selector-16, invisible presentation hint
    return acc + 1;
  }, 0);
}

const CONFIRM_PROMPT = `\nType "y" to confirm you've read the warning above and want to proceed (anything else aborts): `;

/**
 * Prompt for email + password (+ optional TOTP secret). The email goes in credentials.json,
 * the secrets in the OS credential store. Doesn't sign in: that happens on the next expiry.
 */
export async function runSavePassword(
  deps: RunSavePasswordDeps = {},
  options: RunSavePasswordOptions = {},
): Promise<number> {
  const log = (deps.console ?? console).log;
  const err = (deps.console ?? console).error;
  const io = deps.io ?? new Prompter();
  const store = deps.store ?? secretStore();

  try {
    for (const line of BANNER_LINES) log(line);

    if (!options.skipConfirmation) {
      const reply = (await io.ask(CONFIRM_PROMPT)).trim().toLowerCase();
      if (reply !== 'y' && reply !== 'yes') {
        log('[waveapps-mcp] Aborted. No changes made.');
        return SAVE_PW_EXIT_DECLINED;
      }
    } else {
      log('\n[waveapps-mcp] Skipping confirmation (--yes).');
    }
    log('');

    const existing = readCredentials();
    if (!existing) {
      err('[waveapps-mcp] No credentials.json yet — run `npx waveapps-mcp login` once first.');
      return SAVE_PW_EXIT_NO_INPUT;
    }

    const emailRaw = sanitise(await io.ask(`  Wave email${existing.email ? ` [${existing.email}]` : ''}: `));
    const email = emailRaw.length > 0 ? emailRaw : existing.email;
    if (!email) {
      err('[waveapps-mcp] Email is required.');
      return SAVE_PW_EXIT_NO_INPUT;
    }

    const password = sanitise(await io.askSecret('  Wave password (input hidden): '));
    if (!password) {
      err('[waveapps-mcp] Password is required.');
      return SAVE_PW_EXIT_NO_INPUT;
    }

    const twoFa = (await io.ask('  Do you have 2FA enabled on Wave? [y/N]: ')).trim().toLowerCase();
    const hasTwoFa = twoFa === 'y' || twoFa === 'yes';
    let totpSecret: string | undefined;
    if (hasTwoFa) {
      log('');
      log('  ⚠️  Storing the TOTP secret defeats 2FA. Continue only if intentional.');
      const secretRaw = sanitise(await io.askSecret('  TOTP base32 secret (input hidden): '));
      if (!secretRaw) {
        log('  No secret provided — keeping any stored one. Without one, sign-in stops at the 2FA page.');
      } else {
        try {
          totp(secretRaw); // throws if base32 is malformed
          totpSecret = secretRaw;
        } catch (e) {
          err(`[waveapps-mcp] Invalid TOTP secret: ${(e as Error).message}`);
          return SAVE_PW_EXIT_BAD_TOTP;
        }
      }
    }

    try {
      store.set('password', password);
      if (totpSecret) store.set('totp-secret', totpSecret);
      else if (!hasTwoFa) store.delete('totp-secret');
    } catch (e) {
      err(`[waveapps-mcp] Could not write to the OS credential store: ${(e as Error).message}`);
      return SAVE_PW_EXIT_STORE_FAILED;
    }
    patchCredentials({ email });
    log('');
    log(`[waveapps-mcp] Email saved to ${credentialsPath()}; password${totpSecret ? ' and TOTP secret' : ''} saved to the OS credential store.`);
    log('[waveapps-mcp] Automatic sign-in on expiry is now enabled. Try it with `npx waveapps-mcp refresh`.');
    return SAVE_PW_EXIT_OK;
  } finally {
    io.close?.();
  }
}

function sanitise(raw: string): string {
  let v = raw.trim();
  if (v.length >= 2) {
    const f = v[0];
    const l = v[v.length - 1];
    if ((f === '"' && l === '"') || (f === "'" && l === "'")) v = v.slice(1, -1).trim();
  }
  return v;
}
