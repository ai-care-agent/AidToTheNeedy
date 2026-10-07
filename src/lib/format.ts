// Times are always shown in the household's timezone, whatever the viewer's device uses.

export const HOUSEHOLD_TZ = 'Europe/Warsaw';

const cache = new Map<string, Intl.DateTimeFormat>();
function formatter(options: Intl.DateTimeFormatOptions, tz: string, locale = 'pl-PL') {
  const key = `${locale}|${tz}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: tz });
    cache.set(key, f);
  }
  return f;
}

const toDate = (value: string | Date) => (typeof value === 'string' ? new Date(value) : value);

/** YYYY-MM-DD in the household timezone. */
export function dayKey(value: string | Date, tz = HOUSEHOLD_TZ): string {
  return formatter({ year: 'numeric', month: '2-digit', day: '2-digit' }, tz, 'en-CA').format(toDate(value));
}

export function fmtTime(value: string | Date, tz = HOUSEHOLD_TZ): string {
  return formatter({ hour: '2-digit', minute: '2-digit' }, tz).format(toDate(value));
}

export function fmtLongDate(value: string | Date, tz = HOUSEHOLD_TZ): string {
  return formatter({ weekday: 'long', day: 'numeric', month: 'long' }, tz).format(toDate(value));
}

export function hourIn(value: string | Date, tz = HOUSEHOLD_TZ): number {
  return Number(formatter({ hour: '2-digit', hourCycle: 'h23' }, tz, 'en-GB').format(toDate(value)));
}

/** "dziś 14:05", "jutro 10:30", "wczoraj 18:20", "pt., 3 paź 13:00" */
export function fmtWhen(value: string, now: Date, tz = HOUSEHOLD_TZ): string {
  const diff = Math.round((Date.parse(dayKey(value, tz)) - Date.parse(dayKey(now, tz))) / 86_400_000);
  const time = fmtTime(value, tz);
  if (diff === 0) return `dziś ${time}`;
  if (diff === 1) return `jutro ${time}`;
  if (diff === -1) return `wczoraj ${time}`;
  return `${formatter({ weekday: 'short', day: 'numeric', month: 'short' }, tz).format(new Date(value))} ${time}`;
}

export function timeAgo(value: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(value)) / 60_000));
  if (minutes < 2) return 'przed chwilą';
  if (minutes < 60) return `${minutes} min temu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} godz. temu`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'wczoraj' : `${days} dni temu`;
}

export function greeting(now: Date, tz = HOUSEHOLD_TZ): string {
  const h = hourIn(now, tz);
  return h >= 18 || h < 4 ? 'Dobry wieczór' : 'Dzień dobry';
}

/** Phone numbers are unreadable when spoken digit by digit. */
export function spokenSender(sender: string): string {
  return /^[+\d\s()-]+$/.test(sender) ? 'nieznanego numeru' : sender;
}

export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}

/** "38,40 zł" (with a no-break space, so the currency never wraps onto its own line) */
export function fmtMoney(value: number): string {
  return `${value.toFixed(2).replace('.', ',')}\u00a0zł`;
}

/** "38 złotych 40 groszy" — speech engines read "zł" letter by letter. */
export function spokenMoney(value: number): string {
  const zl = Math.floor(value);
  const gr = Math.round((value - zl) * 100);
  const zloty = `${zl} ${plural(zl, 'złoty', 'złote', 'złotych')}`;
  return gr ? `${zloty} ${gr} ${plural(gr, 'grosz', 'grosze', 'groszy')}` : zloty;
}
