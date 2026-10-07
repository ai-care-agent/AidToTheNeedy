import { Router, type ErrorRequestHandler, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { runSeniorAgent } from './ai/agent';
import { startMorningCheckin } from './ai/briefing';
import { assessCall } from './ai/callGuard';
import { aiStatus } from './ai/client';
import { assessSms } from './ai/scamShield';
import { scanMedicine, ScanUnavailable } from './ai/medicineScan';
import { dailySummary } from './ai/summary';
import { audioFile, isSupportedAudio, saveAudio } from './audio';
import { type Care } from './care';
import { publishEvent } from './events';
import { GROCERY_PARTNER, groceryQuote } from './partners';
import { config } from './env';
import { contactIds, familyViewer, profile, seniorDid } from './profile';
import { tick } from './scheduler';
import { demoFamilyMessage, seedDemo, smsPresets } from './seed';
import { addDays, parseLocalDate, startOfDay, withTime } from './time';
import { acceptVideoCall, currentVideoCall, endVideoCall, relaySignal, startVideoCall } from './video';
import { getWeather } from './weather';
import { HEALTH_METRICS, type HealthMetric, type WeatherNow } from '../shared/types';
import { cloudProviders } from './health/providers';
import { GUIDE_KEYS, type GuideEvent } from '../shared/guide';

const ChatBody = z.object({
  text: z.string().trim().min(1).max(2000),
  image: z
    .object({
      mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      data: z.string().min(10),
    })
    .optional(),
});

const FamilyReminderBody = z.object({
  title: z.string().trim().min(1).max(200),
  date: z.string(),
  time: z.string(),
  category: z.enum(['medication', 'injection', 'appointment', 'other']),
  repeat: z.enum(['none', 'daily']).default('none'),
});

const Category = z.enum(['medication', 'injection', 'appointment', 'other']);
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm');

/** "O której?" for something done earlier today: never in the future, never before midnight. */
function doneTimeToday(time: string | undefined, now: Date): Date {
  if (!time) return now;
  const at = withTime(startOfDay(now), time)!;
  if (at > now) throw new z.ZodError([{ code: 'custom', path: ['time'], message: 'In the future', input: time }]);
  return at;
}

const FamilyEventBody = z.object({
  title: z.string().trim().min(1).max(200),
  date: z.string(),
  time: z.string(),
  location: z.string().trim().max(200).optional(),
  remindBeforeMin: z.number().int().min(0).max(1440).default(60),
});

const SmsBody = z.union([
  z.object({ presetId: z.string() }),
  z.object({ sender: z.string().trim().min(1).max(40), text: z.string().trim().min(1).max(1000) }),
]);

const VoiceBody = z.object({
  data: z.string().min(10).max(4_000_000),
  mimeType: z.string().refine(isSupportedAudio, 'unsupported audio type'),
  seconds: z.number().min(0.3).max(180),
  transcript: z.string().trim().max(2000).optional(),
  contactId: z.string().optional(),
});

const CallGuardBody = z.object({
  sessionId: z.string().regex(/^[\w-]{8,64}$/),
  transcript: z.string().trim().min(1).max(8000),
});

const Geo = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), accuracy: z.number().nonnegative().nullable() }).nullable().optional();

const ImageBody = z.object({ mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().min(10).max(12_000_000) });

const MedicineBody = z.object({
  name: z.string().trim().min(1).max(120),
  strength: z.string().trim().max(60).nullable().optional(),
  form: z.string().trim().max(60).nullable().optional(),
  instructions: z.string().trim().max(300).nullable().optional(),
  times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(6),
  doseUnits: z.number().positive().max(10).default(1),
  stock: z.number().int().min(0).max(1000).nullable().optional(),
  packSize: z.number().int().positive().max(1000).nullable().optional(),
});

const Side = z.enum(['senior', 'family']);

const Metric = z.enum(HEALTH_METRICS as [HealthMetric, ...HealthMetric[]]);

