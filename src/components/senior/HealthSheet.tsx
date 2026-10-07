import { Bluetooth, BluetoothOff, Check, Footprints, Lock, MessageCircleQuestion, Minus, Moon, Plus, Stethoscope, Thermometer, Users, Wind, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { HealthLatest, HealthMetric, HealthView } from '../../../shared/types';
import { HEALTH_METRICS } from '../../../shared/types';
import { postJson } from '../../lib/api';
import { bluetoothSupported } from '../../lib/bluetooth';
import { fmtTime } from '../../lib/format';
import { fmtInt, fmtSleep, fmtTemp, fmtValue, LEVEL, METRIC, pairBand, spokenValue, unpairBand, useBand, useLivePulse } from '../../lib/health';
import { Beat } from '../health/Beat';
import { Sheet } from '../ui';

type Stage = 'overview' | 'measure' | 'temperature' | 'sharing';

/** "Moje zdrowie": the numbers big, a tap reads one aloud, and she decides what the family sees. */
export function HealthSheet({ health, tz, onClose, onSay, onAsk, onSaved }: { health: HealthView; tz: string; onClose: () => void; onSay: (text: string) => void; onAsk: (question: string) => void; onSaved: () => void }) {
  const [stage, setStage] = useState<Stage>('overview');
  const pulse = useLivePulse(health.latest.heart_rate);
  const band = useBand();
  const { latest, today } = health;
  const stepsLeft = today.steps !== null ? Math.max(0, today.stepsGoal - today.steps) : null;

  const readAloud = (m: HealthMetric, reading: HealthLatest | undefined) => {
    if (m === 'heart_rate' && pulse.bpm !== null) return onSay(`Tętno: ${spokenValue(m, pulse.bpm)}. ${latest.heart_rate?.label ?? ''}.`);
    if (m === 'steps' && today.steps !== null) return onSay(`Dziś ${today.steps} kroków. ${stepsLeft ? `Do celu brakuje ${stepsLeft}.` : 'Cel na dziś osiągnięty. Brawo!'}`);
    if (!reading) return onSay(`Nie mam jeszcze pomiaru: ${METRIC[m].name.toLowerCase()}.`);
    onSay(`${METRIC[m].name}: ${spokenValue(m, reading.value, reading.value2)}, o ${fmtTime(reading.measuredAt, tz)}. ${reading.label}.`);
  };

  if (stage === 'measure') {
    return (
      <Sheet title="Wpisz ciśnienie" onClose={onClose}>
        <MeasureForm
          last={latest.blood_pressure}
          onCancel={() => setStage('overview')}
          onSaved={(r) => {
            onSay(`Zapisałam: ${spokenValue('blood_pressure', r.value, r.value2)}. ${r.level === 'normal' ? 'To w typowym zakresie.' : `Ciśnienie jest ${r.label}.`}`);
            onSaved();
            setStage('overview');
          }}
        />
      </Sheet>
    );
  }

  if (stage === 'temperature') {
    return (
      <Sheet title="Wpisz temperaturę" onClose={onClose}>
        <TemperatureForm
          last={latest.temperature}
          onCancel={() => setStage('overview')}
          onSaved={(r) => {
            onSay(`Zapisałam: ${spokenValue('temperature', r.value)}. ${r.level === 'normal' ? 'To w normie.' : `To ${r.label}.`}`);
            onSaved();
            setStage('overview');
          }}
        />
      </Sheet>
    );
  }

  if (stage === 'sharing') {
    return (
      <Sheet title="Co widzi rodzina?" onClose={onClose}>
        <Sharing sharing={health.sharing} onSaved={onSaved} />
        <button type="button" onClick={() => setStage('overview')} className="min-h-16 w-full rounded-2xl bg-brand text-xl font-bold text-on-accent">
          Gotowe
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet title="Moje zdrowie" onClose={onClose} wide>
      <button type="button" onClick={() => readAloud('heart_rate', latest.heart_rate)} className="flex w-full items-center gap-5 rounded-3xl bg-tint-rose p-5 text-left shadow-soft">
        <span className="grid size-24 shrink-0 place-items-center rounded-full bg-surface">
          <Beat bpm={pulse.bpm ?? 70} size={56} live={pulse.live} />
        </span>
        <span className="min-w-0">
          <span className="block text-xl font-semibold text-muted">Tętno</span>
          <span className="block num text-8xl">{pulse.bpm !== null ? Math.round(pulse.bpm) : '—'}</span>
          <span className="mt-1 block text-lg text-muted">{pulse.live ? 'na żywo z opaski' : latest.heart_rate ? `o ${fmtTime(latest.heart_rate.measuredAt, tz)}` : 'brak pomiaru'}</span>
        </span>
      </button>

      <div className="grid gap-3 sm:grid-cols-2">
        <Metric icon={Stethoscope} label="Ciśnienie" reading={latest.blood_pressure} tz={tz} onClick={() => readAloud('blood_pressure', latest.blood_pressure)} />
        <button type="button" onClick={() => readAloud('steps', undefined)} className="rounded-3xl bg-surface p-4 text-left shadow-soft">
          <span className="flex items-center gap-2 text-xl font-semibold text-muted">
            <Footprints size={24} /> Kroki dziś
          </span>
          <span className="mt-1 block num text-5xl">{today.steps !== null ? fmtInt(today.steps) : '—'}</span>
          {today.steps !== null && (
            <>
              <span className="mt-2 block h-3 rounded-full bg-series-track">
                <span className="block h-3 rounded-full bg-series transition-[width] duration-700" style={{ width: `${Math.min(100, (today.steps / today.stepsGoal) * 100)}%` }} />
              </span>
              <span className="mt-1 block text-lg text-muted">{stepsLeft ? `Do celu: ${fmtInt(stepsLeft)}` : 'Cel osiągnięty — brawo!'}</span>
            </>
          )}
        </button>
        <Metric icon={Moon} label="Sen" reading={latest.sleep} tz={tz} text={today.sleepMin !== null ? fmtSleep(today.sleepMin) : undefined} onClick={() => readAloud('sleep', latest.sleep)} />
        <Metric icon={Wind} label="Saturacja" reading={latest.spo2} tz={tz} onClick={() => readAloud('spo2', latest.spo2)} />
        <Metric icon={Thermometer} label="Temperatura" reading={latest.temperature} tz={tz} onClick={() => readAloud('temperature', latest.temperature)} />
      </div>

      <p className="text-center text-lg text-muted">Dotknięcie przeczyta wynik na głos.</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => setStage('measure')} className="flex min-h-[4.5rem] w-full items-center justify-center gap-3 rounded-2xl bg-brand px-5 text-2xl font-bold text-on-accent hover:bg-brand-strong">
          <Stethoscope size={28} /> Wpisz ciśnienie
        </button>
        <button type="button" onClick={() => setStage('temperature')} className="flex min-h-[4.5rem] w-full items-center justify-center gap-3 rounded-2xl bg-brand px-5 text-2xl font-bold text-on-accent hover:bg-brand-strong">
          <Thermometer size={28} /> Wpisz temperaturę
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            onClose();
            onAsk('Jak wygląda moje zdrowie w tym tygodniu?');
          }}
          className="flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-surface px-4 text-xl font-semibold ring-2 ring-line hover:ring-brand"
        >
          <MessageCircleQuestion size={24} /> Zapytaj asystentkę
        </button>
        <button type="button" onClick={() => setStage('sharing')} className="flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-surface px-4 text-xl font-semibold ring-2 ring-line hover:ring-brand">
          <Users size={24} /> Co widzi rodzina?
        </button>
      </div>

      {bluetoothSupported && (
        <div className="rounded-3xl bg-surface p-4 shadow-soft">
          {band.status === 'connected' ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-xl">
                <Bluetooth size={24} className="text-brand" /> Połączono: <b>{band.name}</b>
              </p>
              <button type="button" onClick={unpairBand} className="flex min-h-14 items-center gap-2 rounded-2xl px-4 text-lg font-semibold ring-2 ring-line">
                <BluetoothOff size={22} /> Rozłącz
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => void pairBand()} disabled={band.status === 'connecting'} className="flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl text-xl font-semibold ring-2 ring-line hover:ring-brand disabled:opacity-60">
              <Bluetooth size={24} /> {band.status === 'connecting' ? 'Łączę…' : 'Połącz opaskę lub ciśnieniomierz'}
            </button>
          )}
          {band.error && <p className="mt-2 text-lg text-danger">{band.error}</p>}
        </div>
      )}
    </Sheet>
  );
}

