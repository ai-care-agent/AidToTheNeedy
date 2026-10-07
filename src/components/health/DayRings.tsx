import { ChevronLeft, ChevronRight, CircleCheck, CircleDashed, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { HealthDay, HealthThresholds, InsightDay } from '../../../shared/types';
import { HOUSEHOLD_TZ } from '../../lib/format';
import { dayRings, monitorRows, ZONE, type Ring } from '../../lib/dayScores';

const dayTitle = (date: string, offset: number) =>
  offset === 0
    ? 'Dziś'
    : offset === -1
      ? 'Wczoraj'
      : new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: HOUSEHOLD_TZ }).format(new Date(`${date}T12:00:00Z`));

/** One score as a ring: the arc fills to the value, the zone is also written under it. */
export function ScoreRing({ ring, size = 104, onClick }: { ring: Ring; size?: number; onClick?: () => void }) {
  const [shown, setShown] = useState(0);
  // Start empty and fill, so a new day (or a new reading) visibly lands.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(ring.pct ?? 0));
    return () => cancelAnimationFrame(id);
  }, [ring.pct]);
  const r = 42;
  const c = 2 * Math.PI * r;
  const zone = ZONE[ring.zone];
  const big = size >= 110;
  return (
    <button type="button" onClick={onClick} className="flex w-full min-w-0 flex-col items-center gap-1.5 rounded-3xl p-1 text-center" aria-label={`${ring.spoken}. ${zone.word}.`}>
      {/* The ring takes its cell (up to `size`), and its numbers are sized from the ring itself
          (container units), so they stay inside it at any text size. */}
      <span className="relative grid aspect-square w-full place-items-center [container-type:inline-size]" style={{ maxWidth: size }}>
        <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-raised)" strokeWidth="8" />
          <circle className="ring-arc" cx="50" cy="50" r={r} fill="none" stroke={zone.color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(shown / 100) * c} ${c}`} />
        </svg>
        <span className="flex flex-col items-center">
          <span className="num" style={{ fontSize: ring.value.length > 4 ? '24cqw' : '31cqw' }}>
            {ring.value}
          </span>
          {ring.pct !== null && ring.key !== 'meds' && (
            <span className="num text-muted" style={{ fontSize: '14cqw' }}>
              {Math.round(ring.pct)}%
            </span>
          )}
        </span>
      </span>
      <span className={`kicker ${big ? 'text-2xl' : 'text-base'}`}>{ring.label}</span>
      <span className={`flex items-center justify-center gap-1 leading-tight text-muted ${big ? 'text-base' : 'text-xs'}`}>
        <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: zone.color }} aria-hidden />
        {ring.sub}
      </span>
    </button>
  );
}

/**
 * The top of the day: "‹ Dziś ›" and three rings, then (for the family) how each vital sits
 * against her usual week. Swiping or the arrows go back through the last seven days.
 */
export function DayRings({
  days,
  doses,
  thresholds,
  monitor = false,
  large = false,
  onRing,
}: {
  days: HealthDay[];
  doses: InsightDay[];
  thresholds: HealthThresholds;
  monitor?: boolean;
  large?: boolean;
  onRing?: (ring: Ring) => void;
}) {
  const [index, setIndex] = useState(days.length - 1);
  const [touchX, setTouchX] = useState<number | null>(null);
  const last = days.length - 1;
  const day = days[Math.min(index, last)];
  if (!day) return null;
  const rings = dayRings(
    doses.find((d) => d.date === day.date),
    day,
    thresholds,
    index === last,
  );
  const rows = monitor ? monitorRows(days, Math.min(index, last), thresholds) : [];
  const known = rows.filter((r) => r.inRange !== null);
  const go = (delta: number) => setIndex((i) => Math.min(last, Math.max(0, i + delta)));

  return (
    <div
      onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX === null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 50) go(dx > 0 ? -1 : 1);
        setTouchX(null);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <DayArrow dir="prev" disabled={index === 0} onClick={() => go(-1)} large={large} />
        <p className={`kicker text-center first-letter:uppercase ${large ? 'text-3xl' : 'text-xl'}`} aria-live="polite">
          {dayTitle(day.date, index - last)}
        </p>
        <DayArrow dir="next" disabled={index === last} onClick={() => go(1)} large={large} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1">
        {rings.map((r) => (
          <ScoreRing key={r.key} ring={r} size={large ? 112 : 104} onClick={onRing && (() => onRing(r))} />
        ))}
      </div>

      {monitor && (
        <div className="mt-5 rounded-3xl bg-raised p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="kicker text-lg">Monitor zdrowia</p>
            {known.length > 0 && (
              <p className="text-sm text-muted">
                <span className="num text-xl text-ink">
                  {known.filter((r) => r.inRange).length}/{known.length}
                </span>{' '}
                w jej normie
              </p>
            )}
          </div>
          <ul className="mt-3 space-y-3">
            {rows.map((r) => (
              <li key={r.metric} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                <p className="min-w-0 leading-tight">
                  <span className="block font-semibold">{r.label}</span>
                  <span className="block text-xs text-muted">{r.bandText}</span>
                </p>
                <p className="flex items-center gap-1.5 justify-self-end">
                  <span className="num text-2xl">{r.value}</span>
                  {r.value !== '—' && r.unit && <span className="text-xs text-muted">{r.unit}</span>}
                  <Status inRange={r.inRange} />
                </p>
                {r.at !== null && (
                  <span className="relative col-span-2 block h-1.5 rounded-full bg-paper" aria-hidden>
                    {r.band[1] > r.band[0] && (
                      <span className="absolute inset-y-0 rounded-full bg-series-track" style={{ left: `${r.band[0] * 100}%`, width: `${(r.band[1] - r.band[0]) * 100}%` }} />
                    )}
                    <span
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-raised"
                      style={{ left: `${r.at * 100}%`, background: r.inRange === false ? 'var(--color-warn)' : 'var(--color-ink)' }}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Status({ inRange }: { inRange: boolean | null }) {
  if (inRange === null) return <CircleDashed size={18} className="text-muted" aria-label="bez oceny" />;
  return inRange ? <CircleCheck size={18} className="text-ok" aria-label="w normie" /> : <TriangleAlert size={18} className="text-warn" aria-label="poza jej normą" />;
}

function DayArrow({ dir, disabled, onClick, large }: { dir: 'prev' | 'next'; disabled: boolean; onClick: () => void; large: boolean }) {
  const Icon = dir === 'prev' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === 'prev' ? 'Poprzedni dzień' : 'Następny dzień'}
      className={`grid shrink-0 place-items-center rounded-full bg-raised text-ink transition hover:bg-line disabled:opacity-30 ${large ? 'size-14' : 'size-10'}`}
    >
      <Icon size={large ? 30 : 22} />
    </button>
  );
}
