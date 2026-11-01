import { createRequire } from 'node:module';

/** The two secrets automatic sign-in needs. Everything else lives in credentials.json. */
export type SecretName = 'password' | 'totp-secret';

export interface SecretStore {
  get(name: SecretName): string | null;
  set(name: SecretName, value: string): void;
  /** Returns true if an entry existed and was removed. */
  delete(name: SecretName): boolean;
}

/** Keychain service name (macOS), Credential Manager target prefix (Windows), Secret Service attribute (Linux). */
export const KEYRING_SERVICE = 'waveapps-mcp';

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}

/**
 * The OS credential store via @napi-rs/keyring. Loaded lazily so a platform without a
 * prebuilt binary can still run the server; only sign-in features fail.
 */
export function keyringSecretStore(): SecretStore {
  const require = createRequire(import.meta.url);
  const { Entry } = require('@napi-rs/keyring') as { Entry: new (service: string, account: string) => KeyringEntry };
  const entry = (name: SecretName): KeyringEntry => new Entry(KEYRING_SERVICE, name);
  return {
    get: (name) => entry(name).getPassword(),
    set: (name, value) => entry(name).setPassword(value),
    delete: (name) => entry(name).deletePassword(),
  };
}

/** In-memory store. The test setup installs one so no test ever touches the real Keychain. */
export function memorySecretStore(initial: Partial<Record<SecretName, string>> = {}): SecretStore {
  const values = new Map<SecretName, string>(Object.entries(initial) as Array<[SecretName, string]>);
  return {
    get: (name) => values.get(name) ?? null,
    set: (name, value) => void values.set(name, value),
    delete: (name) => values.delete(name),
  };
}

let active: SecretStore | undefined;

export function secretStore(): SecretStore {
  active ??= keyringSecretStore();
  return active;
}

/** Swap the process-wide store. Pass undefined to go back to the OS keyring on next use. */
export function setSecretStore(store: SecretStore | undefined): void {
  active = store;
}
