import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef } from 'react';

/** + and − that keep going while held. */
function useRepeat(action: () => void) {
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(action);
  latest.current = action;
  const stop = () => window.clearTimeout(timer.current);
  useEffect(() => stop, []);
  const start = () => {
    latest.current();
    const loop = (delay: number) => {
      timer.current = window.setTimeout(() => {
        latest.current();
        loop(Math.max(80, delay * 0.8));
      }, delay);
    };
    loop(450);
  };
  return { onPointerDown: start, onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "HH:mm" as two big steppers: hours by one, minutes by five — no tiny clock dials. */
export function TimeStepper({ value, onChange, label, max }: { value: string; onChange: (v: string) => void; label: string; max?: string }) {
  const [h, m] = value.split(':').map(Number);
  const total = h * 60 + m;
  const limit = max ? Number(max.slice(0, 2)) * 60 + Number(max.slice(3)) : 23 * 60 + 55;
  const set = (minutes: number) => {
    const t = Math.min(limit, Math.max(0, minutes));
    onChange(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  };
  const hDown = useRepeat(() => set(total - 60));
  const hUp = useRepeat(() => set(total + 60));
  const mDown = useRepeat(() => set(Math.ceil(total / 5) * 5 - 5));
  const mUp = useRepeat(() => set(Math.floor(total / 5) * 5 + 5));
  const btn = 'grid size-14 touch-none select-none place-items-center rounded-2xl bg-paper ring-2 ring-line active:scale-95';

  return (
    <div className="rounded-3xl bg-surface p-3 shadow-soft" role="group" aria-label={label}>
      <p className="text-lg font-semibold text-muted">{label}</p>
      <div className="mt-2 flex items-center justify-center gap-2">
        <span className="flex flex-col items-center gap-2">
          <button type="button" {...hUp} aria-label="Godzina później" className={btn}>
            <Plus size={26} />
          </button>
          <button type="button" {...hDown} aria-label="Godzina wcześniej" className={btn}>
            <Minus size={26} />
          </button>
        </span>
        <span className="num px-2 text-6xl" aria-live="polite">
          {pad(h)}:{pad(m)}
        </span>
        <span className="flex flex-col items-center gap-2">
          <button type="button" {...mUp} aria-label="5 minut później" className={btn}>
            <Plus size={26} />
          </button>
          <button type="button" {...mDown} aria-label="5 minut wcześniej" className={btn}>
            <Minus size={26} />
          </button>
        </span>
      </div>
      <p className="mt-1 flex justify-between px-1 text-sm text-muted">
        <span>godzina</span>
        <span>minuty</span>
      </p>
    </div>
  );
}
