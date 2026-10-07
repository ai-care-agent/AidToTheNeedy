import { CircleCheck, Frown, Meh, ShieldCheck, Smile, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { DoseStatus, Insight, InsightDay, Mood, WeeklyInsights } from '../../../shared/types';
import { HOUSEHOLD_TZ } from '../../lib/format';

// Seven days at a glance. Dose cells use the fixed status palette and always carry an icon
// (never colour alone); contact counts are one series in one validated hue. Every value is
// also reachable without hovering, through the table view.

const SERIES = 'var(--color-series)';
const SERIES_TRACK = 'var(--color-series-track)';

const DOSE: Record<DoseStatus, { bg: string; fg: string; glyph: string; text: string }> = {
  done: { bg: 'var(--color-ok)', fg: 'var(--color-on-accent)', glyph: '✓', text: 'przyjęte' },
  missed: { bg: 'var(--color-danger)', fg: 'var(--color-on-accent)', glyph: '✗', text: 'pominięte' },
  pending: { bg: 'var(--color-raised)', fg: 'var(--color-muted)', glyph: '◷', text: 'jeszcze przed nią' },
  none: { bg: 'transparent', fg: 'var(--color-muted)', glyph: '–', text: 'brak dawki' },
};

const MOOD: Record<Mood, { icon: LucideIcon; color: string; text: string }> = {
  good: { icon: Smile, color: 'text-ok', text: 'dobre' },
  ok: { icon: Meh, color: 'text-deep-sun', text: 'takie sobie' },
  bad: { icon: Frown, color: 'text-danger', text: 'złe' },
};

const INSIGHT_ICON: Record<'watch' | 'info' | 'good', { icon: LucideIcon; color: string }> = {
  watch: { icon: TriangleAlert, color: 'text-warn' },
  info: { icon: ShieldCheck, color: 'text-brand' },
  good: { icon: CircleCheck, color: 'text-ok' },
};

const dayName = (d: InsightDay, isToday: boolean) =>
  isToday
    ? 'Dziś'
    : new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: HOUSEHOLD_TZ }).format(new Date(`${d.date}T12:00:00Z`));