function Metric({ icon: Icon, label, reading, tz, text, onClick }: { icon: LucideIcon; label: string; reading: HealthLatest | undefined; tz: string; text?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-3xl bg-surface p-4 text-left shadow-soft">
      <span className="flex items-center gap-2 text-xl font-semibold text-muted">
        <Icon size={24} /> {label}
      </span>
      <span className="mt-1 block num text-5xl">
        {text ?? (reading ? fmtValue(reading.metric, reading.value, reading.value2) : '—')}
        {reading && !text && METRIC[reading.metric].unit && <span className="ml-1 text-xl font-semibold text-muted">{METRIC[reading.metric].unit}</span>}
      </span>
      {reading && (
        <span className="mt-1 flex flex-wrap items-center gap-2 text-lg">
          <span className={`rounded-full px-2 font-semibold ${LEVEL[reading.level].pill}`}>{reading.label}</span>
          <span className="text-muted">{fmtTime(reading.measuredAt, tz)}</span>
        </span>
      )}
    </button>
  );
}

/** + and − that keep counting while held, so 130 → 145 is one press, not fifteen. */
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
        loop(Math.max(60, delay * 0.8));
      }, delay);
    };
    loop(400);
  };
  return { onPointerDown: start, onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop };
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  step = 1,
  format = String,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  step?: number;
  format?: (v: number) => string;
}) {
  // Rounded to the step, so 36.6 + 0.1 is 36.7 and not 36.699999.
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)) / step) * step;
  const down = useRepeat(() => onChange(clamp(value - step)));
  const up = useRepeat(() => onChange(clamp(value + step)));
  return (
    <div className="flex items-center justify-between gap-3 rounded-3xl bg-surface p-3 shadow-soft">
      <span className="text-xl font-semibold">{label}</span>
      <span className="flex items-center gap-2">
        <button type="button" {...down} onKeyDown={(e) => e.key === 'Enter' && onChange(clamp(value - step))} aria-label={`${label}: mniej`} className="grid size-16 touch-none select-none place-items-center rounded-2xl bg-paper ring-2 ring-line active:scale-95">
          <Minus size={30} />
        </button>
        <span className="min-w-20 text-center num text-5xl" aria-live="polite">
          {format(value)}
        </span>
        <button type="button" {...up} onKeyDown={(e) => e.key === 'Enter' && onChange(clamp(value + step))} aria-label={`${label}: więcej`} className="grid size-16 touch-none select-none place-items-center rounded-2xl bg-paper ring-2 ring-line active:scale-95">
          <Plus size={30} />
        </button>
      </span>
    </div>
  );
}

