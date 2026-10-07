import type { HealthDay, HealthMetric, HealthThresholds, InsightDay } from '../../shared/types';
import { fmtInt, fmtSleep } from './health';

// The three rings of a day — Leki, Ruch, Sen — and the health monitor under them. Plain
// arithmetic over what the apps already know; nothing here is a medical score. Zones follow the
// usual thirds (green ≥ 67 %, yellow ≥ 34 %), and every ring also says its zone in words.

export type Zone = 'green' | 'yellow' | 'red' | 'progress' | 'none';

export const ZONE: Record<Zone, { color: string; word: string }> = {
  green: { color: 'var(--color-ok)', word: 'dobrze' },
  yellow: { color: 'var(--color-warn)', word: 'uwaga' },
  red: { color: 'var(--color-danger)', word: 'nisko' },
  progress: { color: 'var(--color-series)', word: 'w trakcie' },
  none: { color: 'var(--color-line)', word: 'brak danych' },
};

export interface Ring {
  key: 'meds' | 'move' | 'sleep';
  label: string;
  /** 0–100, or null when there is nothing to measure. */
  pct: number | null;
  value: string;
  sub: string;
  zone: Zone;
  /** For speech and screen readers. */
  spoken: string;
}

/** A sleep of 7.5 h counts as a full ring. */
export const SLEEP_NEED_MIN = 450;

const third = (pct: number): Zone => (pct >= 67 ? 'green' : pct >= 34 ? 'yellow' : 'red');

export function dayRings(doses: InsightDay | undefined, health: HealthDay | undefined, t: HealthThresholds, isToday: boolean): Ring[] {
  const slots = doses ? [doses.morning, doses.evening].filter((s) => s !== 'none') : [];
  const done = slots.filter((s) => s === 'done').length;
  const missed = slots.filter((s) => s === 'missed').length;
  const pending = slots.filter((s) => s === 'pending').length;
  const meds: Ring = slots.length
    ? {
        key: 'meds',
        label: 'Leki',
        pct: (done / slots.length) * 100,
        value: `${done}/${slots.length}`,
        sub: missed ? `pominięte: ${missed}` : pending ? `przed nią: ${pending}` : 'wszystkie',
        // A dose still ahead is not a failure: only missed ones colour the ring.
        zone: missed ? (missed === slots.length ? 'red' : 'yellow') : pending ? 'progress' : 'green',
        spoken: `Leki: ${done} z ${slots.length}${missed ? `, pominięte ${missed}` : ''}`,
      }
    : { key: 'meds', label: 'Leki', pct: null, value: '—', sub: 'brak dawek', zone: 'none', spoken: 'Leki: brak dawek' };

  const steps = health?.steps ?? null;
  const movePct = steps !== null ? Math.min(100, (steps / t.stepsGoal) * 100) : null;
  const move: Ring = {
    key: 'move',
    label: 'Ruch',
    pct: movePct,
    value: steps !== null ? fmtInt(steps) : '—',
    sub: steps === null ? 'brak danych' : steps >= t.stepsGoal ? 'cel osiągnięty' : `cel ${fmtInt(t.stepsGoal)}`,
    // The day isn't over: today's ring shows progress until the goal is reached.
    zone: movePct === null ? 'none' : isToday && movePct < 100 ? 'progress' : third(movePct),
    spoken: steps === null ? 'Ruch: brak danych' : `Ruch: ${steps} kroków z ${t.stepsGoal}`,
  };

  const sleepMin = health?.sleepMin ?? null;
  const sleepPct = sleepMin !== null ? Math.min(100, (sleepMin / SLEEP_NEED_MIN) * 100) : null;
  const sleep: Ring = {
    key: 'sleep',
    label: 'Sen',
    pct: sleepPct,
    value: sleepMin !== null ? fmtSleep(sleepMin, true) : '—',
    sub: sleepMin === null ? 'brak danych' : `${Math.round(sleepPct!)}% potrzeby`,
    zone: sleepPct === null ? 'none' : sleepPct >= 85 ? 'green' : sleepPct >= 67 ? 'yellow' : 'red',
    spoken: sleepMin === null ? 'Sen: brak danych' : `Sen: ${fmtSleep(sleepMin)}`,
  };

  return [meds, move, sleep];
}

// ------------------------------------------------------------------ health monitor

export interface MonitorRow {
  metric: HealthMetric;
  label: string;
  value: string;
  unit: string;
  /** Where the value sits, and the typical band, on a shared 0–1 scale for the bar. */
  at: number | null;
  band: [number, number];
  bandText: string;
  inRange: boolean | null;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Each metric against her own week (or a fixed guideline for blood pressure and SpO2): the
 * "is today like her usual?" view, which matters more for an older person than any absolute.
 */
export function monitorRows(days: HealthDay[], index: number, t: HealthThresholds): MonitorRow[] {
  const isToday = index === days.length - 1;
  const day = days[index];
  const others = days.filter((_, i) => i !== index);
  const usual = (pick: (d: HealthDay) => number | null, pad: number): [number, number] | null => {
    const v = others.map(pick).filter((x): x is number => x !== null);
    if (v.length < 3) return null;
    return [Math.min(...v) - pad, Math.max(...v) + pad];
  };

  const row = (metric: HealthMetric, label: string, value: number | null, text: string, unit: string, band: [number, number] | null, scale: [number, number], bandText: string): MonitorRow => {
    const [s0, s1] = scale;
    const norm = (v: number) => clamp01((v - s0) / (s1 - s0));
    return {
      metric,
      label,
      value: value === null ? '—' : text,
      unit,
      at: value === null ? null : norm(value),
      band: band ? [norm(band[0]), norm(band[1])] : [0, 0],
      bandText,
      inRange: value === null || !band ? null : value >= band[0] && value <= band[1],
    };
  };

  const hr = usual((d) => d.hrMin, 3);
  const sleep = usual((d) => d.sleepMin, 30);
  const steps = usual((d) => d.steps, 500);
  const fmtBand = (b: [number, number] | null, f: (v: number) => string) => (b ? `zwykle ${f(Math.max(0, b[0]))}–${f(b[1])}` : 'za mało danych');

  return [
    row('heart_rate', 'Tętno spoczynkowe', day.hrMin, String(day.hrMin), 'ud./min', hr, [40, 100], fmtBand(hr, (v) => String(Math.round(v)))),
    row('blood_pressure', 'Ciśnienie (skurczowe)', day.bpSys, day.bpSys !== null ? `${Math.round(day.bpSys)}/${Math.round(day.bpDia ?? 0)}` : '', 'mmHg', [100, 139], [90, 200], 'zalecane poniżej 140/90'),
    row('temperature', 'Temperatura', day.temp, day.temp !== null ? day.temp.toFixed(1).replace('.', ',') : '', '°C', [35.5, 37.4], [35, 40], 'typowo 35,5–37,4 °C'),
    row('spo2', 'Saturacja', day.spo2, `${day.spo2}`, '%', [94, 100], [85, 100], 'typowo 94–100%'),
    row('sleep', 'Sen', day.sleepMin, day.sleepMin !== null ? fmtSleep(day.sleepMin, true) : '', 'godz.', sleep, [180, 600], fmtBand(sleep, (v) => fmtSleep(v, true))),
    // Today's steps are still growing: never "poza normą" before the day is over.
    { ...row('steps', 'Kroki', day.steps, day.steps !== null ? fmtInt(day.steps) : '', '', steps, [0, Math.max(t.stepsGoal * 2, 8000)], fmtBand(steps, (v) => fmtInt(Math.round(v / 100) * 100))), ...(isToday ? { inRange: null } : {}) },
  ];
}
