import { useSyncExternalStore } from 'react';
import type { DisplaySettings, DisplayTheme, SunTimes } from '../../shared/types';
import { hourIn } from './format';

// "Ułatwienia": how this device shows and says things. Kept in the browser (it belongs to the
// phone in her hand, not to the household) and applied to <html> as attributes and the root
// font size, so every screen follows without knowing about it.

export type Theme = DisplayTheme;
export type A11ySettings = DisplaySettings;

export const TEXT_SIZES = [
  { scale: 100, label: 'A', name: 'normalny' },
  { scale: 115, label: 'A+', name: 'duży' },
  { scale: 130, label: 'A++', name: 'bardzo duży' },
  { scale: 150, label: 'A+++', name: 'ogromny' },
  { scale: 175, label: 'A++++', name: 'największy' },
] as const;

export const SPEECH_RATES = [
  { rate: 0.75, label: 'Wolniej' },
  { rate: 0.95, label: 'Normalnie' },
  { rate: 1.15, label: 'Szybciej' },
] as const;

/**
 * The first look on a new device. For real users it should be "Automatycznie" (paper by day, no
 * bright screen at night); the POC is shown at meetings in its dark look, so a build without
 * VITE_DEFAULT_THEME starts dark. `.env`: VITE_DEFAULT_THEME=auto | dark | light | contrast.
 */
const THEMES_ALLOWED: readonly Theme[] = ['auto', 'dark', 'light', 'contrast'];
const configured = import.meta.env.VITE_DEFAULT_THEME as string | undefined;
export const DEFAULT_THEME: Theme = THEMES_ALLOWED.includes(configured as Theme) ? (configured as Theme) : 'dark';

export const DEFAULTS: A11ySettings = { scale: 100, theme: DEFAULT_THEME, bold: false, reducedMotion: false, speechRate: 0.95, tapToRead: false, steadyTouch: false, flashAlerts: false };

/**
 * Mom's phone and the daughter's are different devices; in the presentation both apps share
 * one browser, so each app keeps its own settings (contrast on Mom's side stays there).
 */
const APP = typeof location === 'undefined' ? 'senior' : location.pathname.startsWith('/family') ? 'family' : 'senior';
const KEY = `care:a11y:${APP}`;
/** The text size switch that came before this panel kept its own key. */
const OLD_SIZE_KEY = 'care:text-size';

const THEME_COLOR: Record<ResolvedTheme, string> = { dark: '#07090b', light: '#f7f3ec', contrast: '#000000' };

/** What is actually on screen: "Automatycznie" is light or dark depending on the sun. */
export type ResolvedTheme = Exclude<Theme, 'auto'>;

// ------------------------------------------------------------------ "Automatycznie": follow the sun

let sun: SunTimes | null = null;
/** The demo can show the evening look at noon ("Zachód słońca — podgląd"). */
let preview: { theme: 'light' | 'dark'; until: number } | null = null;

/** Without the household's sun times (not loaded yet, or polar day/night): 7:00–19:00. */
const FALLBACK_DAY = { from: 7, to: 19 };

export function isDaylight(now = new Date()): boolean {
  if (sun?.sunrise && sun.sunset) return now.getTime() >= Date.parse(sun.sunrise) && now.getTime() < Date.parse(sun.sunset);
  const h = hourIn(now);
  return h >= FALLBACK_DAY.from && h < FALLBACK_DAY.to;
}

export function resolveTheme(theme: Theme, now = new Date()): ResolvedTheme {
  if (theme !== 'auto') return theme;
  if (preview && preview.until > now.getTime()) return preview.theme;
  return isDaylight(now) ? 'light' : 'dark';
}

/** The apps pass the household's sunrise and sunset with every state they load. */
export function setSunTimes(next: SunTimes): void {
  if (sun?.sunrise === next.sunrise && sun?.sunset === next.sunset) return;
  sun = next;
  apply(settings);
  notify();
}

export function getSunTimes(): SunTimes | null {
  return sun;
}

/** Shows the other half of the day for a couple of minutes (only affects "Automatycznie"). */
export function previewAutoTheme(theme: 'light' | 'dark' | null, minutes = 2): void {
  preview = theme ? { theme, until: Date.now() + minutes * 60_000 } : null;
  apply(settings);
  notify();
}

function load(): A11ySettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<A11ySettings> | null;
    if (saved) return { ...DEFAULTS, ...saved };
    const oldSize = APP === 'senior' ? Number(localStorage.getItem(OLD_SIZE_KEY)) : 0;
    return oldSize ? { ...DEFAULTS, scale: oldSize } : DEFAULTS;
  } catch {
    // Private mode or blocked storage: defaults for this visit.
    return DEFAULTS;
  }
}

let settings: A11ySettings = typeof window === 'undefined' ? DEFAULTS : load();
const listeners = new Set<() => void>();

function apply(s: A11ySettings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.fontSize = `${s.scale}%`;
  const theme = resolveTheme(s.theme);
  // Day turning into evening fades the colours over a second instead of flashing.
  if (root.dataset.theme && root.dataset.theme !== theme) {
    root.classList.add('theme-fade');
    window.setTimeout(() => root.classList.remove('theme-fade'), 1_200);
  }
  root.dataset.theme = theme;
  root.toggleAttribute('data-bold', s.bold);
  root.toggleAttribute('data-reduced-motion', s.reducedMotion);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolveTheme(s.theme)]);
}

apply(settings);

// Sunset (or the end of a preview) switches the colours by itself.
if (typeof window !== 'undefined') {
  let shown = resolveTheme(settings.theme);
  window.setInterval(() => {
    const now = resolveTheme(settings.theme);
    if (now === shown) return;
    shown = now;
    apply(settings);
    notify();
  }, 30_000);
}

