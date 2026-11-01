/** The local calendar day as YYYY-MM-DD. `toISOString()` would give the UTC day, which is already tomorrow for an evening in the Americas. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Add days to a YYYY-MM-DD string. Arithmetic runs in UTC so no zone or DST change can shift the day. */
export function addDays(isoDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`Expected a YYYY-MM-DD date, got: ${isoDate}`);
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
