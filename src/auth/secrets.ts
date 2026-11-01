import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { log } from '../util/log.js';

/** The two secrets automatic sign-in needs. Everything else lives in credentials.json. */
export type SecretName = 'password' | 'totp-secret';

export interface SecretStore {
  get(name: SecretName): string | null;
  set(name: SecretName, value: string): void;
  /** Returns true if an entry existed and was removed. */
  delete(name: SecretName): boolean;
  /** True when `set` and `delete` always throw: the secrets live in files the user manages. */
  readonly readOnly?: boolean;
  /** Where `name` is kept, for messages, such as "in OS credential store" or "from WAVE_PASSWORD_FILE". */
  source?(name: SecretName): string;
}

/** Variables naming the files the read-only store reads each secret from. */
export const SECRET_FILE_VARS: Readonly<Record<SecretName, string>> = {
  'password': 'WAVE_PASSWORD_FILE',
  'totp-secret': 'WAVE_TOTP_SECRET_FILE',
};

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
    source: () => 'in OS credential store',
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

/**
 * Secrets in files the user manages (systemd credentials, Docker secrets, a 0600 file), for hosts
 * with no OS keychain. Read on every `get`, so a rotated file applies without a restart. Never writes.
 */
export function fileSecretStore(paths: Partial<Record<SecretName, string>>): SecretStore {
  const warned = new Set<string>();
  const refuse = (name: SecretName): never => {
    throw new Error(`The ${name} comes from ${SECRET_FILE_VARS[name]}; edit or remove that file instead.`);
  };
  return {
    readOnly: true,
    source: (name) => `from ${SECRET_FILE_VARS[name]}`,
    get(name) {
      const path = paths[name];
      if (!path) return null;
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch (err) {
        throw new Error(`Could not read ${SECRET_FILE_VARS[name]} (${path}): ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`);
      }
      if (process.platform !== 'win32' && !warned.has(path) && (statSync(path).mode & 0o077) !== 0) {
        warned.add(path);
        log.warn('secret file is readable by other users; chmod 600 it', { variable: SECRET_FILE_VARS[name], path });
      }
      const value = text.trim();
      return value.length > 0 ? value : null;
    },
    set: (name) => refuse(name),
    delete: (name) => refuse(name),
  };
}

/** The file store when WAVE_PASSWORD_FILE or WAVE_TOTP_SECRET_FILE is set, otherwise the OS credential store. */
export function secretStoreFromEnv(env: NodeJS.ProcessEnv = process.env, keyring: () => SecretStore = keyringSecretStore): SecretStore {
  const password = env[SECRET_FILE_VARS.password] || undefined;
  const totpSecret = env[SECRET_FILE_VARS['totp-secret']] || undefined;
  if (!password && !totpSecret) return keyring();
  return fileSecretStore({ password, 'totp-secret': totpSecret });
}

let active: SecretStore | undefined;

export function secretStore(): SecretStore {
  active ??= secretStoreFromEnv();
  return active;
}

/** Swap the process-wide store. Pass undefined to go back to the environment's default on next use. */
export function setSecretStore(store: SecretStore | undefined): void {
  active = store;
}