/** Plausible ranges only: a typo ("1500 na 90") is refused rather than raising an alarm. */
const ReadingBody = z
  .object({
    metric: z.enum(['heart_rate', 'blood_pressure', 'spo2', 'temperature']),
    value: z.number(),
    value2: z.number().nullable().optional(),
    device: z.string().trim().max(80).nullable().optional(),
  })
  .refine((r) => (r.metric === 'blood_pressure' ? r.value >= 50 && r.value <= 260 && r.value2 != null && r.value2 >= 30 && r.value2 <= 160 && r.value2 < r.value : true), 'implausible blood pressure')
  .refine((r) => (r.metric === 'heart_rate' ? r.value >= 25 && r.value <= 230 : true), 'implausible pulse')
  .refine((r) => (r.metric === 'spo2' ? r.value >= 50 && r.value <= 100 : true), 'implausible SpO2')
  .refine((r) => (r.metric === 'temperature' ? r.value >= 30 && r.value <= 43 : true), 'implausible body temperature');

const Cloud = z.enum(['google', 'withings']);
const redirectUri = (provider: string) => `${config.publicUrl}/api/health/callback/${provider}`;

const id = (req: Request) => z.coerce.number().int().positive().parse(req.params.id);
const callId = (req: Request) => z.string().uuid().parse(req.params.id);

function localDateTime(date: string, time: string): Date {
  const day = parseLocalDate(date);
  const at = day && withTime(day, time);
  if (!at) throw new z.ZodError([{ code: 'custom', path: ['date'], message: 'Invalid date or time', input: `${date} ${time}` }]);
  return at;
}

/** Stores an incoming SMS right away and lets Scam Shield judge it in the background. */
async function receiveSms(care: Care, sender: string, text: string): Promise<void> {
  const sms = care.addSms(sender, text);
  const assessment = await assessSms(sender, text);
  care.setSmsAssessment(sms.id, assessment);
  console.log(`[scam-shield] SMS ${sms.id} from ${sender}: ${assessment.verdict} (${assessment.analyzedBy})`);
}

