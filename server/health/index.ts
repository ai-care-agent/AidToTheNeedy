import { randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import {
  HEALTH_METRICS,
  type HealthCheck,
  type HealthDay,
  type HealthLatest,
  type HealthMetric,
  type HealthReading,
  type HealthSource,
  type HealthSourceId,
  type HealthThresholds,
  type HealthView,
  type LivePulse,
} from '../../shared/types';
import type { Care } from '../care';
import type { DB } from '../db';
import { publishEvent } from '../events';
import { profile } from '../profile';
import { addDays, addMinutes, dateKey, endOfDay, hhmm, relativeWhen, startOfDay } from '../time';
import { cloudProviders, ProviderError, type NewReading, type Tokens } from './providers';
import { classify, DEFAULT_THRESHOLDS, fmtInt, fmtSleep, fmtTemp, healthInsights } from './rules';

const iso = (d: Date) => d.toISOString();

interface ReadingRow {
  id: number;
  metric: string;
  value: number;
  value2: number | null;
  measured_at: string;
  source: string;
  device: string | null;
}

interface SourceRow {
  id: string;
  status: string;
  detail: string | null;
  tokens: string | null;
  last_sync_at: string | null;
  last_error: string | null;
}

interface CheckRow {
  id: number;
  metric: string;
  reading_id: number;
  created_at: string;
  answered_at: string | null;
}

const toReading = (r: ReadingRow): HealthReading => ({
  id: r.id,
  metric: r.metric as HealthMetric,
  value: r.value,
  value2: r.value2,
  measuredAt: r.measured_at,
  source: r.source as HealthSourceId,
  device: r.device,
});

const WEEKDAY_SHORT = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];

/** Live readings (a band streaming the pulse) are stored at most this often per source. */
const LIVE_STORE_EVERY_MS = 60_000;
/** A second worrying reading this soon after the first doesn't ask her again. */
const CHECK_COOLDOWN_MIN = 30;
/** Nothing from any device for this long: "maybe the band needs charging". */
const STALE_AFTER_HOURS = 12;
/** Cloud sources are polled this often by the scheduler. */
const SYNC_EVERY_MIN = 15;
/** A pulse above the limit only counts at rest: fewer steps than this in the last 15 minutes. */
const AT_REST_STEPS = 150;

const REMEASURE: Partial<Record<HealthMetric, string>> = {
  blood_pressure: 'Zmierzyć ciśnienie jeszcze raz',
  heart_rate: 'Sprawdzić tętno jeszcze raz',
  spo2: 'Zmierzyć saturację jeszcze raz',
  temperature: 'Zmierzyć temperaturę jeszcze raz',
};

const METRIC_NAME: Record<HealthMetric, string> = {
  heart_rate: 'Tętno',
  blood_pressure: 'Ciśnienie',
  steps: 'Kroki',
  sleep: 'Sen',
  spo2: 'Saturacja',
  temperature: 'Temperatura',
};

/** "172/104 mmHg", "88 ud./min" — how a reading is written in the family feed. */
export function readingText(metric: HealthMetric, value: number, value2: number | null): string {
  switch (metric) {
    case 'blood_pressure':
      return `${Math.round(value)}/${Math.round(value2 ?? 0)} mmHg`;
    case 'heart_rate':
      return `${Math.round(value)} ud./min`;
    case 'spo2':
      return `${Math.round(value)}%`;
    case 'temperature':
      return fmtTemp(value);
    case 'steps':
      return `${fmtInt(value)} kroków`;
    case 'sleep':
      return fmtSleep(value);
  }
}