export function WeekCard({ insights }: { insights: WeeklyInsights }) {
  const [readout, setReadout] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const { days } = insights;
  const max = Math.max(1, ...days.map((d) => d.interactions));
  const counts = days.slice(0, -1).map((d) => d.interactions);
  const extremes = new Set([Math.max(...counts), Math.min(...counts)]);
  const share = insights.dosesPlanned ? insights.dosesTaken / insights.dosesPlanned : 0;

  const hover = (text: string) => ({
    onMouseEnter: () => setReadout(text),
    onMouseLeave: () => setReadout(null),
    onFocus: () => setReadout(text),
    onBlur: () => setReadout(null),
  });

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <p className="text-3xl font-bold">
          {insights.dosesTaken} z {insights.dosesPlanned}
        </p>
        <p className="text-muted">dawek leków przyjętych</p>
      </div>
      <div className="mt-2 h-2 rounded-full" style={{ background: SERIES_TRACK }} role="meter" aria-valuemin={0} aria-valuemax={insights.dosesPlanned} aria-valuenow={insights.dosesTaken} aria-label="Przyjęte dawki leków">
        <div className="h-2 rounded-full" style={{ width: `${Math.round(share * 100)}%`, background: SERIES }} />
      </div>

      {table ? (
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-1 font-semibold">Dzień</th>
              <th className="font-semibold">Rano</th>
              <th className="font-semibold">Wieczór</th>
              <th className="font-semibold">Nastrój</th>
              <th className="text-right font-semibold">Kontakt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {days.map((d, i) => (
              <tr key={d.date}>
                <td className="py-1.5 capitalize">{dayName(d, i === days.length - 1)}</td>
                <td>{DOSE[d.morning].text}</td>
                <td>{DOSE[d.evening].text}</td>
                <td>{d.mood ? MOOD[d.mood].text : '—'}</td>
                <td className="text-right tabular-nums">{d.interactions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="mt-4 grid grid-cols-[4.25rem_repeat(7,minmax(0,1fr))] items-center gap-y-1.5 text-center">
          <span />
          {days.map((d, i) => (
            <span key={d.date} className={`text-sm font-semibold ${i === days.length - 1 ? 'text-ink' : 'text-muted'}`}>
              {i === days.length - 1 ? 'dziś' : d.label}
            </span>
          ))}

          {(['morning', 'evening'] as const).map((slot) => (
            <Row key={slot} label={slot === 'morning' ? 'Rano' : 'Wieczór'}>
              {days.map((d, i) => {
                const s = DOSE[d[slot]];
                const text = `${dayName(d, i === days.length - 1)} · leki ${slot === 'morning' ? 'poranne' : 'wieczorne'}: ${s.text}`;
                return (
                  <button key={d.date} type="button" aria-label={text} {...hover(text)} className="mx-auto grid size-8 place-items-center rounded-lg outline-offset-1">
                    <span className="grid size-6 place-items-center rounded-md text-sm font-bold" style={{ background: s.bg, color: s.fg }}>
                      {s.glyph}
                    </span>
                  </button>
                );
              })}
            </Row>
          ))}

          <Row label="Nastrój">
            {days.map((d, i) => {
              const text = `${dayName(d, i === days.length - 1)} · samopoczucie: ${d.mood ? MOOD[d.mood].text : 'brak odpowiedzi'}`;
              return (
                <button key={d.date} type="button" aria-label={text} {...hover(text)} className="mx-auto grid size-8 place-items-center rounded-lg text-lg">
                  {d.mood ? <MoodIcon mood={d.mood} /> : <span className="text-line">–</span>}
                </button>
              );
            })}
          </Row>

          <Row label="Kontakt">
            {days.map((d, i) => {
              const today = i === days.length - 1;
              const text = `${dayName(d, today)} · kontakt z asystentką: ${d.interactions}${today ? ' (do teraz)' : ''}`;
              const labelled = !today && extremes.has(d.interactions);
              return (
                <button key={d.date} type="button" aria-label={text} {...hover(text)} className="relative mx-auto flex h-14 w-8 flex-col items-center justify-end border-b border-line">
                  {labelled && <span className="text-xs font-semibold tabular-nums text-muted">{d.interactions}</span>}
                  <span
                    className="w-4 rounded-t-[4px]"
                    style={{ height: `${d.interactions ? Math.max(3, (d.interactions / max) * 36) : 0}px`, background: SERIES, opacity: today ? 0.45 : 1 }}
                  />
                </button>
              );
            })}
          </Row>
        </div>
      )}

      <p className="mt-2 min-h-5 text-sm text-muted" aria-live="polite">
        {readout ?? (table ? '' : 'Najedź lub dotknij, aby zobaczyć szczegóły.')}
      </p>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        {(['done', 'missed', 'pending'] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="grid size-4 place-items-center rounded text-[10px] font-bold" style={{ background: DOSE[k].bg, color: DOSE[k].fg }}>
              {DOSE[k].glyph}
            </span>
            {DOSE[k].text}
          </span>
        ))}
        <button type="button" onClick={() => setTable(!table)} className="ml-auto font-semibold text-brand underline-offset-2 hover:underline">
          {table ? 'Pokaż wykres' : 'Pokaż tabelę'}
        </button>
      </div>

      <InsightList insights={insights.insights} />
    </div>
  );
}

/** Plain-language observations under a chart; "watch" ones stand out. */
export function InsightList({ insights }: { insights: Insight[] }) {
  if (!insights.length) return null;
  return (
    <ul className="mt-4 space-y-2">
      {insights.map((item, i) => (
        <li key={i} className={`flex gap-2.5 rounded-2xl p-3 leading-snug ${item.tone === 'watch' ? 'bg-warn-soft/70' : 'bg-paper'}`}>
          <Glyph icon={INSIGHT_ICON[item.tone].icon} className={`mt-0.5 shrink-0 ${INSIGHT_ICON[item.tone].color}`} />
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-left text-sm font-semibold text-muted">{label}</span>
      {children}
    </>
  );
}

function MoodIcon({ mood }: { mood: Mood }) {
  const { icon: Icon, color } = MOOD[mood];
  return <Icon size={22} strokeWidth={2.25} className={color} aria-hidden />;
}

function Glyph({ icon: Icon, className }: { icon: LucideIcon; className: string }) {
  return <Icon size={18} className={className} aria-hidden />;
}
