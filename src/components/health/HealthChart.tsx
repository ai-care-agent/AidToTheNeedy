import { useState } from 'react';
import type { HealthDay, HealthMetric, HealthThresholds } from '../../../shared/types';
import { HOUSEHOLD_TZ } from '../../lib/format';
import { fmtInt, fmtSleep, fmtTemp, METRIC } from '../../lib/health';

// Seven days of one metric: a single series in the validated hue of the week card, so there
// is no legend (the tab names it). Steps and sleep are columns from the baseline; pulse and
// pressure are ranges (lowest–highest, diastolic–systolic) with the average as a dot; SpO2 is
// dots. Reference lines are hairlines with their own label; days worth a look carry a glyph
// above the mark, never colour alone. Every value is reachable by tap and in the table.

const SERIES = 'var(--color-series)';
const PLOT_H = 144;

interface Point {
  day: HealthDay;
  lo: number | null;
  hi: number | null;
  dot: number | null;
  flag: boolean;
  text: string;
}

const dayName = (d: HealthDay, today: boolean) =>
  today ? 'dziś' : new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: HOUSEHOLD_TZ }).format(new Date(`${d.date}T12:00:00Z`));

function points(metric: HealthMetric, days: HealthDay[], t: HealthThresholds): Point[] {
  return days.map((day) => {
    switch (metric) {
      case 'steps':
        return { day, lo: 0, hi: day.steps, dot: null, flag: false, text: day.steps === null ? 'brak danych' : `${fmtInt(day.steps)} kroków${day.steps >= t.stepsGoal ? ' · cel osiągnięty' : ''}` };
      case 'sleep':
        return { day, lo: 0, hi: day.sleepMin, dot: null, flag: day.sleepMin !== null && day.sleepMin < 300, text: day.sleepMin === null ? 'brak danych' : `sen ${fmtSleep(day.sleepMin)}` };
      case 'heart_rate':
        return {
          day,
          lo: day.hrMin,
          hi: day.hrMax,
          dot: day.hrAvg,
          flag: day.hrMax !== null && day.hrMax > t.hrHigh,
          text: day.hrAvg === null ? 'brak danych' : `tętno średnio ${Math.round(day.hrAvg)} ud./min (od ${day.hrMin} do ${day.hrMax})`,
        };
      case 'blood_pressure': {
        const flag = day.bpSys !== null && (day.bpSys >= 140 || (day.bpDia ?? 0) >= 90);
        return {
          day,
          lo: day.bpDia,
          hi: day.bpSys,
          dot: null,
          flag,
          text: day.bpSys === null ? 'brak pomiaru' : `ciśnienie średnio ${Math.round(day.bpSys)}/${Math.round(day.bpDia ?? 0)} mmHg · pomiarów: ${day.bpReadings}${flag ? ' · podwyższone' : ''}`,
        };
      }
      case 'spo2':
        return { day, lo: null, hi: null, dot: day.spo2, flag: day.spo2 !== null && day.spo2 < 94, text: day.spo2 === null ? 'brak danych' : `saturacja ${day.spo2}%` };
      case 'temperature':
        return { day, lo: null, hi: null, dot: day.temp, flag: day.temp !== null && day.temp >= 37.5, text: day.temp === null ? 'brak pomiaru' : `temperatura najwyżej ${fmtTemp(day.temp)} °C` };
    }
  });
}

/** Lines drawn across the plot, each with the words that explain it. */
function references(metric: HealthMetric, t: HealthThresholds): { value: number; label: string }[] {
  switch (metric) {
    case 'steps':
      return [{ value: t.stepsGoal, label: `cel ${fmtInt(t.stepsGoal)}` }];
    case 'blood_pressure':
      return [
        { value: 140, label: '140' },
        { value: 90, label: '90' },
      ];
    case 'heart_rate':
      return [{ value: 100, label: '100' }];
    case 'spo2':
      return [{ value: 94, label: '94%' }];
    case 'temperature':
      return [
        { value: 37.5, label: '37,5' },
        { value: t.tempHigh, label: fmtTemp(t.tempHigh) },
      ];
    case 'sleep':
      return [{ value: 420, label: '7 godz.' }];
  }
}

function domain(metric: HealthMetric, pts: Point[], refs: { value: number }[]): [number, number] {
  const values = [...pts.flatMap((p) => [p.lo, p.hi, p.dot]), ...refs.map((r) => r.value)].filter((v): v is number => v !== null);
  const max = Math.max(...values);
  switch (metric) {
    case 'steps':
    case 'sleep':
      return [0, max * 1.12];
    case 'spo2':
      return [Math.min(88, ...values) - 1, 100];
    case 'temperature':
      return [Math.min(35.8, ...values) - 0.2, Math.max(38.6, ...values) + 0.2];
    default: {
      const min = Math.min(...values);
      const pad = (max - min) * 0.12 || 10;
      return [Math.max(0, min - pad), max + pad];
    }
  }
}