function TemperatureForm({ last, onCancel, onSaved }: { last: HealthLatest | undefined; onCancel: () => void; onSaved: (r: HealthLatest) => void }) {
  const [value, setValue] = useState(last ? Math.round(last.value * 10) / 10 : 36.6);
  const [error, setError] = useState(false);

  async function save() {
    try {
      onSaved(await postJson<HealthLatest>('/api/senior/health/readings', { metric: 'temperature', value }));
    } catch {
      setError(true);
    }
  }

  return (
    <>
      <p className="text-xl leading-snug text-muted">Proszę przepisać wynik z termometru. Przytrzymanie przycisku zmienia szybciej.</p>
      <Stepper label="Temperatura" value={value} min={34} max={42} step={0.1} format={fmtTemp} onChange={setValue} />
      <p className="rounded-2xl bg-paper px-4 py-3 text-center text-3xl font-bold tabular-nums">
        {fmtTemp(value)} <span className="text-xl font-semibold text-muted">°C</span>
      </p>
      {error && <p className="rounded-2xl bg-danger-soft px-4 py-2 text-lg text-danger">Nie udało się zapisać. Proszę spróbować jeszcze raz.</p>}
      <button type="button" onClick={() => void save()} className="flex min-h-[4.5rem] w-full items-center justify-center gap-3 rounded-2xl bg-ok text-2xl font-bold text-on-accent hover:brightness-110">
        <Check size={30} /> Zapisz pomiar
      </button>
      <button type="button" onClick={onCancel} className="min-h-16 w-full rounded-2xl bg-surface text-xl font-semibold ring-2 ring-line">
        Wróć
      </button>
    </>
  );
}

