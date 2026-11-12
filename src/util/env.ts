export function optionalEnv(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

/** An on/off variable: 1 or true turns it on, 0, false or unset leaves it off; anything else throws. */
export function booleanEnv(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env[name] ?? '').trim().toLowerCase();
  if (value === '1' || value === 'true') return true;
  if (value === '' || value === '0' || value === 'false') return false;
  throw new Error(`${name} must be 1, true, 0 or false, got: ${env[name]}`);
}
