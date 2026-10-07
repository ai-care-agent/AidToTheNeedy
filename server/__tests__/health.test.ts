import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiStatus } from '../ai/client';
import { contextBlock } from '../ai/prompts';
import { buildTools } from '../ai/tools';
import { Care } from '../care';
import { openDb } from '../db';
import { parseGoogleHeartRate, parseGoogleSleep, parseGoogleSpo2, parseGoogleSteps, parseWithingsActivity, parseWithingsMeasures, parseWithingsSleep } from '../health/providers';
import { classify, DEFAULT_THRESHOLDS, healthInsights } from '../health/rules';
import { seedDemo } from '../seed';
import { addDays, addMinutes, dateKey, startOfDay } from '../time';
import type { HealthDay } from '../../shared/types';

const at = (s: string) => new Date(s);
const newCare = () => new Care(openDb(':memory:'));
const T = DEFAULT_THRESHOLDS;

function tool(care: Care, name: string, now = new Date()) {
  const t = buildTools({ care, now, actions: [] }).find((x) => x.name === name)! as unknown as { parse: (i: unknown) => unknown; run: (i: unknown) => unknown };
  return async (input: unknown) => JSON.parse(String(await t.run(t.parse(input))));
}

afterEach(() => vi.unstubAllGlobals());

describe('health rules', () => {
  it('labels readings plainly and only alerts on clearly high or low values', () => {
    expect(classify('blood_pressure', 128, 82, T)).toEqual({ level: 'normal', label: 'w typowym zakresie' });
    expect(classify('blood_pressure', 146, 88, T).level).toBe('watch');
    expect(classify('blood_pressure', 132, 92, T).level).toBe('watch');
    expect(classify('blood_pressure', 182, 100, T)).toEqual({ level: 'alert', label: 'bardzo wysokie' });
    expect(classify('blood_pressure', 150, 112, T).level).toBe('alert');
    expect(classify('blood_pressure', 86, 55, T)).toEqual({ level: 'alert', label: 'niskie' });
    expect(classify('heart_rate', 72, null, T).level).toBe('normal');
    expect(classify('heart_rate', 108, null, T).level).toBe('watch');
    expect(classify('heart_rate', 131, null, T).level).toBe('alert');
    expect(classify('heart_rate', 38, null, T).label).toBe('bardzo wolny');
    expect(classify('spo2', 89, null, T).level).toBe('alert');
    // Thresholds belong to the family's settings.
    expect(classify('heart_rate', 131, null, { ...T, hrHigh: 140 }).level).toBe('watch');
  });

  it('notices a quiet day, a run of high pressure and short nights', () => {
    const day = (i: number, over: Partial<HealthDay>): HealthDay => ({ date: `2026-09-${20 + i}`, label: '', steps: 5000, sleepMin: 420, hrAvg: 70, hrMin: 58, hrMax: 90, bpSys: 130, bpDia: 80, bpReadings: 1, spo2: 96, temp: null, ...over });
    const days = [day(0, {}), day(1, {}), day(2, {}), day(3, {}), day(4, {}), day(5, { steps: 1300, sleepMin: 320 }), day(6, { steps: 800, sleepMin: 310 })];
    const texts = healthInsights(days, T, { bpReadings: 7, bpHighReadings: 4, nextVisit: 'jutro o 10:30 (kardiolog)' }).map((i) => i.text);
    expect(texts.some((t) => t.startsWith('Wczoraj mniej ruchu niż zwykle: 1 300 kroków, zwykle około 5 000'))).toBe(true);
    expect(texts.some((t) => t.includes('4 z 7 pomiarów') && t.includes('jutro o 10:30'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Dwie ostatnie noce krótszy sen'))).toBe(true);
  });
});

describe('readings, the re-measure card and the family', () => {
  it('a very high blood pressure asks her to measure again and warns the family', () => {
    const care = newCare();
    const now = at('2026-09-29T09:00');
    const r = care.health.addReading('manual', { metric: 'blood_pressure', value: 184, value2: 106, measuredAt: now }, now);
    expect(r.level).toBe('alert');
    const check = care.health.openCheck(addMinutes(now, 1))!;
    expect(check).toMatchObject({ metric: 'blood_pressure', reading: { value: 184, value2: 106 } });
    expect(care.seniorState(aiStatus(), addMinutes(now, 1)).healthCheck?.id).toBe(check.id);
    const alert = care.attentionItems()[0];
    expect(alert).toMatchObject({ kind: 'health', severity: 'warning', title: 'Ciśnienie: bardzo wysokie — 184/106 mmHg' });
    expect(alert.detail).toContain('To nie jest diagnoza');

    // A second high reading a few minutes later doesn't stack another card.
    care.health.addReading('manual', { metric: 'blood_pressure', value: 186, value2: 104, measuredAt: addMinutes(now, 3) }, addMinutes(now, 3));
    expect(care.attentionItems()).toHaveLength(1);
  });

  it('"zmierzę ponownie" sets a reminder; a normal reading afterwards clears the alert', () => {
    const care = newCare();
    const now = at('2026-09-29T09:00');
    care.health.addReading('manual', { metric: 'blood_pressure', value: 184, value2: 106, measuredAt: now }, now);
    const check = care.health.openCheck(now)!;
    expect(care.health.answerCheck(check.id, 'remeasure', addMinutes(now, 1))).toBe(true);
    expect(care.health.answerCheck(check.id, 'remeasure', addMinutes(now, 1))).toBe(false);
    const reminder = care.listReminders(now, addMinutes(now, 60)).find((x) => x.title === 'Zmierzyć ciśnienie jeszcze raz')!;
    expect(new Date(reminder.dueAt)).toEqual(addMinutes(now, 6));
    expect(care.health.openCheck(addMinutes(now, 2))).toBeNull();

    const later = addMinutes(now, 8);
    care.health.addReading('manual', { metric: 'blood_pressure', value: 138, value2: 84, measuredAt: later }, later);
    expect(care.attentionItems()).toEqual([]);
    expect(care.listFeed(1)[0].title).toBe('Ponowny pomiar: ciśnienie 138/84 mmHg');
  });

  it('"źle się czuję" raises the urgent alert', () => {
    const care = newCare();
    const now = at('2026-09-29T09:00');
    care.health.addReading('manual', { metric: 'heart_rate', value: 138, measuredAt: now }, now, { atRest: true });
    care.health.answerCheck(care.health.openCheck(now)!.id, 'unwell', now);
    expect(care.attentionItems()[0]).toMatchObject({ kind: 'emergency', severity: 'urgent' });
  });

  it('a fast pulse while walking is not an alarm', () => {
    const care = newCare();
    const now = at('2026-09-29T15:30');
    care.health.importReading('demo', { metric: 'steps', value: 900, measuredAt: addMinutes(now, -5) });
    care.health.addReading('demo', { metric: 'heart_rate', value: 128, measuredAt: now }, now);
    expect(care.health.openCheck(now)).toBeNull();
    expect(care.attentionItems()).toEqual([]);
  });

  it('she decides what the family sees', () => {
    const care = newCare();
    const now = at('2026-09-29T09:00');
    care.health.setSharing('blood_pressure', false, now);
    expect(care.listFeed(1)[0].title).toBe('Mama nie udostępnia już: ciśnienie');
    care.health.addReading('manual', { metric: 'blood_pressure', value: 186, value2: 108, measuredAt: now }, now);
    care.health.addReading('manual', { metric: 'heart_rate', value: 74, measuredAt: now }, now);
    // She still gets her card, but nothing reaches the family.
    expect(care.health.openCheck(now)).not.toBeNull();
    expect(care.attentionItems()).toEqual([]);
    const family = care.familyState(aiStatus(), now).health;
    expect(family.latest.blood_pressure).toBeUndefined();
    expect(family.latest.heart_rate?.value).toBe(74);
    expect(family.days.at(-1)!.bpSys).toBeNull();
    expect(care.seniorState(aiStatus(), now).health.latest.blood_pressure?.value).toBe(186);
  });

  it('two sources never double the steps, and a repeated sync overwrites instead of adding', () => {
    const care = newCare();
    const now = at('2026-09-29T18:00');
    const day = startOfDay(now);
    care.health.importReading('google', { metric: 'steps', value: 4200, measuredAt: day });
    care.health.importReading('withings', { metric: 'steps', value: 3900, measuredAt: day });
    care.health.importReading('google', { metric: 'steps', value: 4600, measuredAt: day });
    expect(care.health.view('senior', now).today.steps).toBe(4600);
  });
});

describe('demo household and the agent', () => {
  it('the seed tells the week\'s story, and the agent sees it', () => {
    const care = newCare();
    const now = at('2026-09-29T11:00');
    seedDemo(care, now);
    const h = care.familyState(aiStatus(), now).health;
    expect(h.days).toHaveLength(7);
    expect(h.days.at(-1)!.date).toBe(dateKey(now));
    expect(h.sources.find((s) => s.id === 'demo')!.status).toBe('connected');
    expect(h.sources.find((s) => s.id === 'google')!.status).toBe('not_configured');
    const texts = h.insights.map((i) => i.text);
    expect(texts.some((t) => t.startsWith('Wczoraj mniej ruchu'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Ciśnienie:') && t.includes('Wizyta u kardiologa'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Dwie ostatnie noce'))).toBe(true);
    expect(h.latest.blood_pressure).toBeDefined();
    expect(h.today.sleepMin).toBeGreaterThan(300);
    // Seeding is quiet: no alerts from history.
    expect(care.attentionItems().filter((a) => a.kind === 'health')).toEqual([]);

    const context = contextBlock(care, now);
    expect(context).toContain('Zdrowie (opaska, ciśnieniomierz, jej pomiary):');
    expect(context).toMatch(/- Ciśnienie: \d+\/\d+ mmHg/);
  });

  it('she can tell the agent her measurement; implausible numbers are refused', async () => {
    const care = newCare();
    const now = at('2026-09-29T09:00');
    const record = tool(care, 'record_health_reading', now);
    expect(await record({ metric: 'blood_pressure', value: 145, diastolic: 90 })).toMatchObject({ ok: true, ocena: 'podwyższone', poziom: 'watch' });
    await expect(record({ metric: 'blood_pressure', value: 145 })).rejects.toThrow(/both numbers/);
    await expect(record({ metric: 'blood_pressure', value: 90, diastolic: 145 })).rejects.toThrow(/both numbers/);
    expect((await record({ metric: 'blood_pressure', value: 190, diastolic: 115 })).dalej).toContain('sto dwanaście');
    expect(care.health.openCheck(now)).not.toBeNull();
  });
});

describe('cloud providers', () => {
  it('reads Google Health API responses', () => {
    expect(parseGoogleSteps({ rollupDataPoints: [{ civilStartTime: { date: { year: 2026, month: 9, day: 28 } }, steps: { countSum: '5321' } }] })).toEqual([
      { metric: 'steps', value: 5321, measuredAt: new Date(2026, 8, 28) },
    ]);
    const hr = parseGoogleHeartRate({
      dataPoints: [
        { dataSource: { device: { displayName: 'Charge 6' } }, heartRate: { sampleTime: { physicalTime: '2026-09-29T07:01:00Z' }, bpm: 70 } },
        { heartRate: { sampleTime: { physicalTime: '2026-09-29T07:04:00Z' }, bpm: 74 } },
        { heartRate: { interval: { startTime: '2026-09-29T07:15:00Z', endTime: '2026-09-29T07:16:00Z' }, bpm: 90 } },
      ],
    });
    expect(hr.map((r) => r.value)).toEqual([72, 90]);
    expect(hr[0].device).toBe('Charge 6');
    expect(parseGoogleSpo2({ dataPoints: [{ oxygenSaturation: { sampleTime: { physicalTime: '2026-03-10T10:00:00Z' }, percentage: 98 } }] })[0]).toMatchObject({ metric: 'spo2', value: 98 });
    const sleep = parseGoogleSleep({
      dataPoints: [
        {
          sleep: {
            interval: { startTime: '2026-09-28T21:00:00Z', endTime: '2026-09-29T05:00:00Z' },
            stages: [
              { type: 'LIGHT', startTime: '2026-09-28T21:00:00Z' },
              { type: 'AWAKE', startTime: '2026-09-29T01:00:00Z' },
              { type: 'DEEP', startTime: '2026-09-29T01:30:00Z' },
            ],
          },
        },
      ],
    });
    expect(sleep[0]).toMatchObject({ metric: 'sleep', value: 450 });
  });

  it('reads Withings measure groups (value × 10^unit) and summaries', () => {
    const readings = parseWithingsMeasures({
      measuregrps: [
        { date: 1790000000, measures: [ { type: 10, value: 142, unit: 0 }, { type: 9, value: 88, unit: 0 }, { type: 11, value: 71, unit: 0 } ] },
        { date: 1790003600, measures: [{ type: 54, value: 965, unit: -1 }] },
      ],
    });
    expect(readings).toEqual([
      { metric: 'blood_pressure', value: 142, value2: 88, measuredAt: new Date(1790000000 * 1000), device: 'Withings' },
      { metric: 'heart_rate', value: 71, measuredAt: new Date(1790000000 * 1000), device: 'Withings' },
      { metric: 'spo2', value: 97, measuredAt: new Date(1790003600 * 1000), device: 'Withings' },
    ]);
    expect(parseWithingsActivity({ activities: [{ date: '2026-09-28', steps: 4012 }] })[0]).toMatchObject({ value: 4012, measuredAt: new Date(2026, 8, 28) });
    expect(parseWithingsSleep({ series: [{ enddate: 1790000000, data: { total_sleep_time: 25200 } }] })[0]).toMatchObject({ metric: 'sleep', value: 420 });
  });

  it('connects Withings with OAuth, imports history quietly and reacts only to fresh readings', async () => {
    vi.stubEnv('WITHINGS_CLIENT_ID', 'id');
    vi.stubEnv('WITHINGS_CLIENT_SECRET', 'secret');
    const care = newCare();
    const now = new Date();
    const url = new URL(care.health.beginOAuth('withings', 'http://localhost:5173/api/health/callback/withings'));
    expect(url.origin + url.pathname).toBe('https://account.withings.com/oauth2_user/authorize2');
    const state = url.searchParams.get('state')!;
    await expect(care.health.finishOAuth('withings', 'code', 'wrong', 'x')).rejects.toThrow(/stan logowania/);

    const fresh = Math.floor(now.getTime() / 1000) - 120;
    const old = Math.floor(addDays(now, -3).getTime() / 1000);
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const u = String(input);
      const body = new URLSearchParams(String(init?.body ?? ''));
      calls.push(`${u.replace('https://wbsapi.withings.net', '')} ${body.get('action')}`);
      const reply = (b: unknown) => new Response(JSON.stringify({ status: 0, body: b }), { status: 200 });
      if (u.endsWith('/v2/oauth2')) return reply({ userid: 42, access_token: 'a', refresh_token: 'r', expires_in: 10800 });
      if (u.endsWith('/v2/measure')) return reply({ activities: [{ date: dateKey(now), steps: 2100 }] });
      if (u.endsWith('/measure'))
        return reply({
          measuregrps: [
            { date: old, measures: [ { type: 10, value: 190, unit: 0 }, { type: 9, value: 112, unit: 0 } ] },
            { date: fresh, measures: [ { type: 10, value: 188, unit: 0 }, { type: 9, value: 111, unit: 0 } ] },
          ],
        });
      return reply({ series: [] });
    });

    // The state is single-use, so start again after the failed attempt.
    const state2 = new URL(care.health.beginOAuth('withings', 'x')).searchParams.get('state')!;
    expect(state2).not.toBe(state);
    await care.health.finishOAuth('withings', 'code', state2, 'x', now);
    expect(calls).toContain('/v2/oauth2 requesttoken');
    const source = care.health.sources(now).find((s) => s.id === 'withings')!;
    expect(source).toMatchObject({ status: 'connected', detail: 'Withings #42' });
    expect(care.health.view('family', now).today.steps).toBe(2100);
    // Only the fresh high reading raised a card; the old one is history.
    expect(care.attentionItems().filter((a) => a.kind === 'health')).toHaveLength(1);
  });

  it('a failed sync shows the error on the source instead of throwing', async () => {
    vi.stubEnv('GOOGLE_HEALTH_CLIENT_ID', 'id');
    vi.stubEnv('GOOGLE_HEALTH_CLIENT_SECRET', 'secret');
    const care = newCare();
    care.health.markSource('google', { status: 'connected', tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, account: null } });
    vi.stubGlobal('fetch', async () => new Response('{"error":{"code":403}}', { status: 403 }));
    expect(await care.health.sync('google')).toBe(0);
    expect(care.health.sources().find((s) => s.id === 'google')).toMatchObject({ status: 'error' });
    expect(care.health.sources().find((s) => s.id === 'google')!.detail).toContain('HTTP 403');
  });
});