const SOURCE_INFO: Record<Exclude<HealthSourceId, 'manual'>, Pick<HealthSource, 'name' | 'kind' | 'metrics' | 'setup'>> = {
  demo: {
    name: 'Opaska i ciśnieniomierz (demo)',
    kind: 'demo',
    metrics: ['heart_rate', 'blood_pressure', 'temperature', 'steps', 'sleep', 'spo2'],
    setup: 'Symulowane urządzenia z historią dwóch tygodni — działają bez kont i bez sprzętu.',
  },
  bluetooth: {
    name: 'Opaska lub ciśnieniomierz Bluetooth',
    kind: 'band',
    metrics: ['heart_rate', 'blood_pressure', 'temperature'],
    setup: 'Bez kont i opłat: Chrome lub Edge na telefonie seniorki łączy się z urządzeniem przez Web Bluetooth (standardowe usługi Heart Rate, Blood Pressure i Health Thermometer).',
  },
  google: { name: cloudProviders.google.name, kind: 'cloud', metrics: cloudProviders.google.metrics, setup: cloudProviders.google.setup },
  withings: { name: cloudProviders.withings.name, kind: 'cloud', metrics: cloudProviders.withings.metrics, setup: cloudProviders.withings.setup },
};

export class Health {
  /** Demo band: a slow random walk around her resting pulse. */
  private demoBpm = 72;
  private lastDemoStored = 0;
  private readonly lastLiveStored = new Map<string, number>();
  private readonly syncing = new Set<string>();

  constructor(
    private readonly db: DB,
    private readonly care: Care,
    private readonly onChange: () => void,
  ) {}

