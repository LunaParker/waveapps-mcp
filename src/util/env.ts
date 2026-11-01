export function optionalEnv(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}
