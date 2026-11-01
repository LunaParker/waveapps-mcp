import { migrateLegacySecrets } from '../auth/credentials.js';
import { runLogin } from './login.js';
import { runLogout } from './logout.js';
import { runPaste } from './paste.js';
import { runRefresh } from './refresh.js';
import { runSavePassword } from './save-password.js';
import { runWhoami } from './whoami.js';

export interface CliResult {
  /** Whether the argv was a CLI subcommand (vs. starting the MCP server). */
  handled: boolean;
  exitCode: number;
}

const HELP = `waveapps-mcp — Model Context Protocol server for Wave

Subcommands:
  login           Open a browser window on Wave's sign-in. You sign in (CAPTCHA, 2FA); the session is saved.
  refresh         Sign in headlessly with the stored email, password and TOTP secret, as the server does
                  when the session expires. Add --headed to watch it in a window.
  paste           Paste cookie values from a logged-in browser. Fallback if login can't open a browser.
  save-password   Store email (credentials.json) + password and optional TOTP secret (OS credential store)
                  so the server can sign back in on its own. Add -y / --yes to skip the disclaimer.
  logout          Remove the stored credentials file and the credential-store entries.
  whoami          Show metadata about the stored credentials (no secrets printed).
  help            Print this message.

With no subcommand, starts the MCP server (stdio by default, see WAVE_MCP_TRANSPORT).
`;

/**
 * Inspect argv and run a CLI subcommand if present. Returns { handled, exitCode }.
 * When `handled` is false, the caller should start the MCP server.
 */
export async function dispatchCli(
  argv: readonly string[],
  console_: Pick<Console, 'log' | 'error'> = console,
): Promise<CliResult> {
  const cmd = argv[0];
  if (cmd === undefined) return { handled: false, exitCode: 0 };
  if (cmd !== 'logout' && cmd !== 'help') moveLegacySecrets(console_);
  switch (cmd) {
    case 'login':
      return { handled: true, exitCode: await runLogin({ console: console_ }) };
    case 'paste':
      return { handled: true, exitCode: await runPaste({ console: console_ }) };
    case 'refresh':
      return {
        handled: true,
        exitCode: await runRefresh({ console: console_ }, { headed: argv.slice(1).includes('--headed') }),
      };
    case 'save-password': {
      const rest = argv.slice(1);
      const skipConfirmation = rest.includes('-y') || rest.includes('--yes');
      return {
        handled: true,
        exitCode: await runSavePassword({ console: console_ }, { skipConfirmation }),
      };
    }
    case 'save-password':
      return { handled: true, exitCode: await runSavePassword({ console: console_ }) };
    case 'logout':
      return { handled: true, exitCode: runLogout({ console: console_ }) };
    case 'whoami':
      return { handled: true, exitCode: runWhoami({ console: console_ }) };
    case 'help':
    case '--help':
    case '-h':
      console_.log(HELP);
      return { handled: true, exitCode: 0 };
    default:
      console_.error(`Unknown subcommand: ${cmd}\n\n${HELP}`);
      return { handled: true, exitCode: 64 };
  }
}

/** Older versions kept the password and TOTP secret in credentials.json; move them on first contact. */
function moveLegacySecrets(console_: Pick<Console, 'log' | 'error'>): void {
  try {
    const moved = migrateLegacySecrets();
    if (moved.length > 0) {
      console_.log(`[waveapps-mcp] Moved ${moved.join(' and ')} from credentials.json into the OS credential store.`);
    }
  } catch (err) {
    console_.error(`[waveapps-mcp] Could not move plaintext secrets into the OS credential store: ${(err as Error).message}`);
  }
}
