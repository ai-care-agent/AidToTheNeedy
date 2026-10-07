import type { HealthMetric } from '../../shared/types';
import { addDays, dateKey, parseLocalDate, startOfDay } from '../time';

// Cloud sources the family can connect with one OAuth consent. Both are free for developers:
// - Google Health API (successor of the Fitbit Web API, which shut down in September 2026):
//   Fitbit, Pixel Watch and apps that write to the Google account. No blood pressure.
// - Withings Public API: blood pressure monitors, scales, watches — the cuff many seniors own.
// The adapters follow the published docs; neither has been run against a live account in the POC.

export interface NewReading {
  metric: HealthMetric;
  value: number;
  value2?: number | null;
  measuredAt: Date;
  device?: string | null;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  /** ms since epoch */
  expiresAt: number;
  account: string | null;
}

export interface CloudProvider {
  id: 'google' | 'withings';
  name: string;
  metrics: HealthMetric[];
  setup: string;
  configured(): boolean;
  authUrl(redirectUri: string, state: string): string;
  exchange(code: string, redirectUri: string): Promise<Tokens>;
  refresh(tokens: Tokens): Promise<Tokens>;
  fetchReadings(tokens: Tokens, since: Date, now: Date): Promise<NewReading[]>;
}

export class ProviderError extends Error {}

