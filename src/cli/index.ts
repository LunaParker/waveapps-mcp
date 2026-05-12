import { runLogin } from './login.js';
import { runLogout } from './logout.js';
import { runPaste } from './paste.js';
import { runSavePassword } from './save-password.js';
import { runWhoami } from './whoami.js';

export interface CliResult {
  /** Whether the argv was a CLI subcommand (vs. starting the MCP server). */
  handled: boolean;
  exitCode: number;
}

const HELP = `waveapps-mcp — Model Context Protocol server for Wave

Subcommands:
  login           Drive Brave/Chrome through Wave login (puppeteer-extra + stealth). May trip Google's OAuth check.
  paste           Paste cookie values from a logged-in browser. Always works; recommended fallback for login.
  save-password   Store email + password (+ optional TOTP secret) so the server can auto-refresh on 401.
                  Add -y / --yes to skip the interactive disclaimer (scripted setup only).
  logout          Remove the stored credentials file.
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
  switch (cmd) {
    case 'login':
      return { handled: true, exitCode: await runLogin({ console: console_ }) };
    case 'paste':
      return { handled: true, exitCode: await runPaste({ console: console_ }) };
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