export function apiRouter(care: Care): Router {
  const r = Router();

  // ------------------------------------------------------------ senior app

  r.get('/senior/state', (_req, res) => {
    res.json({ ...care.seniorState(aiStatus()), video: currentVideoCall() });
  });

  r.get('/senior/weather', async (_req, res) => {
    const w = await getWeather();
    if (!w) return void res.json(null);
    const aqi = w.air?.aqi ?? null;
    res.json({
      temp: w.now?.temp ?? null,
      description: w.now?.description ?? w.today.description,
      air: w.air ? `powietrze ${w.air.level}` : null,
      airLevel: aqi === null ? null : aqi < 40 ? 'good' : aqi < 60 ? 'moderate' : 'poor',
    } satisfies WeatherNow);
  });

  r.post('/senior/sos', (req, res) => {
    const { reason, geo } = z.object({ reason: z.enum(['button', 'fall', 'fall_help', 'help']), geo: Geo }).parse(req.body);
    res.json(care.sos(reason, geo ?? null));
  });

  r.post('/senior/fall-ok', (_req, res) => {
    care.fallDismissed();
    res.json({ ok: true });
  });

  r.post('/senior/safety/:id', (req, res) => {
    const { answer, geo } = z.object({ answer: z.enum(['ok', 'help']), geo: Geo }).parse(req.body);
    if (!care.answerSafetyCheck(id(req), answer, geo ?? null)) return void res.status(409).json({ error: 'already_answered' });
    res.json({ ok: true });
  });

  r.post('/senior/medicines/scan', async (req, res) => {
    care.touchActivity(new Date(), 'medicine');
    try {
      const proposal = await scanMedicine(ImageBody.parse(req.body));
      if (!proposal) return void res.status(422).json({ error: 'not_a_medicine', message: 'To nie wygląda na opakowanie leku. Proszę zrobić zdjęcie przodu opakowania albo etykiety z apteki.' });
      res.json(proposal);
    } catch (err) {
      if (err instanceof ScanUnavailable) return void res.status(503).json({ error: 'unavailable', message: err.message });
      throw err;
    }
  });

  r.post('/senior/medicines', (req, res) => {
    res.json(care.addMedicine({ ...MedicineBody.parse(req.body), createdBy: 'senior' }));
  });

  r.post('/senior/medicines/:id/refill', (req, res) => {
    care.touchActivity(new Date(), 'order');
    const order = care.orderRefill(id(req));
    if (!order) return void res.status(404).json({ error: 'not_found' });
    res.json(order);
  });

  r.post('/senior/medicines/:id/snooze-refill', (req, res) => {
    care.snoozeRefill(id(req));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ health

  r.post('/senior/health/readings', (req, res) => {
    const { source, ...body } = ReadingBody.and(z.object({ source: z.enum(['manual', 'bluetooth']).default('manual') })).parse(req.body);
    if (source === 'bluetooth') care.health.markSource('bluetooth', { status: 'connected', detail: body.device ?? null, lastSyncAt: new Date() });
    res.json(care.health.addReading(source, { metric: body.metric, value: body.value, value2: body.value2 ?? null, measuredAt: new Date(), device: body.device ?? null }));
  });

  /** A Bluetooth band streaming the pulse from her phone. */
  r.post('/senior/health/live', (req, res) => {
    const { bpm, device } = z.object({ bpm: z.number().min(25).max(230), device: z.string().trim().max(80).nullable().optional() }).parse(req.body);
    care.health.livePulse('bluetooth', bpm, device ?? null);
    res.json({ ok: true });
  });

  r.post('/senior/health/checks/:id', (req, res) => {
    const { answer } = z.object({ answer: z.enum(['ok', 'remeasure', 'unwell']) }).parse(req.body);
    if (!care.health.answerCheck(id(req), answer)) return void res.status(409).json({ error: 'already_answered' });
    res.json({ ok: true });
  });

  r.post('/senior/health/sharing', (req, res) => {
    const { metric, shared } = z.object({ metric: Metric, shared: z.boolean() }).parse(req.body);
    care.health.setSharing(metric, shared);
    res.json(care.health.sharing());
  });

  r.post('/family/health/thresholds', (req, res) => {
    const patch = z
      .object({
        hrHigh: z.number().int().min(90).max(180),
        hrLow: z.number().int().min(30).max(60),
        sysHigh: z.number().int().min(140).max(220),
        diaHigh: z.number().int().min(85).max(140),
        sysLow: z.number().int().min(70).max(110),
        spo2Low: z.number().int().min(80).max(95),
        tempHigh: z.number().min(37.5).max(39.5),
        stepsGoal: z.number().int().min(500).max(20000),
      })
      .partial()
      .parse(req.body);
    res.json(care.health.setThresholds(patch));
  });

  r.post('/family/health/sources/demo/connect', (_req, res) => {
    care.health.markSource('demo', { status: 'connected', detail: 'Opaska demo · Ciśnieniomierz demo', lastSyncAt: new Date() });
    res.json({ ok: true });
  });

  r.post('/family/health/sources/:source/disconnect', (req, res) => {
    care.health.disconnect(z.enum(['demo', 'bluetooth', 'google', 'withings']).parse(req.params.source));
    res.json({ ok: true });
  });

  r.post('/family/health/sources/:source/sync', async (req, res) => {
    res.json({ readings: await care.health.sync(Cloud.parse(req.params.source)) });
  });

  // OAuth: the Family App opens this in the browser; the provider sends her back to the callback.
  r.get('/health/connect/:source', (req, res) => {
    const provider = Cloud.parse(req.params.source);
    if (!cloudProviders[provider].configured()) return void res.redirect(`${config.publicUrl}/family?health=not_configured`);
    res.redirect(care.health.beginOAuth(provider, redirectUri(provider)));
  });

  r.get('/health/callback/:source', async (req, res) => {
    const provider = Cloud.parse(req.params.source);
    const { code, state, error } = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).parse(req.query);
    if (error || !code || !state) return void res.redirect(`${config.publicUrl}/family?health=denied`);
    try {
      await care.health.finishOAuth(provider, code, state, redirectUri(provider));
      res.redirect(`${config.publicUrl}/family?health=connected`);
    } catch (err) {
      console.error(`[health] ${provider} connect failed:`, err instanceof Error ? err.message : err);
      res.redirect(`${config.publicUrl}/family?health=error`);
    }
  });

  r.post('/senior/hello', (_req, res) => {
    care.touchActivity(new Date(), 'app_open');
    res.json({ ok: true });
  });

  r.post('/senior/voice', (req, res) => {
    const body = VoiceBody.parse(req.body);
    const contactId = z.enum(contactIds).parse(body.contactId ?? contactIds[0]);
    care.touchActivity(new Date(), 'voice_message');
    const file = saveAudio(body.data, body.mimeType);
    res.json(care.sendToFamily(contactId, body.transcript ?? '', false, new Date(), { file, seconds: body.seconds }));
  });

  r.post('/senior/orders/:id/confirm', (req, res) => {
    care.touchActivity(new Date(), 'order');
    const order = care.confirmOrder(id(req));
    if (!order) return void res.status(409).json({ error: 'not_awaiting_confirmation' });
    res.json(order);
  });

  r.post('/senior/orders/:id/decline', (req, res) => {
    care.touchActivity(new Date(), 'order');
    const order = care.declineOrder(id(req), 'senior');
    if (!order) return void res.status(409).json({ error: 'not_pending' });
    res.json(order);
  });

  r.post('/senior/orders/:id/seen', (req, res) => {
    care.markOrderSeen(id(req));
    res.json({ ok: true });
  });

  r.post('/senior/call-guard', async (req, res) => {
    const { sessionId, transcript } = CallGuardBody.parse(req.body);
    const verdict = await assessCall(care, transcript);
    if (verdict.level === 'scam') care.callGuardAlert(sessionId, verdict.reason);
    res.json(verdict);
  });

  r.post('/senior/chat', async (req, res) => {
    res.json(await runSeniorAgent(care, ChatBody.parse(req.body)));
  });

  r.post('/senior/reminders/:id/done', (req, res) => {
    const now = new Date();
    const { time } = z.object({ time: Time.optional() }).parse(req.body ?? {});
    care.touchActivity(now, 'reminder');
    const reminder = care.completeReminder(id(req), 'senior', now, doneTimeToday(time, now));
    if (!reminder) return void res.status(404).json({ error: 'not_found' });
    res.json(reminder);
  });

  // ------------------------------------------------------------ her plan for the day, by hand

  r.post('/senior/reminders/:id/undo', (req, res) => {
    const reminder = care.undoReminder(id(req), 'senior');
    if (!reminder) return void res.status(409).json({ error: 'not_done' });
    res.json(reminder);
  });

  const PlanEdit = z.object({ title: z.string().trim().min(1).max(200).optional(), time: Time.optional(), category: Category.optional() });

  r.post('/senior/reminders/:id/edit', (req, res) => {
    const reminder = care.updateReminder(id(req), PlanEdit.parse(req.body), 'senior');
    if (!reminder) return void res.status(404).json({ error: 'not_found' });
    res.json(reminder);
  });

  r.post('/senior/reminders/:id/cancel', (req, res) => {
    const { scope } = z.object({ scope: z.enum(['today', 'all']).default('all') }).parse(req.body ?? {});
    const done = scope === 'today' ? care.skipOccurrence(id(req), 'senior') : care.cancelReminder(id(req), 'senior');
    if (!done) return void res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  /**
   * She adds something to today's plan. `done` logs what already happened ("wzięłam tabletkę
   * przeciwbólową o 14:00"): it is created and ticked at that time.
   */
  r.post('/senior/reminders', (req, res) => {
    const now = new Date();
    const body = z.object({ title: z.string().trim().min(1).max(200), category: Category, time: Time, repeat: z.enum(['none', 'daily']).default('none'), done: z.boolean().default(false) }).parse(req.body);
    let at = withTime(startOfDay(now), body.time)!;
    if (body.done) {
      if (at > now) return void res.status(400).json({ error: 'in_the_future' });
    } else if (at <= now) {
      // "Codziennie o 8:00" added in the afternoon starts tomorrow; a one-off in the past is refused.
      if (body.repeat !== 'daily') return void res.status(400).json({ error: 'in_the_past' });
      at = addDays(at, 1);
    }
    const reminder = care.createReminder({ title: body.title, category: body.category, at, repeat: body.repeat, createdBy: 'senior' }, now);
    care.touchActivity(now, 'reminder');
    res.json(body.done ? care.completeReminder(reminder.id, 'senior', now, at) : reminder);
  });

  r.post('/senior/tasks/:id/done', (req, res) => {
    care.touchActivity(new Date(), 'task');
    const task = care.completeTask(id(req), 'senior');
    if (!task) return void res.status(404).json({ error: 'not_found' });
    res.json(task);
  });

  r.post('/senior/tasks/:id/undo', (req, res) => {
    const task = care.reopenTask(id(req));
    if (!task) return void res.status(404).json({ error: 'not_found' });
    res.json(task);
  });

  r.post('/senior/water', (req, res) => {
    const { ml } = z.object({ ml: z.number().int().min(50).max(1000).default(250) }).parse(req.body ?? {});
    res.json(care.addWater(ml));
  });

  r.post('/senior/water/undo', (_req, res) => {
    res.json(care.removeLastWater());
  });

  r.post('/senior/reminders/:id/snooze', (req, res) => {
    care.touchActivity();
    const minutes = z.object({ minutes: z.number().int().min(1).max(240).default(10) }).parse(req.body ?? {}).minutes;
    const reminder = care.snoozeReminder(id(req), minutes);
    if (!reminder) return void res.status(409).json({ error: 'not_snoozable' });
    res.json(reminder);
  });

  r.post('/senior/messages/:id/read', (req, res) => {
    care.touchActivity();
    care.markMessageRead(id(req));
    res.json({ ok: true });
  });

  r.post('/senior/sms/:id/seen', (req, res) => {
    care.touchActivity();
    care.markSmsSeen(id(req));
    res.json({ ok: true });
  });

  r.post('/senior/sms/:id/read', (req, res) => {
    care.touchActivity();
    care.markSmsRead([id(req)]);
    res.json({ ok: true });
  });

  r.post('/senior/checkins/:id', (req, res) => {
    care.touchActivity(new Date(), 'checkin');
    const { mood } = z.object({ mood: z.enum(['good', 'ok', 'bad']) }).parse(req.body);
    if (!care.answerCheckin(id(req), mood)) return void res.status(409).json({ error: 'already_answered' });
    res.json({ ok: true });
  });

  r.post('/senior/call', (req, res) => {
    care.touchActivity(new Date(), 'call');
    const { contactId } = z.object({ contactId: z.enum(contactIds) }).parse(req.body);
    care.callRequest(contactId);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ family app

  r.get('/family/state', (_req, res) => {
    res.json({ ...care.familyState(aiStatus()), video: currentVideoCall() });
  });

  r.post('/family/medicines', (req, res) => {
    res.json(care.addMedicine({ ...MedicineBody.parse(req.body), createdBy: 'family' }));
  });

  // ------------------------------------------------------------ video calls (WebRTC signalling)

  r.post('/video/start', (req, res) => {
    const { from } = z.object({ from: Side }).parse(req.body);
    if (from === 'senior') care.touchActivity(new Date(), 'video');
    const started = startVideoCall(from, (missed) => {
      if (missed.from === 'family') care.addFeed('video_call', 'info', `${seniorDid('nie odebrał', 'nie odebrała')} połączenia wideo`, 'Spróbuj później albo zostaw wiadomość głosową.');
    });
    res.json(started);
  });

  r.post('/video/:id/accept', (req, res) => {
    const call = acceptVideoCall(callId(req));
    if (!call) return void res.status(409).json({ error: 'not_ringing' });
    if (call.from === 'family') care.touchActivity(new Date(), 'video');
    res.json(call);
  });

  r.post('/video/:id/end', (req, res) => {
    const { by, reason } = z.object({ by: Side, reason: z.enum(['declined', 'hangup', 'cancelled']) }).parse(req.body);
    const ended = endVideoCall(callId(req), by, reason);
    if (!ended) return void res.status(409).json({ error: 'not_active' });
    if (ended.seconds > 0) {
      const minutes = Math.max(1, Math.round(ended.seconds / 60));
      care.addFeed('video_call', 'success', `Rozmowa wideo z ${profile.familyCallsHerInstrumental}`, `${minutes} min`);
    }
    res.json({ ok: true });
  });

  r.post('/video/:id/signal', (req, res) => {
    const { from, data } = z.object({ from: Side, data: z.record(z.string(), z.unknown()) }).parse(req.body);
    if (JSON.stringify(data).length > 100_000 || !relaySignal(callId(req), from, data)) return void res.status(409).json({ error: 'no_call' });
    res.json({ ok: true });
  });

  r.post('/family/messages', (req, res) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(1000) }).parse(req.body);
    res.json(care.sendToSenior(familyViewer.id, text));
  });

  r.post('/family/reminders', (req, res) => {
    const body = FamilyReminderBody.parse(req.body);
    const now = new Date();
    let at = localDateTime(body.date, body.time);
    if (at <= now) {
      // "Every day at 08:00" entered in the afternoon means: starting tomorrow.
      if (body.repeat !== 'daily') return void res.status(400).json({ error: 'in_the_past' });
      while (at <= now) at = addDays(at, 1);
    }
    res.json(care.createReminder({ title: body.title, category: body.category, at, repeat: body.repeat, createdBy: 'family' }, now));
  });

  // ------------------------------------------------------------ her screen settings

  const Display = z.object({
    scale: z.number().int().min(100).max(175),
    theme: z.enum(['auto', 'dark', 'light', 'contrast']),
    bold: z.boolean(),
    reducedMotion: z.boolean(),
    speechRate: z.number().min(0.5).max(1.5),
    tapToRead: z.boolean(),
    // Added later: settings saved before them simply lack the fields.
    steadyTouch: z.boolean().default(false),
    flashAlerts: z.boolean().default(false),
  });

  r.post('/family/senior-display', (req, res) => {
    res.json(care.setSeniorDisplay(Display.parse(req.body.settings), 'family'));
  });

  r.post('/senior/display', (req, res) => {
    const { settings, undo } = z.object({ settings: Display, undo: z.boolean().optional() }).parse(req.body);
    res.json(care.setSeniorDisplay(settings, 'senior', { undo }));
  });

  // ------------------------------------------------------------ doctors and clinic

  const Phone = z.string().trim().max(30).regex(/^[+\d\s()-]*$/, 'phone number').nullable();
  const Text = (max: number) => z.string().trim().max(max).nullable();

  r.post('/family/care-team', (req, res) => {
    const body = z
      .object({
        clinic: z.object({ name: z.string().trim().min(1).max(80), address: Text(120), phone: Phone, hours: Text(80) }).nullable(),
        doctors: z
          .array(z.object({ id: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(80), specialty: z.string().trim().min(1).max(60), phone: Phone, place: Text(120) }))
          .max(8),
      })
      .parse(req.body);
    // Empty strings from the form mean "not given".
    const blank = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v])) as T;
    res.json(care.setCareTeam({ clinic: body.clinic ? blank(body.clinic) : null, doctors: body.doctors.map(blank) }));
  });

  // ------------------------------------------------------------ "Pokaż palcem"

  /** The daughter points at a button on Mom's screen; it lights up there. Nothing is stored. */
  r.post('/family/guide', (req, res) => {
    const { target } = z.object({ target: z.enum(GUIDE_KEYS) }).parse(req.body);
    publishEvent('guide', { target, from: familyViewer.name } satisfies GuideEvent);
    res.json({ ok: true });
  });

  r.post('/senior/guide/done', (req, res) => {
    const { target } = z.object({ target: z.enum(GUIDE_KEYS) }).parse(req.body);
    care.touchActivity(new Date(), 'guide');
    publishEvent('guide_done', { target });
    res.json({ ok: true });
  });

  /** She said on the phone that she took it: the daughter ticks it for her. */
  r.post('/family/reminders/:id/done', (req, res) => {
    const reminder = care.completeReminder(id(req), 'family');
    if (!reminder) return void res.status(404).json({ error: 'not_found' });
    res.json(reminder);
  });

  r.post('/family/reminders/:id/cancel', (req, res) => {
    const { scope } = z.object({ scope: z.enum(['today', 'all']).default('all') }).parse(req.body ?? {});
    const done = scope === 'today' ? care.skipOccurrence(id(req), 'family') : care.cancelReminder(id(req), 'family');
    if (!done) return void res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  });

  r.post('/family/reminders/:id/nudge', (req, res) => {
    const reminder = care.nudgeReminder(id(req));
    if (!reminder) return void res.status(409).json({ error: 'not_pending' });
    tick(care);
    res.json(reminder);
  });

  // ------------------------------------------------------------ moving or cancelling a visit

  const MoveBody = z.object({ date: z.string(), time: Time });

  const moveEvent = (by: 'senior' | 'family'): RequestHandler => (req, res) => {
    const { date, time } = MoveBody.parse(req.body);
    const startsAt = localDateTime(date, time);
    if (startsAt <= new Date()) return void res.status(400).json({ error: 'in_the_past' });
    const event = care.moveEvent(id(req), startsAt, by);
    if (!event) return void res.status(404).json({ error: 'not_found' });
    res.json(event);
  };

  const cancelEvent = (by: 'senior' | 'family'): RequestHandler => (req, res) => {
    const event = care.cancelEvent(id(req), by);
    if (!event) return void res.status(404).json({ error: 'not_found' });
    res.json(event);
  };

  r.post('/senior/events/:id/move', moveEvent('senior'));
  r.post('/senior/events/:id/cancel', cancelEvent('senior'));
  r.post('/family/events/:id/move', moveEvent('family'));
  r.post('/family/events/:id/cancel', cancelEvent('family'));

  r.post('/family/events', (req, res) => {
    const body = FamilyEventBody.parse(req.body);
    const startsAt = localDateTime(body.date, body.time);
    if (startsAt <= new Date()) return void res.status(400).json({ error: 'in_the_past' });
    res.json(care.createEvent({ title: body.title, startsAt, location: body.location || null, createdBy: 'family', remindBeforeMin: body.remindBeforeMin || null }));
  });

  r.post('/family/alerts/:id/ack', (req, res) => {
    care.ackFeed(id(req));
    res.json({ ok: true });
  });

  r.post('/family/voice', (req, res) => {
    const body = VoiceBody.parse(req.body);
    const file = saveAudio(body.data, body.mimeType);
    res.json(care.sendToSenior(familyViewer.id, body.transcript ?? '', new Date(), { file, seconds: body.seconds }));
  });

  r.post('/family/orders/:id/approve', (req, res) => {
    const order = care.approveOrder(id(req));
    if (!order) return void res.status(409).json({ error: 'not_awaiting_family' });
    res.json(order);
  });

  r.post('/family/orders/:id/decline', (req, res) => {
    const order = care.declineOrder(id(req), 'family');
    if (!order) return void res.status(409).json({ error: 'not_pending' });
    res.json(order);
  });

  r.get('/family/summary', async (_req, res) => {
    res.json(await dailySummary(care));
  });

  r.get('/audio/:name', (req, res) => {
    const file = audioFile(String(req.params.name));
    if (!file) return void res.status(404).end();
    res.type(file.contentType).sendFile(file.path);
  });

  // ------------------------------------------------------------ demo controls

  r.get('/demo/status', (_req, res) => {
    res.json({
      now: new Date().toISOString(),
      tz: config.tz,
      ai: aiStatus(),
      escalateAfterMin: config.escalateAfterMin,
      safetyCheckHours: config.safetyCheckHours,
      safetyEscalateMin: config.safetyEscalateMin,
      spendingLimit: config.spendingLimit,
      presets: smsPresets,
      demoFamilyMessage,
    });
  });

  r.post('/demo/sms', (req, res) => {
    const body = SmsBody.parse(req.body);
    const sms = 'presetId' in body ? smsPresets.find((p) => p.id === body.presetId) : body;
    if (!sms) return void res.status(404).json({ error: 'unknown_preset' });
    receiveSms(care, sms.sender, sms.text).catch((err) => console.error('[scam-shield]', err));
    res.json({ ok: true });
  });

  r.post('/demo/medication-now', (_req, res) => {
    const reminder = care.createReminder({ title: 'Witamina D', category: 'medication', at: new Date(), createdBy: 'family', announce: false });
    tick(care);
    res.json(reminder);
  });

  r.post('/demo/fall', (_req, res) => {
    publishEvent('safety', { type: 'fall' });
    res.json({ ok: true });
  });

  r.post('/demo/safety-check', (_req, res) => {
    res.json(care.createSafetyCheck('manual'));
  });

  r.post('/demo/low-stock', (_req, res) => {
    const medicine = care.listMedicines().find((m) => m.stock !== null && !m.lowStock) ?? care.listMedicines()[0];
    if (!medicine) return void res.status(404).json({ error: 'no_medicines' });
    care.setMedicineStock(medicine.id, Math.max(1, medicine.times.length * medicine.doseUnits * 4));
    res.json(care.getMedicine(medicine.id));
  });

  r.post('/demo/escalate', (_req, res) => {
    const due = care.dueReminders().filter((rem) => !rem.escalatedAt);
    for (const rem of due) care.escalateReminder(rem.id);
    res.json({ escalated: due.length });
  });

  r.post('/demo/checkin', async (_req, res) => {
    await startMorningCheckin(care);
    res.json({ ok: true });
  });

  r.post('/demo/order', (req, res) => {
    const { size } = z.object({ size: z.enum(['list', 'large']) }).parse(req.body);
    const now = new Date();
    const list = care.openTasks().find((t) => t.kind === 'shopping' && t.shareWithFamily);
    const items =
      size === 'list' && list?.items.length
        ? list.items
        : ['kawa', 'miód', 'kurczak', 'szynka', 'ser', 'masło', 'jajka', 'pomidory', 'banany', 'woda mineralna', 'płatki owsiane', 'karma dla kota', 'sok jabłkowy', 'herbata'];
    const quote = groceryQuote(items, now);
    res.json(care.createOrder({ kind: 'groceries', title: size === 'list' ? 'Zakupy z dostawą' : 'Duże zakupy na tydzień', ...quote, partner: GROCERY_PARTNER, taskId: size === 'list' ? (list?.id ?? null) : null }, now));
  });

  r.post('/demo/family-message', (req, res) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(1000).optional() }).parse(req.body ?? {});
    res.json(care.sendToSenior(familyViewer.id, text ?? demoFamilyMessage));
  });

  /** The slider in the demo panel: a reading "from the cuff or band" with any value. */
  r.post('/demo/health/reading', (req, res) => {
    const body = ReadingBody.parse(req.body);
    res.json(care.health.addReading('demo', { metric: body.metric, value: body.value, value2: body.value2 ?? null, measuredAt: new Date(), device: body.metric === 'blood_pressure' ? 'Ciśnieniomierz demo' : body.metric === 'temperature' ? 'Termometr demo' : 'Opaska demo' }, new Date(), { atRest: true }));
  });

  /** "Automatycznie" at noon: shows the evening (or day) look on both phones for two minutes. */
  r.post('/demo/theme-preview', (req, res) => {
    const { theme } = z.object({ theme: z.enum(['light', 'dark']).nullable() }).parse(req.body);
    publishEvent('theme_preview', { theme });
    res.json({ ok: true });
  });

  /** Opens "Dopasuj ekran" on her phone, as on the first start. */
  r.post('/demo/screen-setup', (_req, res) => {
    publishEvent('screen_setup', {});
    res.json({ ok: true });
  });

  r.post('/demo/reset', (_req, res) => {
    seedDemo(care);
    tick(care);
    res.json({ ok: true });
  });

  r.use(((err, _req, res, _next) => {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: 'invalid_request', issues: err.issues });
    console.error('[api]', err);
    res.status(500).json({ error: 'internal_error' });
  }) satisfies ErrorRequestHandler);

  return r;
}
