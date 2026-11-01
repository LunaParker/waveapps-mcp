/** Trim and drop one pair of surrounding quotes, which copies from DevTools or JSON often carry. */
export function sanitise(raw: string): string {
  let v = raw.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) v = v.slice(1, -1).trim();
  }
  return v;
}