export function HealthChart({ metric, days, thresholds }: { metric: HealthMetric; days: HealthDay[]; thresholds: HealthThresholds }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const pts = points(metric, days, thresholds);
  const refs = references(metric, thresholds);
  const [d0, d1] = domain(metric, pts, refs);
  const y = (v: number) => ((v - d0) / (d1 - d0)) * PLOT_H;
  const active = hovered ?? picked;
  const last = pts.length - 1;
  const empty = pts.every((p) => p.hi === null && p.dot === null);
  const label = (i: number) => `${dayName(pts[i].day, i === last)} · ${pts[i].text}`;

  if (empty) return <p className="rounded-2xl bg-paper p-4 text-muted">Brak pomiarów w ostatnich 7 dniach.</p>;

  return (
    <div>
      {table ? (
        <table className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-1 font-semibold">Dzień</th>
              <th className="font-semibold">{METRIC[metric].name}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {pts.map((p, i) => (
              <tr key={p.day.date}>
                <td className="py-1.5 capitalize">{dayName(p.day, i === last)}</td>
                <td>
                  {p.flag && <span className="mr-1 font-bold text-warn">!</span>}
                  {p.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-1">
          <div className="relative" style={{ height: PLOT_H }} aria-hidden>
            {refs.map((r) => (
              <span key={r.value} className="absolute right-1 -translate-y-1/2 whitespace-nowrap text-xs font-semibold tabular-nums text-muted" style={{ bottom: y(r.value) }}>
                {r.label}
              </span>
            ))}
          </div>
          <div className="relative border-b border-line" style={{ height: PLOT_H }}>
            {refs.map((r) => (
              <span key={r.value} className="absolute inset-x-0 h-px bg-line" style={{ bottom: y(r.value) }} aria-hidden />
            ))}
            <div className="absolute inset-0 grid grid-cols-7">
              {pts.map((p, i) => {
                const dim = active !== null && active !== i;
                const partial = i === last && (metric === 'steps' || metric === 'sleep');
                const opacity = dim ? 0.35 : partial ? 0.55 : 1;
                const column = metric === 'steps' || metric === 'sleep';
                const top = p.hi ?? p.dot;
                return (
                  <button
                    key={p.day.date}
                    type="button"
                    aria-label={label(i)}
                    aria-pressed={picked === i}
                    onClick={() => setPicked(picked === i ? null : i)}
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(i)}
                    onBlur={() => setHovered(null)}
                    className={`relative h-full rounded-lg transition-colors ${picked === i ? 'bg-brand-soft/60' : 'hover:bg-paper'}`}
                  >
                    {p.hi !== null && p.lo !== null && (
                      <span
                        className={`absolute left-1/2 w-3.5 -translate-x-1/2 transition-opacity sm:w-4 ${column ? 'rounded-t-[4px]' : 'rounded-[4px]'}`}
                        style={{ bottom: y(p.lo), height: Math.max(4, y(p.hi) - y(p.lo)), background: SERIES, opacity }}
                      />
                    )}
                    {p.dot !== null && (
                      <span
                        className="absolute left-1/2 size-3 -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-surface transition-opacity"
                        style={{ bottom: y(p.dot), background: p.hi !== null ? 'var(--color-ink)' : SERIES, opacity: dim ? 0.35 : 1 }}
                      />
                    )}
                    {p.flag && top !== null && (
                      <span className="absolute left-1/2 grid size-5 -translate-x-1/2 place-items-center rounded-full bg-warn text-[11px] font-bold text-on-accent" style={{ bottom: y(top) + 6 }} aria-hidden>
                        !
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <span />
          <div className="mt-1 grid grid-cols-7 text-center">
            {pts.map((p, i) => (
              <span key={p.day.date} className={`text-sm font-semibold ${i === last ? 'text-ink' : 'text-muted'}`}>
                {i === last ? 'dziś' : p.day.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="min-h-5 flex-1 text-sm text-muted first-letter:uppercase" aria-live="polite">
          {table ? '' : active !== null ? label(active) : 'Dotknij dnia, aby zobaczyć szczegóły.'}
        </p>
        <button type="button" onClick={() => setTable(!table)} className="text-sm font-semibold text-brand underline-offset-2 hover:underline">
          {table ? 'Pokaż wykres' : 'Pokaż tabelę'}
        </button>
      </div>
    </div>
  );
}