function MeasureForm({ last, onCancel, onSaved }: { last: HealthLatest | undefined; onCancel: () => void; onSaved: (r: HealthLatest) => void }) {
  const [sys, setSys] = useState(last ? Math.round(last.value) : 130);
  const [dia, setDia] = useState(last?.value2 ? Math.round(last.value2) : 80);
  const [pulse, setPulse] = useState(70);
  const [withPulse, setWithPulse] = useState(false);
  const [error, setError] = useState(false);

  async function save() {
    try {
      const reading = await postJson<HealthLatest>('/api/senior/health/readings', { metric: 'blood_pressure', value: sys, value2: dia });
      if (withPulse) await postJson('/api/senior/health/readings', { metric: 'heart_rate', value: pulse });
      onSaved(reading);
    } catch {
      setError(true);
    }
  }

  return (
    <>
      <p className="text-xl leading-snug text-muted">Proszę przepisać liczby z ciśnieniomierza. Przytrzymanie przycisku zmienia szybciej.</p>
      <Stepper label="Górne" value={sys} min={70} max={250} onChange={setSys} />
      <Stepper label="Dolne" value={dia} min={40} max={150} onChange={setDia} />
      {withPulse ? (
        <Stepper label="Tętno" value={pulse} min={30} max={200} onChange={setPulse} />
      ) : (
        <button type="button" onClick={() => setWithPulse(true)} className="flex min-h-14 items-center gap-2 text-xl font-semibold text-brand">
          <Plus size={22} /> Dodaj też tętno
        </button>
      )}
      <p className="rounded-2xl bg-paper px-4 py-3 text-center text-3xl font-bold tabular-nums">
        {sys}/{dia} <span className="text-xl font-semibold text-muted">mmHg</span>
      </p>
      {error && <p className="rounded-2xl bg-danger-soft px-4 py-2 text-lg text-danger">Nie udało się zapisać. Proszę spróbować jeszcze raz.</p>}
      <button type="button" onClick={() => void save()} className="flex min-h-[4.5rem] w-full items-center justify-center gap-3 rounded-2xl bg-ok text-2xl font-bold text-on-accent hover:brightness-110">
        <Check size={30} /> Zapisz pomiar
      </button>
      <button type="button" onClick={onCancel} className="min-h-16 w-full rounded-2xl bg-surface text-xl font-semibold ring-2 ring-line">
        Wróć
      </button>
    </>
  );
}

function Sharing({ sharing, onSaved }: { sharing: Record<HealthMetric, boolean>; onSaved: () => void }) {
  const [values, setValues] = useState(sharing);

  async function flip(m: HealthMetric) {
    const next = !values[m];
    setValues({ ...values, [m]: next });
    try {
      setValues(await postJson<Record<HealthMetric, boolean>>('/api/senior/health/sharing', { metric: m, shared: next }));
      onSaved();
    } catch {
      setValues(values);
    }
  }

  return (
    <>
      <p className="text-xl leading-snug">Pani decyduje. Wyłączony pomiar zostaje tylko u Pani — rodzina nie zobaczy go ani nie dostanie alertu.</p>
      <ul className="space-y-2">
        {HEALTH_METRICS.map((m) => (
          <li key={m}>
            <button
              type="button"
              role="switch"
              aria-checked={values[m]}
              onClick={() => void flip(m)}
              className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl bg-surface px-4 text-left text-2xl font-semibold shadow-soft"
            >
              {METRIC[m].name}
              <span className="flex items-center gap-3">
                <span className={`text-lg font-semibold ${values[m] ? 'text-ok' : 'text-muted'}`}>{values[m] ? 'widzi' : <Lock size={20} className="inline" />}</span>
                <span className={`relative h-9 w-16 rounded-full transition ${values[m] ? 'bg-ok' : 'bg-line'}`}>
                  <span className={`absolute top-1 size-7 rounded-full bg-white shadow transition-all ${values[m] ? 'left-8' : 'left-1'}`} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
