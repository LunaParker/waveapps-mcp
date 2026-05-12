import { createInterface } from 'node:readline/promises';
import { credentialsPath, patchCredentials } from '../auth/credentials.js';
import { isUuid } from '../client/ids.js';

export interface RunPasteDeps {
  /** Prompt for one line of input. Defaults to a `readline/promises` interface on stdin/stdout. */
  ask?: (question: string) => Promise<string>;
  console?: Pick<Console, 'log' | 'error'>;
}

const PASTE_EXIT_OK = 0;
const PASTE_EXIT_NO_TOKEN = 1;

export { PASTE_EXIT_OK, PASTE_EXIT_NO_TOKEN };

const HELP_HEADER = `[waveapps-mcp] Paste credentials from a logged-in Wave session.

  1. Open https://next.waveapps.com in any browser and sign in.
  2. Open DevTools → Application → Cookies → next.waveapps.com.
  3. Copy the values below when prompted (trailing whitespace + surrounding quotes are stripped).
`;

/**
 * Prompt the user for cookie values and persist them. Always-works fallback for environments
 * where Google's OAuth blocks the puppeteer flow.
 */
export async function runPaste(deps: RunPasteDeps = {}): Promise<number> {
  const log = (deps.console ?? console).log;
  const err = (deps.console ?? console).error;
  const ask = deps.ask ?? defaultAsk();

  log(HELP_HEADER);

  const authToken = sanitise(await ask('  `waveapps` cookie value: '));
  if (!authToken) {
    err('[waveapps-mcp] No token provided. Aborting.');
    return PASTE_EXIT_NO_TOKEN;
  }

  const csrfRaw = sanitise(await ask('  `identity-csrftoken` cookie value (blank to skip — mutations will fail without it): '));
  const csrfToken = csrfRaw.length > 0 ? csrfRaw : undefined;

  const bizRaw = sanitise(
    await ask(
      '  Business UUID (optional — copy from the URL after login, e.g. c2cb3afe-...): ',
    ),
  );
  let businessId: string | undefined;
  if (bizRaw.length > 0) {
    if (isUuid(bizRaw)) {
      businessId = bizRaw;
    } else {
      err(`[waveapps-mcp] "${bizRaw}" is not a valid UUID — saving without a default business.`);
    }
  }

  patchCredentials({ authToken, csrfToken, businessId });
  log('');
  log(`[waveapps-mcp] Saved to ${credentialsPath()}.`);
  if (businessId) log(`[waveapps-mcp] Default business: ${businessId}`);
  if (!csrfToken) log('[waveapps-mcp] No CSRF token saved — read tools work; mutating tools will throw. Re-run paste to add it.');
  return PASTE_EXIT_OK;
}

/** Strip whitespace and a single pair of surrounding single/double quotes (common when copying from JSON or DevTools). */
export function sanitise(raw: string): string {
  let v = raw.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      v = v.slice(1, -1).trim();
    }
  }
  return v;
}

function defaultAsk(): (question: string) => Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Resource is released when stdin closes; for a one-shot CLI that's at process exit.
  return async (q: string) => {
    const answer = await rl.question(q);
    return answer;
  };
}
