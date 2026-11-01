import { credentialsAgeSeconds, credentialsPath, readCredentials } from '../auth/credentials.js';
import { secretStore, type SecretName, type SecretStore } from '../auth/secrets.js';
import { cliCommand } from '../util/cli-command.js';

export interface RunWhoamiDeps {
  console?: Pick<Console, 'log'>;
  store?: SecretStore;
}

export function runWhoami(deps: RunWhoamiDeps = {}): number {
  const log = (deps.console ?? console).log;
  const store = deps.store ?? secretStore();
  const creds = readCredentials();
  if (!creds) {
    log(`[waveapps-mcp] No credentials at ${credentialsPath()} — run \`${cliCommand('login')}\`.`);
    return 1;
  }
  const age = credentialsAgeSeconds();
  const ageHuman = age == null ? 'unknown' : humaniseAge(age);
  log(`[waveapps-mcp] Credentials: ${credentialsPath()}`);
  log(`  authToken:  ${maskToken(creds.authToken)}`);
  log(`  csrfToken:  ${creds.csrfToken ? maskToken(creds.csrfToken) : '(none — mutations will fail)'}`);
  log(`  businessId: ${creds.businessId ?? '(none — pass to each tool)'}`);
  log(`  email:      ${creds.email ?? '(none)'}`);
  const password = describeSecret(store, 'password');
  const totpSecret = describeSecret(store, 'totp-secret');
  const where = (name: SecretName): string => store.source?.(name) ?? 'in OS credential store';
  log(`  password:   ${password === 'stored' ? `(${where('password')} — auto sign-in enabled)` : password === 'missing' ? '(none — run `login` when the session expires)' : password}`);
  log(`  totpSecret: ${totpSecret === 'stored' ? `(${where('totp-secret')} — 2FA bypass enabled ⚠️)` : totpSecret === 'missing' ? '(none)' : totpSecret}`);
  log(`  updatedAt:  ${creds.updatedAt || '(unknown)'} (~${ageHuman} ago)`);
  return 0;
}

function describeSecret(store: SecretStore, name: SecretName): 'stored' | 'missing' | string {
  try {
    return store.get(name) ? 'stored' : 'missing';
  } catch (err) {
    const message = (err as Error).message;
    return store.readOnly ? `(${message})` : `(could not read the OS credential store: ${message})`;
  }
}

function maskToken(token: string): string {
  if (token.length <= 6) return `${token.length} chars`;
  return `${token.slice(0, 4)}…${token.slice(-2)} (${token.length} chars)`;
}

function humaniseAge(seconds: number): string {
  const abs = Math.max(0, seconds);
  if (abs < 60) return `${abs}s`;
  if (abs < 3600) return `${Math.floor(abs / 60)}m`;
  if (abs < 86_400) return `${Math.floor(abs / 3600)}h`;
  return `${Math.floor(abs / 86_400)}d`;
}