// Ochrona przed drżeniem rąk: a hand that shakes taps twice; the second tap on anything within
// this window is swallowed before it reaches the button.
const STEADY_MS = 700;
let lastTap = 0;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (e) => {
      if (!settings.steadyTouch) return;
      const now = Date.now();
      if (now - lastTap < STEADY_MS) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      lastTap = now;
    },
    true,
  );
}

/** Błysk przy powiadomieniach: a bright frame around the screen and a buzz, with every chime. */
export function flashIfWanted(): void {
  if (!settings.flashAlerts || typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('flash-alert');
  // Restart the animation even if a flash is still running.
  void root.offsetWidth;
  root.classList.add('flash-alert');
  window.setTimeout(() => root.classList.remove('flash-alert'), 2_600);
  navigator.vibrate?.([200, 100, 200]);
}

export function getA11y(): A11ySettings {
  return settings;
}

export function setA11y(patch: Partial<A11ySettings>): void {
  settings = { ...settings, ...patch };
  apply(settings);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // The change still lasts for this visit.
  }
  notify();
}

function notify() {
  for (const l of listeners) l();
}

export function useA11y(): A11ySettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => settings,
    () => DEFAULTS,
  );
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The colours on screen right now (for "Automatycznie": light or dark by the sun). */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, () => resolveTheme(settings.theme), () => 'dark');
}

/** Today's sunrise and sunset at her home, once an app has loaded them. */
export function useSunTimes(): SunTimes | null {
  return useSyncExternalStore(subscribe, () => sun, () => null);
}

/** One step up or down the text sizes ("powiększ tekst"); returns the new size's name. */
export function stepTextSize(dir: 1 | -1): string {
  const i = TEXT_SIZES.findIndex((t) => t.scale === settings.scale);
  const next = TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))];
  setA11y({ scale: next.scale });
  return next.name;
}

export function stepSpeechRate(dir: 1 | -1): string {
  const i = SPEECH_RATES.findIndex((r) => r.rate === settings.speechRate);
  const next = SPEECH_RATES[Math.min(SPEECH_RATES.length - 1, Math.max(0, (i < 0 ? 1 : i) + dir))];
  setA11y({ speechRate: next.rate });
  return next.label.toLowerCase();
}

export const THEME_NAME: Record<Theme, string> = { auto: 'automatyczne (jasne w dzień, ciemne wieczorem)', dark: 'ciemny', light: 'jasny', contrast: 'wysoki kontrast' };

const FIELDS: (keyof A11ySettings)[] = ['scale', 'theme', 'bold', 'reducedMotion', 'speechRate', 'tapToRead', 'steadyTouch', 'flashAlerts'];

/** Settings saved by an older version lack the newer fields; they read as the defaults. */
export function withDefaults(s: Partial<A11ySettings>): A11ySettings {
  return { ...DEFAULTS, ...s };
}

export function sameSettings(a: A11ySettings, b: A11ySettings): boolean {
  const x = withDefaults(a);
  const y = withDefaults(b);
  return FIELDS.every((f) => x[f] === y[f]);
}

/** Plain words for what changed: "tekst: bardzo duży", "kolory: wysoki kontrast". */
export function describeChange(before: A11ySettings, after: A11ySettings): string[] {
  const out: string[] = [];
  const onOff = (v: boolean) => (v ? 'włączone' : 'wyłączone');
  if (before.scale !== after.scale) out.push(`tekst: ${TEXT_SIZES.find((t) => t.scale === after.scale)?.name ?? `${after.scale}%`}`);
  if (before.theme !== after.theme) out.push(`kolory: ${THEME_NAME[after.theme]}`);
  if (before.bold !== after.bold) out.push(`pogrubienie ${onOff(after.bold)}`);
  if (before.reducedMotion !== after.reducedMotion) out.push(`mniej ruchu ${onOff(after.reducedMotion)}`);
  if (before.speechRate !== after.speechRate) out.push(`głos: ${(SPEECH_RATES.find((r) => r.rate === after.speechRate)?.label ?? 'inne tempo').toLowerCase()}`);
  if (before.tapToRead !== after.tapToRead) out.push(`czytanie po dotknięciu ${onOff(after.tapToRead)}`);
  if (Boolean(before.steadyTouch) !== Boolean(after.steadyTouch)) out.push(`ochrona przed drżeniem rąk ${onOff(after.steadyTouch)}`);
  if (Boolean(before.flashAlerts) !== Boolean(after.flashAlerts)) out.push(`błysk przy powiadomieniach ${onOff(after.flashAlerts)}`);
  return out;
}

// ------------------------------------------------------------------ sync with the family (senior app)

const REV_KEY = 'care:a11y:senior:rev';

/** The last server revision this phone has taken in, so each remote change applies once. */
export function getSeenRev(): string | null {
  try {
    return localStorage.getItem(REV_KEY);
  } catch {
    return null;
  }
}

export function setSeenRev(rev: string | null): void {
  try {
    if (rev) localStorage.setItem(REV_KEY, rev);
  } catch {
    // Without storage a change may be announced again after a reload; nothing worse.
  }
}

const SETUP_KEY = 'care:a11y:senior:setup';

/** Whether "Dopasuj ekran" has been gone through (or skipped) on this phone. */
export function isSetupDone(): boolean {
  try {
    return localStorage.getItem(SETUP_KEY) === 'done';
  } catch {
    return true;
  }
}

export function markSetupDone(): void {
  try {
    localStorage.setItem(SETUP_KEY, 'done');
  } catch {
    // Asked again next time; harmless.
  }
}