  private all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as unknown as T[];
  }

  private one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as unknown as T | undefined;
  }

  private run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params);
  }

  // ---------------------------------------------------------------- settings

  thresholds(): HealthThresholds {
    return { ...DEFAULT_THRESHOLDS, ...(this.care.getKv<Partial<HealthThresholds>>('health_thresholds') ?? {}) };
  }

  setThresholds(patch: Partial<HealthThresholds>): HealthThresholds {
    this.care.setKv('health_thresholds', { ...this.thresholds(), ...patch });
    this.onChange();
    return this.thresholds();
  }

  sharing(): Record<HealthMetric, boolean> {
    const saved = this.care.getKv<Partial<Record<HealthMetric, boolean>>>('health_sharing') ?? {};
    return Object.fromEntries(HEALTH_METRICS.map((m) => [m, saved[m] !== false])) as Record<HealthMetric, boolean>;
  }

  /** Only she decides what the family sees; the family is told when she stops sharing. */
  setSharing(metric: HealthMetric, shared: boolean, now = new Date()): void {
    const current = this.sharing();
    if (current[metric] === shared) return;
    this.care.setKv('health_sharing', { ...current, [metric]: shared });
    this.care.addFeed('health', 'info', shared ? `${profile.familyCallsHer} udostępnia: ${METRIC_NAME[metric].toLowerCase()}` : `${profile.familyCallsHer} nie udostępnia już: ${METRIC_NAME[metric].toLowerCase()}`, null, null, now);
    this.onChange();
  }

  // ---------------------------------------------------------------- readings

  /** Direct insert for the demo history: no alerts, no feed. */
  importReading(source: HealthSourceId, r: NewReading): void {
    this.upsert(source, r, r.measuredAt);
  }

  private upsert(source: HealthSourceId, r: NewReading, now: Date): number {
    const row = this.one<{ id: number }>(
      `INSERT INTO health_readings (metric, value, value2, measured_at, source, device, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(metric, source, measured_at) DO UPDATE SET value = excluded.value, value2 = excluded.value2, device = COALESCE(excluded.device, device)
       RETURNING id`,
      r.metric,
      r.value,
      r.value2 ?? null,
      iso(r.measuredAt),
      source,
      r.device ?? null,
      iso(now),
    );
    return row!.id;
  }

  /**
   * A new reading from a device or from her. A worrying one asks her to rest and measure
   * again, and tells the family (if she shares that metric); a normal one after it clears it.
   */
  addReading(source: HealthSourceId, r: NewReading, now = new Date(), opts: { atRest?: boolean } = {}): HealthLatest {
    const id = this.upsert(source, r, now);
    const reading = this.latestFrom(toReading(this.one<ReadingRow>('SELECT * FROM health_readings WHERE id = ?', id)!));
    if (source === 'manual') this.care.touchActivity(now, 'health');
    if (reading.metric !== 'steps' && reading.metric !== 'sleep') this.react(reading, now, opts.atRest ?? false);
    this.onChange();
    return reading;
  }

  private react(reading: HealthLatest, now: Date, atRest: boolean): void {
    const shared = this.sharing()[reading.metric];
    const text = readingText(reading.metric, reading.value, reading.value2);
    if (reading.level === 'alert') {
      if (reading.metric === 'heart_rate' && !atRest && this.stepsSince(addMinutes(now, -15)) >= AT_REST_STEPS) return;
      const recent = this.one<CheckRow>('SELECT * FROM health_checks WHERE metric = ? AND created_at >= ? ORDER BY id DESC LIMIT 1', reading.metric, iso(addMinutes(now, -CHECK_COOLDOWN_MIN)));
      if (recent) return;
      const id = Number(this.run('INSERT INTO health_checks (metric, reading_id, created_at) VALUES (?, ?, ?)', reading.metric, reading.id, iso(now)).lastInsertRowid);
      if (shared) {
        this.care.addFeed(
          'health',
          'warning',
          `${METRIC_NAME[reading.metric]}: ${reading.label} — ${text}`,
          `Pomiar o ${hhmm(new Date(reading.measuredAt))}. ${profile.familyCallsHer} dostała prośbę, żeby odpocząć i zmierzyć jeszcze raz. To nie jest diagnoza — w razie wątpliwości zadzwoń.`,
          `healthcheck:${id}`,
          now,
        );
      }
      return;
    }
    // Back in range after a worrying reading: close her card and the family's alert.
    const open = this.one<CheckRow>(`SELECT * FROM health_checks WHERE metric = ? AND created_at >= ? ORDER BY id DESC LIMIT 1`, reading.metric, iso(addMinutes(now, -120)));
    if (!open || reading.level !== 'normal') return;
    // A band streams the pulse every minute; it has to stay calm for a while to count as "again".
    if (reading.metric === 'heart_rate' && Date.parse(reading.measuredAt) - Date.parse(open.created_at) < 5 * 60_000) return;
    if (this.one<{ n: number }>(`SELECT COUNT(*) AS n FROM feed WHERE ref = ? AND kind = 'health' AND severity = 'success'`, `healthcheck:${open.id}:again`)!.n) return;
    this.run(`UPDATE health_checks SET answered_at = COALESCE(answered_at, ?), answer = COALESCE(answer, 'normal_again') WHERE id = ?`, iso(now), open.id);
    this.run('UPDATE feed SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE ref = ?', iso(now), `healthcheck:${open.id}`);
    if (shared) this.care.addFeed('health', 'success', `Ponowny pomiar: ${METRIC_NAME[reading.metric].toLowerCase()} ${text}`, `O ${hhmm(new Date(reading.measuredAt))} — ${reading.label}.`, `healthcheck:${open.id}:again`, now);
  }

  private stepsSince(since: Date): number {
    return this.one<{ n: number | null }>(`SELECT SUM(value) AS n FROM health_readings WHERE metric = 'steps' AND source IN ('demo', 'bluetooth') AND measured_at >= ?`, iso(since))!.n ?? 0;
  }

  /** A band streaming the pulse: pushed live to both apps, stored once a minute. */
  livePulse(source: HealthSourceId, bpm: number, device: string | null, now = new Date()): void {
    const pulse: LivePulse = { bpm: Math.round(bpm), at: iso(now), source };
    publishEvent('pulse', pulse);
    if (now.getTime() - (this.lastLiveStored.get(source) ?? 0) < LIVE_STORE_EVERY_MS) return;
    this.lastLiveStored.set(source, now.getTime());
    if (source === 'bluetooth') this.markSource('bluetooth', { status: 'connected', detail: device, lastSyncAt: now });
    this.addReading(source, { metric: 'heart_rate', value: pulse.bpm, measuredAt: now, device }, now);
  }

  private latestFrom(r: HealthReading): HealthLatest {
    return { ...r, ...classify(r.metric, r.value, r.value2, this.thresholds()) };
  }

  // ---------------------------------------------------------------- her answer to "zmierz jeszcze raz"

  openCheck(now = new Date()): HealthCheck | null {
    const row = this.one<CheckRow>('SELECT * FROM health_checks WHERE answered_at IS NULL AND created_at >= ? ORDER BY id DESC LIMIT 1', iso(addMinutes(now, -180)));
    if (!row) return null;
    const reading = this.one<ReadingRow>('SELECT * FROM health_readings WHERE id = ?', row.reading_id);
    if (!reading) return null;
    return { id: row.id, metric: row.metric as HealthMetric, reading: this.latestFrom(toReading(reading)), createdAt: row.created_at };
  }

  /** 'remeasure' sets a reminder in 5 minutes; 'unwell' raises the urgent alert (the app shows 112). */
  answerCheck(id: number, answer: 'ok' | 'remeasure' | 'unwell', now = new Date()): boolean {
    const row = this.one<CheckRow>('SELECT * FROM health_checks WHERE id = ?', id);
    if (!row || row.answered_at) return false;
    this.run('UPDATE health_checks SET answered_at = ?, answer = ? WHERE id = ?', iso(now), answer, id);
    this.care.touchActivity(now, 'health');
    const metric = row.metric as HealthMetric;
    const shared = this.sharing()[metric];
    if (answer === 'remeasure') {
      this.care.createReminder({ title: REMEASURE[metric] ?? 'Zmierzyć jeszcze raz', category: 'other', at: addMinutes(now, 5), createdBy: 'agent', shareWithFamily: shared, announce: false }, now);
    } else if (answer === 'unwell') {
      this.care.emergency(`Po wysokim odczycie (${METRIC_NAME[metric].toLowerCase()}) ${profile.gender === 'f' ? 'zgłosiła' : 'zgłosił'}, że źle się czuje.`);
    } else if (shared) {
      this.care.addFeed('health', 'info', `${profile.familyCallsHer} odpowiada: czuje się dobrze`, `Po odczycie o ${hhmm(new Date(row.created_at))}.`, null, now);
    }
    this.onChange();
    return true;
  }

  // ---------------------------------------------------------------- sources

  private sourceRow(id: HealthSourceId): SourceRow | undefined {
    return this.one<SourceRow>('SELECT * FROM health_sources WHERE id = ?', id);
  }

  markSource(id: HealthSourceId, patch: { status?: string; detail?: string | null; tokens?: Tokens | null; lastSyncAt?: Date; error?: string | null }): void {
    const row = this.sourceRow(id);
    this.run(
      `INSERT INTO health_sources (id, status, detail, tokens, connected_at, last_sync_at, last_error) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, detail = excluded.detail, tokens = excluded.tokens, last_sync_at = excluded.last_sync_at, last_error = excluded.last_error`,
      id,
      patch.status ?? row?.status ?? 'connected',
      patch.detail !== undefined ? patch.detail : (row?.detail ?? null),
      patch.tokens !== undefined ? (patch.tokens ? JSON.stringify(patch.tokens) : null) : (row?.tokens ?? null),
      iso(new Date()),
      patch.lastSyncAt ? iso(patch.lastSyncAt) : (row?.last_sync_at ?? null),
      patch.error !== undefined ? patch.error : (row?.last_error ?? null),
    );
    this.onChange();
  }

  disconnect(id: HealthSourceId): void {
    this.run('DELETE FROM health_sources WHERE id = ?', id);
    this.onChange();
  }

  isConnected(id: HealthSourceId): boolean {
    return this.sourceRow(id)?.status === 'connected';
  }

  sources(now = new Date()): HealthSource[] {
    return (Object.keys(SOURCE_INFO) as (keyof typeof SOURCE_INFO)[]).map((id) => {
      const row = this.sourceRow(id);
      const info = SOURCE_INFO[id];
      let status: HealthSource['status'] = row?.status === 'connected' ? 'connected' : row?.status === 'error' ? 'error' : 'available';
      if ((id === 'google' || id === 'withings') && !cloudProviders[id].configured() && status !== 'connected') status = 'not_configured';
      // A Bluetooth band counts as connected while it keeps sending.
      if (id === 'bluetooth' && row && row.last_sync_at && now.getTime() - Date.parse(row.last_sync_at) > 3 * 60_000) status = 'available';
      return { id, ...info, status, lastSyncAt: row?.last_sync_at ?? null, detail: status === 'error' ? (row?.last_error ?? null) : (row?.detail ?? null) };
    });
  }

  /** One-time state for the OAuth round trip; the callback must bring it back. */
  beginOAuth(provider: 'google' | 'withings', redirectUri: string): string {
    const state = randomUUID();
    this.care.setKv('health_oauth', { state, provider, at: Date.now() });
    return cloudProviders[provider].authUrl(redirectUri, state);
  }

  async finishOAuth(provider: 'google' | 'withings', code: string, state: string, redirectUri: string, now = new Date()): Promise<void> {
    const saved = this.care.getKv<{ state: string; provider: string; at: number }>('health_oauth');
    if (!saved || saved.state !== state || saved.provider !== provider || Date.now() - saved.at > 15 * 60_000) throw new ProviderError('Nieprawidłowy lub przeterminowany stan logowania — spróbuj połączyć jeszcze raz.');
    this.care.setKv('health_oauth', null);
    const tokens = await cloudProviders[provider].exchange(code, redirectUri);
    this.markSource(provider, { status: 'connected', tokens, detail: tokens.account, error: null });
    await this.sync(provider, now, 14);
  }

  /** Pulls recent readings from a connected cloud source; new worrying ones react like any other. */
  async sync(provider: 'google' | 'withings', now = new Date(), days = 2): Promise<number> {
    const row = this.sourceRow(provider);
    if (!row?.tokens || this.syncing.has(provider)) return 0;
    this.syncing.add(provider);
    try {
      let tokens = JSON.parse(row.tokens) as Tokens;
      if (tokens.expiresAt - Date.now() < 60_000) {
        tokens = await cloudProviders[provider].refresh(tokens);
        this.markSource(provider, { tokens });
      }
      const since = row.last_sync_at && days <= 2 ? addDays(new Date(row.last_sync_at), -1) : startOfDay(addDays(now, -days));
      const readings = await cloudProviders[provider].fetchReadings(tokens, since, now);
      const known = new Set(this.all<{ k: string }>(`SELECT metric || '|' || measured_at AS k FROM health_readings WHERE source = ? AND measured_at >= ?`, provider, iso(since)).map((r) => r.k));
      for (const r of readings) {
        // Only fresh readings may ask her to measure again; history is imported quietly.
        const fresh = !known.has(`${r.metric}|${iso(r.measuredAt)}`) && now.getTime() - r.measuredAt.getTime() < 60 * 60_000;
        if (fresh) this.addReading(provider, r, now);
        else this.importReading(provider, r);
      }
      this.markSource(provider, { status: 'connected', lastSyncAt: now, error: null });
      console.log(`[health] ${provider}: ${readings.length} readings`);
      return readings.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[health] ${provider} sync failed:`, message);
      this.markSource(provider, { status: 'error', error: message });
      return 0;
    } finally {
      this.syncing.delete(provider);
    }
  }

  // ---------------------------------------------------------------- scheduler hook

  /** Every scheduler pass: the demo band "wears" on her wrist; cloud sources are polled now and then. */
  tick(now = new Date()): void {
    if (this.isConnected('demo')) this.simulate(now);
    for (const provider of ['google', 'withings'] as const) {
      const row = this.sourceRow(provider);
      if (row?.status === 'connected' && (!row.last_sync_at || now.getTime() - Date.parse(row.last_sync_at) >= SYNC_EVERY_MIN * 60_000)) {
        void this.sync(provider, now);
      }
    }
  }

  private simulate(now: Date): void {
    const hour = now.getHours();
    const target = hour >= 8 && hour < 21 ? 72 : 62;
    this.demoBpm += (target - this.demoBpm) * 0.08 + (Math.random() - 0.5) * 3;
    this.demoBpm = Math.min(96, Math.max(56, this.demoBpm));
    if (now.getTime() - this.lastDemoStored >= LIVE_STORE_EVERY_MS && hour >= 8 && hour < 21) {
      this.importReading('demo', { metric: 'steps', value: Math.floor(Math.random() * 14), measuredAt: now, device: 'Opaska demo' });
    }
    this.livePulse('demo', this.demoBpm, 'Opaska demo', now);
    if (now.getTime() - this.lastDemoStored >= LIVE_STORE_EVERY_MS) this.lastDemoStored = now.getTime();
  }

  // ---------------------------------------------------------------- views

  private daysView(now: Date): HealthDay[] {
    const from = startOfDay(addDays(now, -6));
    const rows = this.all<ReadingRow>('SELECT * FROM health_readings WHERE measured_at BETWEEN ? AND ? ORDER BY measured_at', iso(from), iso(endOfDay(now)));
    const days: HealthDay[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = startOfDay(addDays(now, -i));
      const key = dateKey(day);
      const of = (metric: HealthMetric) => rows.filter((r) => r.metric === metric && dateKey(new Date(r.measured_at)) === key);
      // Two sources may count the same steps (a band and a phone): take the larger total, never the sum.
      const perSource = (metric: HealthMetric) => {
        const totals = new Map<string, number>();
        for (const r of of(metric)) totals.set(r.source, (totals.get(r.source) ?? 0) + r.value);
        return totals.size ? Math.max(...totals.values()) : null;
      };
      const hr = of('heart_rate').map((r) => r.value);
      const bp = of('blood_pressure');
      const spo2 = of('spo2').map((r) => r.value);
      const temp = of('temperature').map((r) => r.value);
      const mean = (v: number[]) => (v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null);
      days.push({
        date: key,
        label: WEEKDAY_SHORT[day.getDay()],
        steps: perSource('steps'),
        sleepMin: perSource('sleep'),
        hrAvg: mean(hr),
        hrMin: hr.length ? Math.round(Math.min(...hr)) : null,
        hrMax: hr.length ? Math.round(Math.max(...hr)) : null,
        bpSys: mean(bp.map((r) => r.value)),
        bpDia: mean(bp.map((r) => r.value2 ?? 0)),
        bpReadings: bp.length,
        spo2: mean(spo2),
        temp: temp.length ? Math.round(Math.max(...temp) * 10) / 10 : null,
      });
    }
    return days;
  }

  private latest(now: Date, days: HealthDay[]): HealthView['latest'] {
    const latest: HealthView['latest'] = {};
    for (const metric of ['heart_rate', 'blood_pressure', 'spo2', 'temperature'] as const) {
      const row = this.one<ReadingRow>('SELECT * FROM health_readings WHERE metric = ? AND measured_at <= ? ORDER BY measured_at DESC, id DESC LIMIT 1', metric, iso(now));
      if (row) latest[metric] = this.latestFrom(toReading(row));
    }
    // Steps and sleep are daily totals.
    const today = days.at(-1)!;
    for (const [metric, value] of [
      ['steps', today.steps],
      ['sleep', today.sleepMin],
    ] as const) {
      if (value === null) continue;
      const row = this.one<ReadingRow>('SELECT * FROM health_readings WHERE metric = ? AND measured_at BETWEEN ? AND ? ORDER BY measured_at DESC LIMIT 1', metric, iso(startOfDay(now)), iso(now));
      latest[metric] = this.latestFrom({ id: row?.id ?? 0, metric, value, value2: null, measuredAt: row?.measured_at ?? iso(now), source: (row?.source ?? 'demo') as HealthSourceId, device: row?.device ?? null });
    }
    return latest;
  }

  view(viewer: 'senior' | 'family', now = new Date()): HealthView {
    const sharing = this.sharing();
    const thresholds = this.thresholds();
    const hidden = (m: HealthMetric) => viewer === 'family' && !sharing[m];
    const days = this.daysView(now).map((d) => ({
      ...d,
      steps: hidden('steps') ? null : d.steps,
      sleepMin: hidden('sleep') ? null : d.sleepMin,
      ...(hidden('heart_rate') ? { hrAvg: null, hrMin: null, hrMax: null } : {}),
      ...(hidden('blood_pressure') ? { bpSys: null, bpDia: null, bpReadings: 0 } : {}),
      spo2: hidden('spo2') ? null : d.spo2,
      temp: hidden('temperature') ? null : d.temp,
    }));
    const latest = this.latest(now, days);
    for (const m of HEALTH_METRICS) if (hidden(m)) delete latest[m];

    const weekBp = hidden('blood_pressure') ? [] : this.all<ReadingRow>(`SELECT * FROM health_readings WHERE metric = 'blood_pressure' AND measured_at >= ?`, iso(startOfDay(addDays(now, -6))));
    const visit = this.care.listEvents(now, endOfDay(addDays(now, 7)))[0];
    const insights = healthInsights(days, thresholds, {
      bpReadings: weekBp.length,
      bpHighReadings: weekBp.filter((r) => classify('blood_pressure', r.value, r.value2, thresholds).level !== 'normal').length,
      nextVisit: visit ? `${relativeWhen(new Date(visit.startsAt), now)} (${visit.title})` : null,
    });

    const newest = this.one<{ at: string | null }>(`SELECT MAX(measured_at) AS at FROM health_readings WHERE source != 'manual' AND metric != 'sleep' AND measured_at <= ?`, iso(now))!.at;
    const anyDevice = this.all<{ id: string }>(`SELECT id FROM health_sources WHERE status = 'connected'`).length > 0;
    const staleSince = anyDevice && newest && now.getTime() - Date.parse(newest) > STALE_AFTER_HOURS * 3_600_000 ? newest : null;

    const today = days.at(-1)!;
    return { latest, today: { steps: today.steps, stepsGoal: thresholds.stepsGoal, sleepMin: today.sleepMin }, days, insights, sources: this.sources(now), sharing, thresholds, staleSince };
  }

  /** For the agent's context block: what she could ask about ("jakie mam ciśnienie?"). */
  contextLines(now = new Date()): string[] {
    const v = this.view('senior', now);
    const lines: string[] = [];
    for (const m of HEALTH_METRICS) {
      const l = v.latest[m];
      if (!l) continue;
      const when = m === 'steps' ? 'dziś do teraz' : m === 'sleep' ? 'ostatnia noc' : relativeWhen(new Date(l.measuredAt), now);
      lines.push(`- ${METRIC_NAME[m]}: ${readingText(m, l.value, l.value2)} (${when}; ${l.label})${v.sharing[m] ? '' : ' · nie udostępniane rodzinie'}`);
    }
    const past = v.days.slice(0, -1);
    const stepDays = past.map((d) => d.steps).filter((s): s is number => s !== null);
    if (stepDays.length) lines.push(`- Kroki w ostatnich dniach: średnio ${fmtInt(stepDays.reduce((a, b) => a + b, 0) / stepDays.length)} dziennie; cel ${fmtInt(v.thresholds.stepsGoal)}`);
    for (const i of v.insights) lines.push(`- Obserwacja: ${i.text}`);
    if (v.staleSince) lines.push(`- Urządzenia nie wysyłają danych od: ${relativeWhen(new Date(v.staleSince), now)} (może trzeba naładować opaskę)`);
    return lines;
  }
}
