import { describe, expect, it } from 'vitest';
import { addDays, todayIso } from './dates.js';

describe('todayIso', () => {
  it('formats the local calendar day, not the UTC one', () => {
    // Built from local components, so the expected day holds in every zone the suite runs in.
    expect(todayIso(new Date(2026, 0, 31, 23, 30, 0))).toBe('2026-01-31');
    expect(todayIso(new Date(2026, 11, 1, 0, 0, 1))).toBe('2026-12-01');
    expect(todayIso(new Date(2026, 6, 4, 12, 0, 0))).toBe('2026-07-04');
  });

  it('defaults to now', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('addDays', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-01-31', 15)).toBe('2026-02-15');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-02-28', 0)).toBe('2026-02-28');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(() => addDays('31/01/2026', 1)).toThrow(/YYYY-MM-DD/);
  });
});
