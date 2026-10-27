/**
 * Time model.
 *
 * Every recorded fact stores:
 *   occurred_at         absolute instant, UTC ISO-8601 with Z
 *   occurred_offset_min the local UTC offset in minutes at that instant
 *   occurred_tz         IANA zone name (kept for future re-interpretation)
 *   occurred_local_date the YYYY-MM-DD the caregiver experienced
 *
 * Deriving occurred_local_date at write time makes day/week/month grouping
 * deterministic and immune to the device later moving timezone.
 */
export interface LocalStamp {
  occurred_at: string;
  occurred_offset_min: number;
  occurred_tz: string;
  occurred_local_date: string;
}

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Offset in minutes east of UTC for `date` in `tz` (e.g. +480 for Asia/Shanghai). */
export function offsetMinutesFor(date: Date, tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts: Record<string, string> = {};
    for (const p of dtf.formatToParts(date)) {
      if (p.type !== 'literal') parts[p.type] = p.value;
    }
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) === 24 ? 0 : Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return Math.round((asUtc - date.getTime()) / 60000);
  } catch {
    return -date.getTimezoneOffset();
  }
}

export function localDateFrom(instantMs: number, offsetMin: number): string {
  return new Date(instantMs + offsetMin * 60000).toISOString().slice(0, 10);
}

export function localTimeFrom(instantMs: number, offsetMin: number): string {
  return new Date(instantMs + offsetMin * 60000).toISOString().slice(11, 16);
}

export function stampFor(date: Date, tz: string): LocalStamp {
  const offset = offsetMinutesFor(date, tz);
  return {
    occurred_at: date.toISOString(),
    occurred_offset_min: offset,
    occurred_tz: tz,
    occurred_local_date: localDateFrom(date.getTime(), offset),
  };
}

/** Builds an instant from a local wall-clock date+time in `tz`. */
export function instantFromLocal(localDate: string, localTime: string, tz: string): Date {
  const [y, m, d] = localDate.split('-').map(Number);
  const [hh, mm] = localTime.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Two passes handle DST transitions correctly.
  let guess = new Date(naive - offsetMinutesFor(new Date(naive), tz) * 60000);
  guess = new Date(naive - offsetMinutesFor(guess, tz) * 60000);
  return guess;
}

export function shiftLocalDate(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetweenLocalDates(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** Whole months completed between two YYYY-MM-DD dates; null if either is missing. */
export function ageInMonths(birthDate: string | null, onDate: string): number | null {
  if (!birthDate) return null;
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [oy, om, od] = onDate.split('-').map(Number);
  if (!by || !oy) return null;
  let months = (oy - by) * 12 + (om - bm);
  if (od < bd) months -= 1;
  return months < 0 ? null : months;
}

export function ageInDays(birthDate: string | null, onDate: string): number | null {
  if (!birthDate) return null;
  const d = daysBetweenLocalDates(birthDate, onDate);
  return d < 0 ? null : d;
}

export function formatLocalDate(localDate: string): string {
  const [, m, d] = localDate.split('-');
  return `${Number(m)}月${Number(d)}日`;
}