async function readJson(res: Response, what: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) throw new ProviderError(`${what}: HTTP ${res.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(`${what}: not JSON`);
  }
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields);

// ------------------------------------------------------------------ Google Health API

const GOOGLE_API = 'https://health.googleapis.com/v4/users/me/dataTypes';
const GOOGLE_SCOPES = ['activity_and_fitness', 'health_metrics_and_measurements', 'sleep'].map((s) => `https://www.googleapis.com/auth/googlehealth.${s}.readonly`);

/** Readings are averaged into 10-minute buckets: a band reports the pulse every few seconds. */
const PULSE_BUCKET_MS = 10 * 60_000;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** Sample types carry sampleTime.physicalTime; interval types carry interval.startTime. */
function googleTime(point: Json): Date | null {
  const t = obj(point.sampleTime).physicalTime ?? obj(point.interval).endTime ?? obj(point.interval).startTime;
  const d = typeof t === 'string' ? new Date(t) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function civilDate(value: unknown): Date | null {
  const d = obj(obj(value).date);
  const y = num(d.year);
  const m = num(d.month);
  const day = num(d.day);
  return y && m && day ? parseLocalDate(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`) : null;
}

const device = (point: Json) => {
  const name = obj(obj(point.dataSource).device).displayName;
  return typeof name === 'string' ? name : null;
};

export function parseGoogleSteps(body: unknown): NewReading[] {
  return arr(obj(body).rollupDataPoints).flatMap((p) => {
    const day = civilDate(obj(p).civilStartTime);
    const steps = num(obj(obj(p).steps).countSum);
    return day && steps !== null ? [{ metric: 'steps' as const, value: steps, measuredAt: day }] : [];
  });
}

export function parseGoogleHeartRate(body: unknown): NewReading[] {
  const buckets = new Map<number, { sum: number; n: number; device: string | null }>();
  for (const raw of arr(obj(body).dataPoints)) {
    const p = obj(raw);
    const hr = obj(p.heartRate);
    const at = googleTime(hr);
    const bpm = num(hr.bpm) ?? num(hr.beatsPerMinute);
    if (!at || bpm === null) continue;
    const key = Math.floor(at.getTime() / PULSE_BUCKET_MS) * PULSE_BUCKET_MS;
    const b = buckets.get(key) ?? { sum: 0, n: 0, device: device(p) };
    b.sum += bpm;
    b.n += 1;
    buckets.set(key, b);
  }
  return [...buckets].map(([key, b]) => ({ metric: 'heart_rate' as const, value: Math.round(b.sum / b.n), measuredAt: new Date(key + PULSE_BUCKET_MS / 2), device: b.device }));
}

export function parseGoogleSpo2(body: unknown): NewReading[] {
  return arr(obj(body).dataPoints).flatMap((raw) => {
    const p = obj(raw);
    const s = obj(p.oxygenSaturation);
    const at = googleTime(s);
    const pct = num(s.percentage);
    return at && pct !== null ? [{ metric: 'spo2' as const, value: pct, measuredAt: at, device: device(p) }] : [];
  });
}

/** Minutes asleep: the whole session minus the stages marked AWAKE (each stage runs until the next one starts). */
export function parseGoogleSleep(body: unknown): NewReading[] {
  return arr(obj(body).dataPoints).flatMap((raw) => {
    const p = obj(raw);
    const sleep = obj(p.sleep);
    const start = Date.parse(String(obj(sleep.interval).startTime));
    const end = Date.parse(String(obj(sleep.interval).endTime));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const stages = arr(sleep.stages)
      .map((s) => ({ type: String(obj(s).type), at: Date.parse(String(obj(s).startTime)) }))
      .filter((s) => Number.isFinite(s.at))
      .sort((a, b) => a.at - b.at);
    let awake = 0;
    stages.forEach((s, i) => {
      if (s.type === 'AWAKE') awake += (stages[i + 1]?.at ?? end) - s.at;
    });
    return [{ metric: 'sleep' as const, value: Math.round((end - start - awake) / 60_000), measuredAt: new Date(end), device: device(p) }];
  });
}

async function googleList(token: string, type: string, filter: string): Promise<unknown> {
  const points: unknown[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 5; page++) {
    const url = new URL(`${GOOGLE_API}/${type}/dataPoints`);
    url.searchParams.set('filter', filter);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const body = obj(await readJson(await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }), `Google ${type}`));
    points.push(...arr(body.dataPoints));
    pageToken = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : null;
    if (!pageToken) break;
  }
  return { dataPoints: points };
}

const civil = (d: Date, end = false) => ({
  date: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
  time: end ? { hours: 23, minutes: 59, seconds: 59, nanos: 0 } : { hours: 0, minutes: 0, seconds: 0, nanos: 0 },
});

export const google: CloudProvider = {
  id: 'google',
  name: 'Google Health (Fitbit, Pixel Watch)',
  metrics: ['heart_rate', 'steps', 'sleep', 'spo2'],
  setup: 'Bezpłatnie: projekt w Google Cloud z włączonym Google Health API, klient OAuth i konto testowe. W .env: GOOGLE_HEALTH_CLIENT_ID i GOOGLE_HEALTH_CLIENT_SECRET.',
  configured: () => Boolean(process.env.GOOGLE_HEALTH_CLIENT_ID && process.env.GOOGLE_HEALTH_CLIENT_SECRET),
  authUrl(redirectUri, state) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = form({
      client_id: process.env.GOOGLE_HEALTH_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      // A refresh token is only returned on a consent screen.
      prompt: 'consent',
      state,
    }).toString();
    return url.toString();
  },
  async exchange(code, redirectUri) {
    return googleToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }, null);
  },
  async refresh(tokens) {
    if (!tokens.refreshToken) throw new ProviderError('Brak tokenu odświeżania — połącz konto ponownie.');
    return googleToken({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, tokens);
  },
  async fetchReadings(tokens, since, now) {
    const token = tokens.accessToken;
    const iso = since.toISOString();
    const stepsBody = await readJson(
      await fetch(`${GOOGLE_API}/steps/dataPoints:dailyRollUp`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ range: { start: civil(startOfDay(since)), end: civil(now, true) }, windowSizeDays: 1 }),
      }),
      'Google steps',
    );
    const [hr, spo2, sleep] = await Promise.all([
      googleList(token, 'heart-rate', `heart_rate.sample_time.physical_time >= "${iso}"`),
      googleList(token, 'oxygen-saturation', `oxygen_saturation.sample_time.physical_time >= "${iso}"`),
      googleList(token, 'sleep', `sleep.interval.start_time >= "${addDays(since, -1).toISOString()}"`),
    ]);
    return [...parseGoogleSteps(stepsBody), ...parseGoogleHeartRate(hr), ...parseGoogleSpo2(spo2), ...parseGoogleSleep(sleep)];
  },
};

async function googleToken(fields: Record<string, string>, previous: Tokens | null): Promise<Tokens> {
  const body = obj(
    await readJson(
      await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form({ client_id: process.env.GOOGLE_HEALTH_CLIENT_ID!, client_secret: process.env.GOOGLE_HEALTH_CLIENT_SECRET!, ...fields }),
      }),
      'Google token',
    ),
  );
  if (typeof body.access_token !== 'string') throw new ProviderError('Google token: no access_token');
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : (previous?.refreshToken ?? null),
    expiresAt: Date.now() + (num(body.expires_in) ?? 3600) * 1000,
    account: previous?.account ?? null,
  };
}

// ------------------------------------------------------------------ Withings Public API

const WITHINGS = 'https://wbsapi.withings.net';
/** Withings measure types: 9 diastolic, 10 systolic, 11 pulse, 54 SpO2. */
const MEAS = { dia: 9, sys: 10, pulse: 11, spo2: 54 };

function withingsBody(json: unknown, what: string): Json {
  const o = obj(json);
  if (o.status !== 0) throw new ProviderError(`${what}: status ${String(o.status)} ${String(o.error ?? '')}`.trim());
  return obj(o.body);
}

/** Each group is one measurement session (a cuff reading gives systolic, diastolic and pulse together). */
export function parseWithingsMeasures(body: Json): NewReading[] {
  const out: NewReading[] = [];
  for (const raw of arr(body.measuregrps)) {
    const g = obj(raw);
    const date = num(g.date);
    if (date === null) continue;
    const at = new Date(date * 1000);
    const values = new Map<number, number>();
    for (const m of arr(g.measures)) {
      const type = num(obj(m).type);
      const value = num(obj(m).value);
      const unit = num(obj(m).unit) ?? 0;
      if (type !== null && value !== null) values.set(type, value * 10 ** unit);
    }
    const sys = values.get(MEAS.sys);
    const dia = values.get(MEAS.dia);
    if (sys !== undefined && dia !== undefined) out.push({ metric: 'blood_pressure', value: Math.round(sys), value2: Math.round(dia), measuredAt: at, device: 'Withings' });
    const pulse = values.get(MEAS.pulse);
    if (pulse !== undefined) out.push({ metric: 'heart_rate', value: Math.round(pulse), measuredAt: at, device: 'Withings' });
    const spo2 = values.get(MEAS.spo2);
    if (spo2 !== undefined) out.push({ metric: 'spo2', value: Math.round(spo2), measuredAt: at, device: 'Withings' });
  }
  return out;
}

export function parseWithingsActivity(body: Json): NewReading[] {
  return arr(body.activities).flatMap((raw) => {
    const a = obj(raw);
    const day = typeof a.date === 'string' ? parseLocalDate(a.date) : null;
    const steps = num(a.steps);
    return day && steps !== null ? [{ metric: 'steps' as const, value: steps, measuredAt: day, device: 'Withings' }] : [];
  });
}

export function parseWithingsSleep(body: Json): NewReading[] {
  return arr(body.series).flatMap((raw) => {
    const s = obj(raw);
    const end = num(s.enddate);
    const seconds = num(obj(s.data).total_sleep_time);
    return end !== null && seconds !== null ? [{ metric: 'sleep' as const, value: Math.round(seconds / 60), measuredAt: new Date(end * 1000), device: 'Withings' }] : [];
  });
}

async function withingsCall(token: string, path: string, fields: Record<string, string>, what: string): Promise<Json> {
  const res = await fetch(`${WITHINGS}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form(fields) });
  return withingsBody(await readJson(res, what), what);
}

export const withings: CloudProvider = {
  id: 'withings',
  name: 'Withings (ciśnieniomierz, zegarek, waga)',
  metrics: ['blood_pressure', 'heart_rate', 'steps', 'sleep', 'spo2'],
  setup: 'Bezpłatnie: aplikacja w Withings Developer Dashboard (Public API). W .env: WITHINGS_CLIENT_ID i WITHINGS_CLIENT_SECRET.',
  configured: () => Boolean(process.env.WITHINGS_CLIENT_ID && process.env.WITHINGS_CLIENT_SECRET),
  authUrl(redirectUri, state) {
    const url = new URL('https://account.withings.com/oauth2_user/authorize2');
    url.search = form({ response_type: 'code', client_id: process.env.WITHINGS_CLIENT_ID!, scope: 'user.metrics,user.activity', redirect_uri: redirectUri, state }).toString();
    return url.toString();
  },
  async exchange(code, redirectUri) {
    return withingsToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }, null);
  },
  async refresh(tokens) {
    if (!tokens.refreshToken) throw new ProviderError('Brak tokenu odświeżania — połącz konto ponownie.');
    return withingsToken({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, tokens);
  },
  async fetchReadings(tokens, since, now) {
    const t = tokens.accessToken;
    const range = { startdateymd: dateKey(since), enddateymd: dateKey(now) };
    const [meas, activity, sleep] = await Promise.all([
      withingsCall(t, '/measure', { action: 'getmeas', meastypes: Object.values(MEAS).join(','), category: '1', startdate: String(Math.floor(since.getTime() / 1000)), enddate: String(Math.floor(now.getTime() / 1000)) }, 'Withings getmeas'),
      withingsCall(t, '/v2/measure', { action: 'getactivity', ...range, data_fields: 'steps' }, 'Withings getactivity'),
      withingsCall(t, '/v2/sleep', { action: 'getsummary', ...range, data_fields: 'total_sleep_time' }, 'Withings sleep'),
    ]);
    return [...parseWithingsMeasures(meas), ...parseWithingsActivity(activity), ...parseWithingsSleep(sleep)];
  },
};

async function withingsToken(fields: Record<string, string>, previous: Tokens | null): Promise<Tokens> {
  const res = await fetch(`${WITHINGS}/v2/oauth2`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form({ action: 'requesttoken', client_id: process.env.WITHINGS_CLIENT_ID!, client_secret: process.env.WITHINGS_CLIENT_SECRET!, ...fields }),
  });
  const body = withingsBody(await readJson(res, 'Withings token'), 'Withings token');
  if (typeof body.access_token !== 'string') throw new ProviderError('Withings token: no access_token');
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : (previous?.refreshToken ?? null),
    expiresAt: Date.now() + (num(body.expires_in) ?? 10_800) * 1000,
    account: body.userid !== undefined ? `Withings #${String(body.userid)}` : (previous?.account ?? null),
  };
}

export const cloudProviders: Record<'google' | 'withings', CloudProvider> = { google, withings };
