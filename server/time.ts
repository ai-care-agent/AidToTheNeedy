// Local-time helpers. The process TZ is pinned in env.ts, so Date's local getters
// return household time.

const WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const MONTHS_GENITIVE = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
];

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function hhmm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

/** Calendar-day arithmetic that keeps the wall-clock time across DST changes. */
export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

/** Parses "YYYY-MM-DDTHH:mm" (or with a space, optional seconds) as local time. */
export function parseLocalDateTime(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  // Reject overflow such as 2026-02-31 or 25:00.
  if (date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h) return null;
  return date;
}

/** Parses "YYYY-MM-DD" as local midnight. */
export function parseLocalDate(value: string): Date | null {
  return parseLocalDateTime(`${value.trim()}T00:00`);
}

export function withTime(day: Date, time: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const r = startOfDay(day);
  r.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return r;
}

/** "poniedziałek, 28 września 2026" */
export function polishDate(d: Date, withYear = true): string {
  const base = `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`;
  return withYear ? `${base} ${d.getFullYear()}` : base;
}

/** Human description relative to `now`: "dziś o 20:00", "jutro o 10:30", "czwartek 1 października o 09:00". */
export function relativeWhen(d: Date, now: Date): string {
  const diffDays = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);
  const time = hhmm(d);
  if (diffDays === 0) return `dziś o ${time}`;
  if (diffDays === 1) return `jutro o ${time}`;
  if (diffDays === -1) return `wczoraj o ${time}`;
  return `${polishDate(d, false)} o ${time}`;
}

export function relativeDay(key: string, now: Date): string {
  const d = parseLocalDate(key);
  if (!d) return key;
  const diffDays = Math.round((d.getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (diffDays === 0) return 'dziś';
  if (diffDays === 1) return 'jutro';
  return polishDate(d, false);
}

const WEEKDAYS_SHORT = ['nd.', 'pn.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];

/** "wt. 29.09" — for text that is stored and read later, where "jutro" would go stale. */
export function shortDate(d: Date): string {
  return `${WEEKDAYS_SHORT[d.getDay()]} ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;
}

/** "dziś", "jutro", "wczoraj" or "wtorek, 29 września", relative to `now`. */
export function dayLabel(d: Date, now: Date): string {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (diff === 0) return 'dziś';
  if (diff === 1) return 'jutro';
  if (diff === -1) return 'wczoraj';
  return polishDate(d, false);
}
