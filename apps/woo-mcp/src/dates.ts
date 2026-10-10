export type DatePreset = 'today' | 'yesterday' | 'last_7_days';

export interface DateRange {
  after: string;
  before?: string;
}

/**
 * Extracts the calendar year, month, and day for a given Date in a specific IANA timeZone.
 */
function getZonedYearMonthDay(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  let year = 1970;
  let month = 1;
  let day = 1;
  for (const part of parts) {
    if (part.type === 'year') year = parseInt(part.value, 10);
    if (part.type === 'month') month = parseInt(part.value, 10);
    if (part.type === 'day') day = parseInt(part.value, 10);
  }
  return { year, month, day };
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Computes ISO date bounds for today, yesterday, or last_7_days in the given timezone.
 * Returns ISO strings formatted as YYYY-MM-DDTHH:mm:ss for WooCommerce after/before parameters.
 */
export function computeDatePresetRange(
  preset: DatePreset,
  timeZone = 'Asia/Kolkata',
  now = new Date(),
): DateRange {
  const current = getZonedYearMonthDay(now, timeZone);
  // Construct a UTC anchor representing local noon to avoid DST edge jumps
  const anchor = new Date(Date.UTC(current.year, current.month - 1, current.day, 12, 0, 0));

  if (preset === 'today') {
    const after = `${current.year}-${pad(current.month)}-${pad(current.day)}T00:00:00`;
    const before = `${current.year}-${pad(current.month)}-${pad(current.day)}T23:59:59`;
    return { after, before };
  }

  if (preset === 'yesterday') {
    const prevAnchor = new Date(anchor.getTime() - 24 * 60 * 60 * 1000);
    const prev = getZonedYearMonthDay(prevAnchor, timeZone);
    const after = `${prev.year}-${pad(prev.month)}-${pad(prev.day)}T00:00:00`;
    const before = `${prev.year}-${pad(prev.month)}-${pad(prev.day)}T23:59:59`;
    return { after, before };
  }

  if (preset === 'last_7_days') {
    const startAnchor = new Date(anchor.getTime() - 7 * 24 * 60 * 60 * 1000);
    const start = getZonedYearMonthDay(startAnchor, timeZone);
    const after = `${start.year}-${pad(start.month)}-${pad(start.day)}T00:00:00`;
    const before = `${current.year}-${pad(current.month)}-${pad(current.day)}T23:59:59`;
    return { after, before };
  }

  throw new Error(`Unsupported date preset: ${preset}`);
}
