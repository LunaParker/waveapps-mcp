import { credentialsPath, deleteCredentials } from '../auth/credentials.js';

export interface RunLogoutDeps {
  console?: Pick<Console, 'log'>;
}

export function runLogout(deps: RunLogoutDeps = {}): number {
  const log = (deps.console ?? console).log;
  const removed = deleteCredentials();
  log(
    removed
      ? `[waveapps-mcp] Removed ${credentialsPath()}.`
      : `[waveapps-mcp] No credentials file at ${credentialsPath()}.`,
  );
  return 0;
}
