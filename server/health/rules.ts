import type { HealthDay, HealthLevel, HealthMetric, HealthThresholds, Insight } from '../../shared/types';

// Plain, explainable rules over the readings. The app is not a medical device: levels only
// decide whether she is asked to measure again and whether the family is told. Labels say
// "podwyższone", never a diagnosis.

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  hrHigh: 120,
  hrLow: 40,
  sysHigh: 180,
  diaHigh: 110,
  sysLow: 90,
  spo2Low: 90,
  tempHigh: 38,
  stepsGoal: 4000,
};

/** Pulse above this (but below hrHigh) is labelled "szybszy niż zwykle". */
const HR_WATCH = 100;
/** The usual "measure it with the doctor" line for home readings. */
const SYS_WATCH = 140;
const DIA_WATCH = 90;
const SPO2_WATCH = 94;
const TEMP_WATCH = 37.5;

export function classify(metric: HealthMetric, value: number, value2: number | null, t: HealthThresholds): { level: HealthLevel; label: string } {
  switch (metric) {
    case 'blood_pressure': {
      const dia = value2 ?? 0;
      if (value >= t.sysHigh || dia >= t.diaHigh) return { level: 'alert', label: 'bardzo wysokie' };
      if (value < t.sysLow) return { level: 'alert', label: 'niskie' };
      if (value >= SYS_WATCH || dia >= DIA_WATCH) return { level: 'watch', label: 'podwyższone' };
      return { level: 'normal', label: 'w typowym zakresie' };
    }
    case 'heart_rate':
      if (value > t.hrHigh) return { level: 'alert', label: 'bardzo szybki' };
      if (value < t.hrLow) return { level: 'alert', label: 'bardzo wolny' };
      if (value > HR_WATCH) return { level: 'watch', label: 'szybszy niż zwykle' };
      return { level: 'normal', label: 'spokojny' };
    case 'temperature':
      // Older people often run a fever lower than the textbook 38 °C: 37.5 is already worth a look.
      if (value >= t.tempHigh) return { level: 'alert', label: 'gorączka' };
      if (value < 35) return { level: 'alert', label: 'bardzo niska' };
      if (value >= TEMP_WATCH) return { level: 'watch', label: 'stan podgorączkowy' };
      return { level: 'normal', label: 'w normie' };
    case 'spo2':
      if (value < t.spo2Low) return { level: 'alert', label: 'niskie' };
      if (value < SPO2_WATCH) return { level: 'watch', label: 'nieco niższe' };
      return { level: 'normal', label: 'dobre' };
    case 'steps':
      return value >= t.stepsGoal ? { level: 'normal', label: 'cel osiągnięty' } : { level: 'normal', label: `cel: ${fmtInt(t.stepsGoal)}` };
    case 'sleep':
      return value < 360 ? { level: 'watch', label: 'krótki sen' } : { level: 'normal', label: 'przespana noc' };
  }
}

/** "4 520" — grouped the Polish way, with a no-break space. */
export function fmtInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** "37,8 °C" */
export function fmtTemp(celsius: number): string {
  return `${celsius.toFixed(1).replace('.', ',')}\u00a0°C`;
}

/** "7 godz. 10 min" */
export function fmtSleep(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} godz. ${m} min` : `${h} godz.`;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

/**
 * Observations over the last week (days oldest first, today last and still incomplete).
 * `bpHighReadings` counts the week's single readings at or above 140/90.
 */
export function healthInsights(days: HealthDay[], t: HealthThresholds, opts: { bpHighReadings: number; bpReadings: number; nextVisit: string | null }): Insight[] {
  const watch: Insight[] = [];
  const good: Insight[] = [];
  const past = days.slice(0, -1);

  const yesterday = past.at(-1);
  const usualSteps = median(past.slice(0, -1).map((d) => d.steps).filter((s): s is number => s !== null));
  if (yesterday?.steps != null && usualSteps >= 1500 && yesterday.steps < usualSteps * 0.5) {
    watch.push({ tone: 'watch', text: `Wczoraj mniej ruchu niż zwykle: ${fmtInt(yesterday.steps)} kroków, zwykle około ${fmtInt(Math.round(usualSteps / 100) * 100)}.` });
  }
  const weekSteps = past.map((d) => d.steps).filter((s): s is number => s !== null);
  if (weekSteps.length >= 5 && weekSteps.filter((s) => s >= t.stepsGoal).length >= 5) {
    good.push({ tone: 'good', text: `Cel ${fmtInt(t.stepsGoal)} kroków osiągnięty w ${weekSteps.filter((s) => s >= t.stepsGoal).length} z ${weekSteps.length} dni.` });
  }

  if (opts.bpReadings >= 3 && opts.bpHighReadings >= 3) {
    const visit = opts.nextVisit ? ` Najbliższa wizyta: ${opts.nextVisit} — warto zabrać wyniki.` : ' Warto pokazać wyniki lekarzowi.';
    watch.push({ tone: 'watch', text: `Ciśnienie: ${opts.bpHighReadings} z ${opts.bpReadings} pomiarów w tym tygodniu powyżej 140/90.${visit}` });
  } else if (opts.bpReadings >= 5 && opts.bpHighReadings === 0) {
    good.push({ tone: 'good', text: 'Ciśnienie w tym tygodniu w typowym zakresie.' });
  }

  // Today's sleep is last night, already complete once she is up, so it counts here.
  const nights = days.map((d) => d.sleepMin).filter((m): m is number => m !== null);
  const recentNights = nights.slice(-2);
  const earlierNights = nights.slice(0, -2);
  if (recentNights.length === 2 && earlierNights.length >= 3 && avg(recentNights) < 360 && avg(earlierNights) - avg(recentNights) >= 60) {
    watch.push({ tone: 'watch', text: `Dwie ostatnie noce krótszy sen: średnio ${fmtSleep(avg(recentNights))}, wcześniej ${fmtSleep(avg(earlierNights))}.` });
  }

  const warm = days.slice(-3).filter((d) => d.temp !== null && d.temp >= TEMP_WATCH);
  if (warm.length) {
    const top = Math.max(...warm.map((d) => d.temp!));
    watch.push({ tone: 'watch', text: `Podwyższona temperatura w ostatnich dniach (do ${fmtTemp(top)}). Jeśli się utrzymuje albo są inne objawy — warto porozmawiać z lekarzem.` });
  }

  const resting = past.map((d) => d.hrMin).filter((v): v is number => v !== null);
  if (resting.length >= 5) {
    const spread = Math.max(...resting) - Math.min(...resting);
    if (spread <= 12) good.push({ tone: 'good', text: `Tętno spoczynkowe stabilne: ${Math.min(...resting)}–${Math.max(...resting)} uderzeń na minutę.` });
  }
  return [...watch, ...good];
}
