import { BatteryLow, Bluetooth, Cloud, HeartPulse, Link2, Lock, Minus, Plus, RefreshCw, Settings2, Unplug, Watch, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { HealthMetric, HealthSource, HealthThresholds, HealthView } from '../../../shared/types';
import { HEALTH_METRICS } from '../../../shared/types';
import { postJson } from '../../lib/api';
import { fmtWhen, timeAgo } from '../../lib/format';
import { fmtInt, fmtSleep, fmtTemp, fmtValue, LEVEL, METRIC, useLivePulse } from '../../lib/health';
import { HealthChart } from '../health/HealthChart';
import { Beat } from '../health/Beat';
import { InsightList } from './WeekCard';

const SOURCE_ICON: Record<HealthSource['kind'], LucideIcon> = { band: Bluetooth, cloud: Cloud, demo: Watch };

const SOURCE_STATUS: Record<HealthSource['status'], { text: string; tone: string }> = {
  connected: { text: 'połączone', tone: 'bg-ok-soft text-ok' },
  available: { text: 'można połączyć', tone: 'bg-paper text-muted' },
  not_configured: { text: 'wymaga konfiguracji', tone: 'bg-paper text-muted' },
  error: { text: 'błąd', tone: 'bg-danger-soft text-danger' },
};

/** What the family can tune; each step is a sensible jump, and the server keeps the bounds. */
const KNOBS: { key: keyof HealthThresholds; label: string; step: number; unit: string }[] = [
  { key: 'stepsGoal', label: 'Cel kroków dziennie', step: 500, unit: '' },
  { key: 'sysHigh', label: 'Alert: ciśnienie skurczowe od', step: 5, unit: 'mmHg' },
  { key: 'diaHigh', label: 'Alert: ciśnienie rozkurczowe od', step: 5, unit: 'mmHg' },
  { key: 'hrHigh', label: 'Alert: tętno w spoczynku powyżej', step: 5, unit: 'ud./min' },
  { key: 'spo2Low', label: 'Alert: saturacja poniżej', step: 1, unit: '%' },
  { key: 'tempHigh', label: 'Alert: temperatura od', step: 0.1, unit: '°C' },
];

export function HealthCard({ health, senior, now, onChange }: { health: HealthView; senior: string; now: Date; onChange: () => void }) {
  const shared = HEALTH_METRICS.filter((m) => health.sharing[m]);
  const [metric, setMetric] = useState<HealthMetric>(() => (shared.includes('blood_pressure') ? 'blood_pressure' : (shared[0] ?? 'steps')));
  const [panel, setPanel] = useState<'sources' | 'thresholds' | null>(null);
  const pulse = useLivePulse(health.latest.heart_rate);
  const connected = health.sources.filter((s) => s.status === 'connected');

  if (!connected.length && !Object.keys(health.latest).length) {
    return (
      <div className="space-y-3">
        <p className="leading-snug">Podłącz opaskę lub ciśnieniomierz {senior}, a tutaj zobaczysz tętno, ciśnienie, kroki i sen — z alertem tylko wtedy, gdy coś wymaga uwagi.</p>
        <Sources sources={health.sources} onChange={onChange} />
      </div>
    );
  }

  const current = shared.includes(metric) ? metric : shared[0];

  return (
    <div>
      {health.staleSince && (
        <p className="mb-3 flex items-center gap-2 rounded-2xl bg-warn-soft px-3 py-2 text-warn">
          <BatteryLow size={20} className="shrink-0" /> Brak danych z opaski od {timeAgo(health.staleSince, now).replace(' temu', '')} — może trzeba ją naładować?
        </p>
      )}

      <div className="@container">
      <div className="grid gap-2 @min-[20rem]:grid-cols-2 @min-[34rem]:grid-cols-3" role="tablist" aria-label="Pomiar">
        {HEALTH_METRICS.map((m) => {
          const visible = health.sharing[m];
          const latest = health.latest[m];
          const selected = current === m;
          const live = m === 'heart_rate' && pulse.live;
          const value = m === 'heart_rate' && pulse.bpm !== null ? String(Math.round(pulse.bpm)) : m === 'steps' ? (health.today.steps !== null ? fmtInt(health.today.steps) : null) : m === 'sleep' && latest ? fmtSleep(latest.value, true) : latest ? fmtValue(m, latest.value, latest.value2) : null;
          const level = m === 'steps' ? null : latest?.level;
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={selected}
              disabled={!visible}
              onClick={() => setMetric(m)}
              className={`rounded-2xl p-3 text-left ring-1 transition ${selected ? 'bg-brand-soft ring-2 ring-brand' : 'bg-paper ring-line hover:ring-brand'} disabled:cursor-default disabled:opacity-70 disabled:hover:ring-line`}
            >
              <span className="flex items-center justify-between gap-1 text-sm font-semibold text-muted">
                {METRIC[m].name}
                {live && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-1.5 text-xs font-bold text-danger">
                    <span className="size-1.5 animate-pulse rounded-full bg-danger" /> na żywo
                  </span>
                )}
              </span>
              {visible ? (
                <>
                  <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1">
                    {m === 'heart_rate' && pulse.bpm !== null && <Beat bpm={pulse.bpm} size={18} live={live} />}
                    <span className="num text-3xl">{value ?? '—'}</span>
                    {value && m !== 'steps' && <span className="text-sm text-muted">{m === 'sleep' ? 'godz.' : METRIC[m].unit}</span>}
                  </span>
                  <span className="mt-0.5 block text-sm leading-tight text-muted">
                    {level ? (
                      <span className={`mr-1 inline-flex items-center gap-1 rounded-full px-1.5 font-semibold ${LEVEL[level].pill}`}>
                        {LEVEL[level].glyph} {latest!.label}
                      </span>
                    ) : m === 'steps' ? (
                      `cel ${fmtInt(health.today.stepsGoal)}`
                    ) : null}
                    {latest && m !== 'steps' && fmtWhen(latest.measuredAt, now).replace('dziś ', '')}
                  </span>
                  {m === 'steps' && health.today.steps !== null && <Meter value={health.today.steps} max={health.today.stepsGoal} />}
                </>
              ) : (
                <span className="mt-1 flex items-center gap-1.5 text-sm leading-tight text-muted">
                  <Lock size={14} className="shrink-0" /> {senior} tego nie udostępnia
                </span>
              )}
            </button>
          );
        })}
      </div>
      </div>

      {current && (
        <div className="mt-4">
          <p className="mb-2 font-semibold">
            {METRIC[current].name} · ostatnie 7 dni
            {current === 'blood_pressure' && <span className="font-normal text-muted"> (średnia z dnia, rozkurczowe–skurczowe)</span>}
            {current === 'heart_rate' && <span className="font-normal text-muted"> (najniższe–najwyższe, kropka = średnia)</span>}
            {current === 'sleep' && health.today.sleepMin !== null && <span className="font-normal text-muted"> · ostatnia noc {fmtSleep(health.today.sleepMin)}</span>}
          </p>
          <HealthChart key={current} metric={current} days={health.days} thresholds={health.thresholds} />
        </div>
      )}

      <InsightList insights={health.insights} />

      <div className="mt-4 flex flex-wrap gap-2">
        <Toggle active={panel === 'sources'} onClick={() => setPanel(panel === 'sources' ? null : 'sources')} icon={Link2}>
          Urządzenia ({connected.length})
        </Toggle>
        <Toggle active={panel === 'thresholds'} onClick={() => setPanel(panel === 'thresholds' ? null : 'thresholds')} icon={Settings2}>
          Progi alertów
        </Toggle>
      </div>
      {panel === 'sources' && (
        <div className="mt-3">
          <Sources sources={health.sources} onChange={onChange} />
        </div>
      )}
      {panel === 'thresholds' && <Thresholds thresholds={health.thresholds} onChange={onChange} />}

      <p className="mt-3 flex items-start gap-2 text-sm text-muted">
        <HeartPulse size={16} className="mt-0.5 shrink-0" />
        To nie jest wyrób medyczny i nie stawia diagnoz. Przy wysokim odczycie {senior} dostaje prośbę o odpoczynek i ponowny pomiar, a Ty — alert. {senior} sama decyduje, które pomiary udostępnia.
      </p>
    </div>
  );
}

