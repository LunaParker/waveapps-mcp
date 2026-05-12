import { credentialsAgeSeconds, credentialsPath, readCredentials } from '../auth/credentials.js';

export interface RunWhoamiDeps {
  console?: Pick<Console, 'log'>;
}

export function runWhoami(deps: RunWhoamiDeps = {}): number {
  const log = (deps.console ?? console).log;
  const creds = readCredentials();
  if (!creds) {
    log(`[waveapps-mcp] No credentials at ${credentialsPath()} — run \`npx waveapps-mcp login\`.`);
    return 1;
  }
  const age = credentialsAgeSeconds();
  const ageHuman = age == null ? 'unknown' : humaniseAge(age);
  log(`[waveapps-mcp] Credentials: ${credentialsPath()}`);
  log(`  authToken:  ${maskToken(creds.authToken)}`);
  log(`  csrfToken:  ${creds.csrfToken ? maskToken(creds.csrfToken) : '(none — mutations will fail)'}`);
  log(`  businessId: ${creds.businessId ?? '(none — pass to each tool)'}`);
  log(`  email:      ${creds.email ?? '(none)'}`);
  log(`  password:   ${creds.password ? '(stored — auto-refresh enabled)' : '(none — manual refresh only)'}`);
  log(`  totpSecret: ${creds.totpSecret ? `(stored, ${creds.totpSecret.length} chars — 2FA bypass enabled ⚠)` : '(none)'}`);
  log(`  updatedAt:  ${creds.updatedAt || '(unknown)'} (~${ageHuman} ago)`);
  return 0;
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
