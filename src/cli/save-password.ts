import { credentialsPath, patchCredentials, readCredentials } from '../auth/credentials.js';
import { totp } from '../auth/totp.js';
import { Prompter, type PromptIo } from './prompter.js';

export interface RunSavePasswordDeps {
  /** Test injection — defaults to a real `Prompter` bound to stdin/stdout. */
  io?: PromptIo;
  console?: Pick<Console, 'log' | 'error'>;
}

export interface RunSavePasswordOptions {
  /** Skip the interactive "type y to confirm" gate. Wired from CLI `-y` / `--yes`. */
  skipConfirmation?: boolean;
}

export const SAVE_PW_EXIT_OK = 0;
export const SAVE_PW_EXIT_NO_INPUT = 1;
export const SAVE_PW_EXIT_BAD_TOTP = 2;
export const SAVE_PW_EXIT_DECLINED = 3;

const BANNER_WIDTH = 70;
const HR = '═'.repeat(BANNER_WIDTH - 2);
// ║ + 2 padding + INNER + 2 padding + ║  →  inner width = BANNER_WIDTH - 6
const INNER_WIDTH = BANNER_WIDTH - 6;

const BANNER_LINES: ReadonlyArray<string> = [
  `╔${HR}╗`,
  centred('⚠️  WARNING — THIS IS INSECURE  ⚠️'),
  `║${' '.repeat(BANNER_WIDTH - 2)}║`,
  wrap('This command stores your Wave password in plaintext at'),
  wrap('~/.config/waveapps-mcp/credentials.json (mode 0600).'),
  wrap('Anything running as your user — VS Code extensions, dotfile'),
  wrap('sync tools, malware, accidental git commits — can read it.'),
  `║${' '.repeat(BANNER_WIDTH - 2)}║`,
  wrap('If you ALSO store the TOTP secret, the file alone is enough'),
  wrap('to sign in as you. You have effectively turned 2FA off.'),
  `║${' '.repeat(BANNER_WIDTH - 2)}║`,
  wrap('Only enable this if you have weighed the trade-off:'),
  wrap('  • single-user dev machine'),
  wrap('  • full-disk encryption on'),
  wrap('  • no shared / synced home directory'),
  wrap('  • you accept that the password is now a higher-value target'),
  wrap('    than the rotating cookie it replaces'),
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
 * Prompt for email + password (+ optional TOTP secret) and store alongside the existing
 * waveapps cookie. Doesn't perform login — that happens automatically on the next 401.
 */
export async function runSavePassword(
  deps: RunSavePasswordDeps = {},
  options: RunSavePasswordOptions = {},
): Promise<number> {
  const log = (deps.console ?? console).log;
  const err = (deps.console ?? console).error;
  const io = deps.io ?? new Prompter();

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
      err('[waveapps-mcp] No credentials.json yet — run `npx waveapps-mcp paste` once first.');
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
    let totpSecret: string | undefined;
    if (twoFa === 'y' || twoFa === 'yes') {
      log('');
      log('  ⚠️  Storing the TOTP secret defeats 2FA. Continue only if intentional.');
      const secretRaw = sanitise(await io.askSecret('  TOTP base32 secret (input hidden): '));
      if (!secretRaw) {
        log('  No secret provided — skipping. 2FA refresh will fail on the next rotation.');
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

    patchCredentials({ email, password, totpSecret });
    log('');
    log(`[waveapps-mcp] Saved to ${credentialsPath()}.`);
    log('[waveapps-mcp] Auto-refresh on 401 is now enabled.');
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