function Meter({ value, max }: { value: number; max: number }) {
  return (
    <span className="mt-1.5 block h-1.5 rounded-full bg-series-track" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label="Kroki dziś wobec celu">
      <span className="block h-1.5 rounded-full bg-series transition-[width] duration-700" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </span>
  );
}

function Toggle({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: LucideIcon; children: string | (string | number)[] }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={`flex min-h-11 items-center gap-1.5 rounded-2xl px-4 font-semibold ring-1 transition ${active ? 'bg-brand text-on-accent ring-brand' : 'bg-surface ring-line hover:ring-brand'}`}
    >
      <Icon size={18} /> {children}
    </button>
  );
}

function Sources({ sources, onChange }: { sources: HealthSource[]; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function act(id: string, url: string) {
    setBusy(id);
    try {
      await postJson(url);
    } finally {
      setBusy(null);
      onChange();
    }
  }

  return (
    <ul className="space-y-2">
      {sources.map((s) => {
        const Icon = SOURCE_ICON[s.kind];
        const st = SOURCE_STATUS[s.status];
        const isConnected = s.status === 'connected';
        return (
          <li key={s.id} className="rounded-2xl bg-paper p-3 ring-1 ring-line">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tint-teal text-deep-teal">
                <Icon size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 font-semibold leading-snug">
                  {s.name}
                  <span className={`rounded-full px-2 text-xs font-bold ${st.tone}`}>{st.text}</span>
                </p>
                <p className="text-sm text-muted">
                  {s.metrics.map((m) => METRIC[m].name.toLowerCase()).join(', ')}
                  {s.detail ? ` · ${s.detail}` : ''}
                  {s.lastSyncAt ? ` · ${timeAgo(s.lastSyncAt, new Date())}` : ''}
                </p>
                {open === s.id && <p className="mt-1 text-sm leading-snug">{s.setup}</p>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 pl-12">
              {s.id === 'demo' && !isConnected && <SourceButton busy={busy === s.id} onClick={() => void act(s.id, '/api/family/health/sources/demo/connect')}>Połącz demo</SourceButton>}
              {(s.id === 'google' || s.id === 'withings') && s.status === 'available' && (
                <a href={`/api/health/connect/${s.id}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-brand px-3 text-sm font-semibold text-on-accent hover:bg-brand-strong">
                  <Link2 size={16} /> Połącz konto
                </a>
              )}
              {(s.id === 'google' || s.id === 'withings') && isConnected && (
                <SourceButton busy={busy === s.id} onClick={() => void act(s.id, `/api/family/health/sources/${s.id}/sync`)}>
                  <RefreshCw size={15} className={busy === s.id ? 'animate-spin' : ''} /> Synchronizuj
                </SourceButton>
              )}
              {isConnected && (
                <SourceButton plain busy={busy === s.id} onClick={() => void act(s.id, `/api/family/health/sources/${s.id}/disconnect`)}>
                  <Unplug size={15} /> Odłącz
                </SourceButton>
              )}
              <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="min-h-10 px-1 text-sm font-semibold text-brand underline-offset-2 hover:underline">
                {open === s.id ? 'Mniej' : 'Jak to działa?'}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SourceButton({ children, onClick, busy, plain = false }: { children: ReactNode; onClick: () => void; busy: boolean; plain?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold disabled:opacity-60 ${plain ? 'bg-surface ring-1 ring-line hover:ring-brand' : 'bg-brand text-on-accent hover:bg-brand-strong'}`}
    >
      {children}
    </button>
  );
}

function Thresholds({ thresholds, onChange }: { thresholds: HealthThresholds; onChange: () => void }) {
  const [values, setValues] = useState(thresholds);
  const [failed, setFailed] = useState(false);

  async function bump(key: keyof HealthThresholds, delta: number) {
    const next = { ...values, [key]: Math.round((values[key] + delta) * 10) / 10 };
    setValues(next);
    try {
      setValues(await postJson<HealthThresholds>('/api/family/health/thresholds', { [key]: next[key] }));
      setFailed(false);
      onChange();
    } catch {
      // Out of the allowed range: go back to what the server has.
      setValues(values);
      setFailed(true);
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-2xl bg-paper p-3 ring-1 ring-line">
      {KNOBS.map((k) => (
        <div key={k.key} className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold leading-tight">{k.label}</span>
          <span className="flex shrink-0 items-center gap-1">
            <Step label={`${k.label}: mniej`} onClick={() => void bump(k.key, -k.step)} icon={Minus} />
            <span className="w-20 text-center font-bold tabular-nums">
              {k.key === 'stepsGoal' ? fmtInt(values[k.key]) : k.key === 'tempHigh' ? fmtTemp(values[k.key]) : values[k.key]}
              {k.unit && <span className="block text-xs font-normal text-muted">{k.unit}</span>}
            </span>
            <Step label={`${k.label}: więcej`} onClick={() => void bump(k.key, k.step)} icon={Plus} />
          </span>
        </div>
      ))}
      {failed && <p className="text-sm text-danger">Ta wartość jest poza bezpiecznym zakresem.</p>}
      <p className="text-xs leading-snug text-muted">Przekroczenie progu: prośba o ponowny pomiar u seniorki i alert u Ciebie. Wartości domyślne ustal najlepiej z lekarzem.</p>
    </div>
  );
}

function Step({ label, onClick, icon: Icon }: { label: string; onClick: () => void; icon: LucideIcon }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="grid size-10 place-items-center rounded-full bg-surface ring-1 ring-line hover:ring-brand active:scale-95">
      <Icon size={18} />
    </button>
  );
}
