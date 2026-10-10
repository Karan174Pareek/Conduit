import { describe, it, expect } from 'vitest';
import { computeDatePresetRange } from '../src/dates.js';

describe('computeDatePresetRange', () => {
  it('computes today range in Asia/Kolkata correctly', () => {
    // 2026-10-10 12:00:00 UTC = 2026-10-10 17:30:00 IST
    const fixedDate = new Date('2026-10-10T12:00:00Z');
    const range = computeDatePresetRange('today', 'Asia/Kolkata', fixedDate);

    expect(range.after).toBe('2026-10-10T00:00:00');
    expect(range.before).toBe('2026-10-10T23:59:59');
  });

  it('computes yesterday range in Asia/Kolkata correctly', () => {
    const fixedDate = new Date('2026-10-10T12:00:00Z');
    const range = computeDatePresetRange('yesterday', 'Asia/Kolkata', fixedDate);

    expect(range.after).toBe('2026-10-09T00:00:00');
    expect(range.before).toBe('2026-10-09T23:59:59');
  });

  it('computes last_7_days range in Asia/Kolkata correctly', () => {
    const fixedDate = new Date('2026-10-10T12:00:00Z');
    const range = computeDatePresetRange('last_7_days', 'Asia/Kolkata', fixedDate);

    expect(range.after).toBe('2026-10-03T00:00:00');
    expect(range.before).toBe('2026-10-10T23:59:59');
  });

  it('correctly handles day boundary transitions across timezones', () => {
    // 2026-10-10 20:00:00 UTC is already 2026-10-11 01:30:00 in Asia/Kolkata
    const fixedDate = new Date('2026-10-10T20:00:00Z');
    const range = computeDatePresetRange('today', 'Asia/Kolkata', fixedDate);

    expect(range.after).toBe('2026-10-11T00:00:00');
    expect(range.before).toBe('2026-10-11T23:59:59');
  });
});
