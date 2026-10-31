import { credentialsPath, deleteCredentials } from '../auth/credentials.js';
import { secretStore, type SecretName, type SecretStore } from '../auth/secrets.js';

export interface RunLogoutDeps {
  console?: Pick<Console, 'log'>;
  store?: SecretStore;
}

/** Remove credentials.json and the password / TOTP secret from the OS credential store. */
export function runLogout(deps: RunLogoutDeps = {}): number {
  const log = (deps.console ?? console).log;
  const store = deps.store ?? secretStore();
  const removed = deleteCredentials();
  log(
    removed
      ? `[waveapps-mcp] Removed ${credentialsPath()}.`
      : `[waveapps-mcp] No credentials file at ${credentialsPath()}.`,
  );
  const cleared: SecretName[] = [];
  for (const name of ['password', 'totp-secret'] as const) {
    try {
      if (store.delete(name)) cleared.push(name);
    } catch (err) {
      log(`[waveapps-mcp] Could not remove ${name} from the OS credential store: ${(err as Error).message}`);
      return 1;
    }
  }
  if (cleared.length > 0) log(`[waveapps-mcp] Removed ${cleared.join(' and ')} from the OS credential store.`);
  return 0;
}
