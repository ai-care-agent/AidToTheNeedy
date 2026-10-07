import { randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import type {
  Actor,
  AiStatus,
  CalendarEvent,
  CareTeam,
  Checkin,
  DisplaySettings,
  DoseStatus,
  FamilyMessage,
  FamilyState,
  FeedItem,
  FeedKind,
  FeedSeverity,
  GeoPoint,
  Insight,
  InsightDay,
  Medicine,
  Mood,
  Order,
  OrderKind,
  OrderStatus,
  Reminder,
  ReminderCategory,
  ReminderStatus,
  SafetyCheck,
  SeniorDisplay,
  SeniorState,
  Sms,
  SmsVerdict,
  SunTimes,
  Task,
  TimelineItem,
  WaterToday,
  WeeklyInsights,
} from '../shared/types';
import { clearAll, type DB } from './db';
import { config } from './env';
import { Health } from './health';
import { actorDid, contactById, contacts, familyViewer, household, profile, seniorDid } from './profile';
import { sunTimes } from './sun';
import { orderReference, pharmacyQuote, PHARMACY_PARTNER } from './partners';
import { addDays, addMinutes, dateKey, dayLabel, endOfDay, hhmm, relativeWhen, shortDate, startOfDay, withTime } from './time';

const iso = (d: Date) => d.toISOString();

/** A reminder that fires this late (e.g. the server was off) is recorded as missed instead of popping up. */
const STALE_AFTER_HOURS = 6;
/** An unanswered wellbeing question disappears from the senior's screen after this long. */
const CHECKIN_TTL_HOURS = 3;

interface ReminderRow {
  id: number;
  title: string;
  category: string;
  planned_at: string;
  due_at: string;
  repeat: string;
  status: string;
  created_by: string;
  series_id: string | null;
  /** HH:mm of a daily series, so a DST-shifted occurrence doesn't move the next ones. */
  series_time: string | null;
  event_id: number | null;
  medicine_id: number | null;
  first_fired_at: string | null;
  done_at: string | null;
  escalated_at: string | null;
  next_spawned: number;
  share_with_family: number;
}

interface EventRow {
  id: number;
  title: string;
  starts_at: string;
  location: string | null;
  notes: string | null;
  status: string;
  created_by: string;
  share_with_family: number;
}

interface TaskRow {
  id: number;
  title: string;
  kind: string;
  items: string;
  due_date: string | null;
  status: string;
  created_by: string;
  share_with_family: number;
  done_at: string | null;
}

interface MessageRow {
  id: number;
  direction: string;
  contact_id: string;
  text: string;
  urgent: number;
  audio_file: string | null;
  audio_seconds: number | null;
  created_at: string;
  read_at: string | null;
}

interface SmsRow {
  id: number;
  sender: string;
  text: string;
  received_at: string;
  verdict: string;
  category: string | null;
  reasons: string;
  advice: string | null;
  analyzed_by: string | null;
  senior_seen_at: string | null;
  read_at: string | null;
}

interface FeedRow {
  id: number;
  kind: string;
  severity: string;
  title: string;
  detail: string | null;
  ref: string | null;
  media_url: string | null;
  geo: string | null;
  created_at: string;
  acknowledged_at: string | null;
}

interface MedicineRow {
  id: number;
  name: string;
  strength: string | null;
  form: string | null;
  instructions: string | null;
  times: string;
  dose_units: number;
  stock: number | null;
  pack_size: number | null;
  low_alerted_at: string | null;
  refill_snoozed_until: string | null;
}

interface SafetyRow {
  id: number;
  reason: string;
  asked_at: string;
  answered_at: string | null;
  escalated_at: string | null;
}

interface CheckinRow {
  id: number;
  asked_at: string;
  answered_at: string | null;
  mood: string | null;
  briefing: string | null;
}

interface OrderRow {
  id: number;
  kind: string;
  status: string;
  title: string;
  lines: string;
  total: number;
  partner: string;
  eta: string | null;
  pickup_at: string | null;
  destination: string | null;
  reference: string | null;
  task_id: number | null;
  medicine_id: number | null;
  created_at: string;
  decided_at: string | null;
  declined_by: string | null;
  senior_seen_at: string | null;
}

const toReminder = (r: ReminderRow): Reminder => ({
  id: r.id,
  title: r.title,
  category: r.category as ReminderCategory,
  plannedAt: r.planned_at,
  dueAt: r.due_at,
  repeat: r.repeat === 'daily' ? 'daily' : 'none',
  status: r.status as ReminderStatus,
  createdBy: r.created_by as Actor,
  firstFiredAt: r.first_fired_at,
  doneAt: r.done_at,
  escalatedAt: r.escalated_at,
  eventId: r.event_id,
  shareWithFamily: r.share_with_family === 1,
});

const toEvent = (r: EventRow): CalendarEvent => ({
  id: r.id,
  title: r.title,
  startsAt: r.starts_at,
  location: r.location,
  notes: r.notes,
  status: r.status as CalendarEvent['status'],
  createdBy: r.created_by as Actor,
  shareWithFamily: r.share_with_family === 1,
});

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  title: r.title,
  kind: r.kind === 'shopping' ? 'shopping' : 'other',
  items: JSON.parse(r.items) as string[],
  dueDate: r.due_date,
  status: r.status === 'done' ? 'done' : 'open',
  createdBy: r.created_by as Actor,
  doneAt: r.done_at,
  shareWithFamily: r.share_with_family === 1,
});

const toMessage = (r: MessageRow): FamilyMessage => ({
  id: r.id,
  direction: r.direction as FamilyMessage['direction'],
  contactId: r.contact_id,
  text: r.text,
  urgent: r.urgent === 1,
  audioUrl: r.audio_file ? `/api/audio/${r.audio_file}` : null,
  audioSeconds: r.audio_seconds,
  createdAt: r.created_at,
  readAt: r.read_at,
});

const toSms = (r: SmsRow): Sms => ({
  id: r.id,
  sender: r.sender,
  text: r.text,
  receivedAt: r.received_at,
  verdict: r.verdict as SmsVerdict,
  category: r.category,
  reasons: JSON.parse(r.reasons) as string[],
  advice: r.advice,
  analyzedBy: r.analyzed_by as Sms['analyzedBy'],
  seniorSeenAt: r.senior_seen_at,
  readAt: r.read_at,
});

const toFeed = (r: FeedRow): FeedItem => ({
  id: r.id,
  kind: r.kind as FeedKind,
  severity: r.severity as FeedSeverity,
  title: r.title,
  detail: r.detail,
  createdAt: r.created_at,
  acknowledgedAt: r.acknowledged_at,
  needsAttention: (r.severity === 'warning' || r.severity === 'urgent') && r.acknowledged_at === null,
  mediaUrl: r.media_url,
  orderId: r.kind === 'order_needs_approval' && r.ref?.startsWith('order:') ? Number(r.ref.slice(6)) : null,
  geo: r.geo ? (JSON.parse(r.geo) as GeoPoint) : null,
});

/** A refill is suggested when the stock covers this many days or fewer. */
const LOW_STOCK_DAYS = 7;

const toMedicine = (r: MedicineRow): Medicine => {
  const times = JSON.parse(r.times) as string[];
  const perDay = r.dose_units * times.length;
  const daysLeft = r.stock !== null && perDay > 0 ? Math.floor(r.stock / perDay) : null;
  return {
    id: r.id,
    name: r.name,
    strength: r.strength,
    form: r.form,
    instructions: r.instructions,
    times,
    doseUnits: r.dose_units,
    stock: r.stock,
    packSize: r.pack_size,
    daysLeft,
    lowStock: daysLeft !== null && daysLeft <= LOW_STOCK_DAYS,
  };
};

const toSafety = (r: SafetyRow): SafetyCheck => ({ id: r.id, reason: r.reason as SafetyCheck['reason'], askedAt: r.asked_at });

/** "Leki poranne", "Leki wieczorne"… — how the daily card names a dose. */
export function doseSlotName(time: string): string {
  const h = Number(time.slice(0, 2));
  if (h < 11) return 'Leki poranne';
  if (h < 16) return 'Leki w południe';
  return 'Leki wieczorne';
}

const toCheckin = (r: CheckinRow): Checkin => ({
  id: r.id,
  askedAt: r.asked_at,
  answeredAt: r.answered_at,
  mood: r.mood as Mood | null,
  briefing: r.briefing,
});

const toOrder = (r: OrderRow): Order => ({
  id: r.id,
  kind: r.kind as OrderKind,
  status: r.status as OrderStatus,
  title: r.title,
  lines: JSON.parse(r.lines) as Order['lines'],
  total: r.total,
  partner: r.partner,
  // Stored as a window start plus a time label, so "jutro" is never read the day after.
  eta: r.pickup_at ? `${dayLabel(new Date(r.pickup_at), new Date())} ${r.eta ?? ''}`.trim() : r.eta,
  destination: r.destination,
  reference: r.reference,
  needsFamilyApproval: r.total > config.spendingLimit,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
  declinedBy: r.declined_by as Actor | null,
});

/** "86,40 zł" */
export const money = (value: number) => `${value.toFixed(2).replace('.', ',')} zł`;

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}

const WEEKDAY_SHORT = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];

export interface NewReminder {
  title: string;
  category: ReminderCategory;
  at: Date;
  repeat?: 'none' | 'daily';
  createdBy: Actor;
  eventId?: number | null;
  medicineId?: number | null;
  shareWithFamily?: boolean;
  /** Post "X added a reminder" to the family feed (default true). */
  announce?: boolean;
}

export interface NewEvent {
  title: string;
  startsAt: Date;
  location?: string | null;
  notes?: string | null;
  createdBy: Actor;
  shareWithFamily?: boolean;
  /** Also create an appointment reminder this many minutes before (null = none). */
  remindBeforeMin?: number | null;
  announce?: boolean;
}

export interface NewTask {
  title: string;
  kind: 'shopping' | 'other';
  items?: string[];
  dueDate?: string | null;
  createdBy: Actor;
  shareWithFamily?: boolean;
  announce?: boolean;
}

export interface VoiceAttachment {
  file: string;
  seconds: number;
}

export interface NewOrder {
  kind: OrderKind;
  title: string;
  lines: { name: string; price: number }[];
  total: number;
  partner: string;
  windowStart: Date;
  windowLabel: string;
  destination?: string | null;
  taskId?: number | null;
  medicineId?: number | null;
}

/** An unanswered consent card is withdrawn after this long, so yesterday's question never pops up. */
const ORDER_CONSENT_TTL_HOURS = 3;

export interface SmsAssessment {
  verdict: Exclude<SmsVerdict, 'pending'>;
  category: string | null;
  reasons: string[];
  advice: string;
  summaryForFamily: string;
  analyzedBy: 'model' | 'heuristic';
}

/** Hours between two moments that fall between 08:00 and 21:00 — silence at night is normal. */
export function daytimeHoursBetween(from: Date, to: Date): number {
  let ms = 0;
  for (let day = startOfDay(from); day <= to; day = addDays(day, 1)) {
    const start = Math.max(withTime(day, '08:00')!.getTime(), from.getTime());
    const end = Math.min(withTime(day, '21:00')!.getTime(), to.getTime());
    if (end > start) ms += end - start;
  }
  return ms / 3_600_000;
}

/** Doses are what the family is told about when one isn't confirmed: medicines and injections. */
export const isDose = (c: ReminderCategory) => c === 'medication' || c === 'injection';

const DOSE_WORDS: Record<'medication' | 'injection', { missed: string; done: string }> = {
  medication: { missed: 'Leki niepotwierdzone', done: 'Leki przyjęte' },
  injection: { missed: 'Zastrzyk niepotwierdzony', done: 'Zastrzyk wykonany' },
};

/** 1,5 l — water is counted in glasses but read in litres. */
const litres = (ml: number) => `${(ml / 1000).toFixed(1).replace('.', ',')} l`;

const WATER_GOAL_ML = 1500;
const GLASS_ML = 250;

/**
 * The household's state and every business rule on top of it.
 * All mutations call `onChange` so the server can push updates to the open apps.
 */
export class Care {
  /** Bands, cuffs and manual readings: pulse, blood pressure, steps, sleep, SpO2. */
  readonly health: Health;

  constructor(
    private readonly db: DB,
    private readonly onChange: () => void = () => {},
  ) {
    this.health = new Health(db, this, onChange);
  }

  // ---------------------------------------------------------------- SQL helpers

  private all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as unknown as T[];
  }

  private one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as unknown as T | undefined;
  }

  private run(sql: string, ...params: SQLInputValue[]): number {
    return Number(this.db.prepare(sql).run(...params).lastInsertRowid);
  }

  /** Like run(), but returns the number of changed rows. */
  private exec(sql: string, ...params: SQLInputValue[]): number {
    return Number(this.db.prepare(sql).run(...params).changes);
  }

  reset(): void {
    clearAll(this.db);
    this.onChange();
  }

  // ---------------------------------------------------------------- reminders

  createReminder(input: NewReminder, now = new Date()): Reminder {
    const repeat = input.repeat ?? 'none';
    const id = this.run(
      `INSERT INTO reminders (title, category, planned_at, due_at, repeat, created_by, series_id, series_time, event_id, medicine_id, share_with_family, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.title,
      input.category,
      iso(input.at),
      iso(input.at),
      repeat,
      input.createdBy,
      repeat === 'daily' ? randomUUID() : null,
      repeat === 'daily' ? hhmm(input.at) : null,
      input.eventId ?? null,
      input.medicineId ?? null,
      input.shareWithFamily === false ? 0 : 1,
      iso(now),
    );
    const reminder = this.getReminder(id)!;
    if (input.announce !== false && reminder.shareWithFamily) {
      const repeatNote = repeat === 'daily' ? ' (codziennie)' : '';
      this.addFeed('reminder_created', 'info', `${actorDid(input.createdBy, 'dodał', 'dodała')} przypomnienie`, `${reminder.title} — ${relativeWhen(input.at, now)}${repeatNote}`, null, now);
    }
    this.onChange();
    return reminder;
  }

  getReminder(id: number): Reminder | null {
    const row = this.one<ReminderRow>('SELECT * FROM reminders WHERE id = ?', id);
    return row ? toReminder(row) : null;
  }

  listReminders(from: Date, to: Date): Reminder[] {
    return this.all<ReminderRow>(
      `SELECT * FROM reminders WHERE planned_at BETWEEN ? AND ? AND status != 'cancelled' ORDER BY planned_at`,
      iso(from),
      iso(to),
    ).map(toReminder);
  }

  dueReminders(): Reminder[] {
    return this.all<ReminderRow>(`SELECT * FROM reminders WHERE status = 'due' ORDER BY due_at`).map(toReminder);
  }

  remindersToFire(now: Date): Reminder[] {
    return this.all<ReminderRow>(`SELECT * FROM reminders WHERE status = 'scheduled' AND due_at <= ? ORDER BY due_at`, iso(now)).map(toReminder);
  }

  fireReminder(id: number, now = new Date()): void {
    const r = this.getReminder(id);
    if (!r || r.status !== 'scheduled') return;
    const lateHours = (now.getTime() - Date.parse(r.dueAt)) / 3_600_000;
    if (lateHours > STALE_AFTER_HOURS) {
      this.run(`UPDATE reminders SET status = 'missed' WHERE id = ?`, id);
    } else {
      this.run(`UPDATE reminders SET status = 'due', first_fired_at = COALESCE(first_fired_at, ?) WHERE id = ?`, iso(now), id);
    }
    this.ensureNextOccurrence(id, now);
    this.onChange();
  }

  /**
   * A card nobody answered for hours is recorded as missed, so it cannot hide newer
   * reminders (the family alert from the escalation stays until acknowledged).
   */
  expireStaleDue(now: Date): number {
    const changed = this.exec(`UPDATE reminders SET status = 'missed' WHERE status = 'due' AND first_fired_at <= ?`, iso(addMinutes(now, -STALE_AFTER_HOURS * 60)));
    if (changed) this.onChange();
    return changed;
  }

  remindersToEscalate(now: Date, afterMinutes: number): Reminder[] {
    return this.all<ReminderRow>(
      `SELECT * FROM reminders WHERE status = 'due' AND escalated_at IS NULL AND first_fired_at <= ?`,
      iso(addMinutes(now, -afterMinutes)),
    ).map(toReminder);
  }

  escalateReminder(id: number, now = new Date()): void {
    const r = this.getReminder(id);
    if (!r || r.escalatedAt) return;
    this.run('UPDATE reminders SET escalated_at = ? WHERE id = ?', iso(now), id);
    if (r.shareWithFamily) {
      const planned = hhmm(new Date(r.plannedAt));
      if (r.category === 'medication' || r.category === 'injection') {
        this.addFeed('medication_missed', 'warning', `${DOSE_WORDS[r.category].missed}: ${r.title}`, `Zaplanowane na ${planned} — brak potwierdzenia. Warto zadzwonić.`, `reminder:${id}`, now);
      } else {
        this.addFeed('reminder_missed', 'info', `Przypomnienie bez potwierdzenia: ${r.title}`, `Zaplanowane na ${planned}.`, `reminder:${id}`, now);
      }
    }
    this.onChange();
  }

  /** `doneAt`: when she actually did it, if not just now ("wzięłam o ósmej"). */
  completeReminder(id: number, by: Actor, now = new Date(), doneAt = now): Reminder | null {
    const r = this.getReminder(id);
    if (!r) return null;
    if (r.status === 'done' || r.status === 'cancelled') return r;
    this.run(`UPDATE reminders SET status = 'done', done_at = ? WHERE id = ?`, iso(doneAt), id);
    this.ensureNextOccurrence(id, now);
    const medicineId = this.one<ReminderRow>('SELECT * FROM reminders WHERE id = ?', id)!.medicine_id;
    if (medicineId) this.takeDose(medicineId, now);
    this.ackByRef(`reminder:${id}`, now);
    if (r.eventId) this.run(`UPDATE events SET status = 'confirmed' WHERE id = ? AND status = 'planned'`, r.eventId);
    if (r.shareWithFamily) {
      const late = r.escalatedAt ? ' (z opóźnieniem)' : '';
      const who = by === 'family' ? ` przez: ${familyViewer.name}` : by === 'agent' ? ' (głosowo)' : '';
      if (r.category === 'medication' || r.category === 'injection') {
        this.addFeed('medication_taken', 'success', `${DOSE_WORDS[r.category].done}: ${r.title}`, `Potwierdzone o ${hhmm(doneAt)}${late}${who}.`, null, now);
      } else {
        this.addFeed('reminder_done', 'success', `Wykonane: ${r.title}`, `Potwierdzone o ${hhmm(doneAt)}${late}${who}.`, null, now);
      }
    }
    this.onChange();
    return this.getReminder(id);
  }

  /**
   * "Odznacz": a tap by mistake. The dose goes back to the apteczka and the reminder comes back
   * in ten minutes (not at once — she has just looked at it).
   */
  undoReminder(id: number, by: Actor, now = new Date()): Reminder | null {
    const row = this.one<ReminderRow>('SELECT * FROM reminders WHERE id = ?', id);
    if (!row || row.status !== 'done') return null;
    const planned = new Date(row.planned_at);
    if (planned > now) {
      this.run(`UPDATE reminders SET status = 'scheduled', done_at = NULL, due_at = planned_at, first_fired_at = NULL WHERE id = ?`, id);
    } else {
      this.run(`UPDATE reminders SET status = 'scheduled', done_at = NULL, due_at = ?, first_fired_at = COALESCE(first_fired_at, ?) WHERE id = ?`, iso(addMinutes(now, 10)), iso(now), id);
    }
    if (row.medicine_id) this.run('UPDATE medicines SET stock = stock + dose_units WHERE id = ? AND stock IS NOT NULL', row.medicine_id);
    if (row.share_with_family) {
      this.addFeed('reminder_cancelled', 'info', `${actorDid(by, 'cofnął', 'cofnęła')} potwierdzenie`, `${row.title} — znów w planie${planned > now ? ` na ${hhmm(planned)}` : ''}.`, null, now);
    }
    this.onChange();
    return this.getReminder(id);
  }

  /**
   * Changes a plan item: name, time or kind. For a daily one, the change holds from this
   * occurrence on (finished ones keep their history).
   */
  updateReminder(id: number, patch: { title?: string; time?: string; category?: ReminderCategory }, by: Actor, now = new Date()): Reminder | null {
    const row = this.one<ReminderRow>('SELECT * FROM reminders WHERE id = ?', id);
    if (!row || row.status === 'cancelled') return null;
    const targets = row.series_id
      ? this.all<ReminderRow>(`SELECT * FROM reminders WHERE series_id = ? AND (id = ? OR status IN ('scheduled', 'due'))`, row.series_id, id)
      : [row];
    for (const t of targets) {
      const planned = patch.time && t.status !== 'done' ? withTime(startOfDay(new Date(t.planned_at)), patch.time)! : new Date(t.planned_at);
      const moved = planned.getTime() !== Date.parse(t.planned_at);
      this.run(
        `UPDATE reminders SET title = ?, category = ?, planned_at = ?,
           due_at = CASE WHEN ? THEN ? ELSE due_at END,
           status = CASE WHEN ? AND ? > ? THEN 'scheduled' ELSE status END,
           first_fired_at = CASE WHEN ? AND ? > ? THEN NULL ELSE first_fired_at END
         WHERE id = ?`,
        patch.title ?? t.title,
        patch.category ?? t.category,
        iso(planned),
        moved ? 1 : 0,
        iso(planned),
        moved ? 1 : 0,
        iso(planned),
        iso(now),
        moved ? 1 : 0,
        iso(planned),
        iso(now),
        t.id,
      );
    }
    if (row.series_id && patch.time) this.run('UPDATE reminders SET series_time = ? WHERE series_id = ?', patch.time, row.series_id);
    const r = this.getReminder(id)!;
    if (r.shareWithFamily && by !== 'family') {
      this.addFeed('reminder_created', 'info', `${actorDid(by, 'zmienił', 'zmieniła')} plan`, `${r.title} — ${hhmm(new Date(r.plannedAt))}${r.repeat === 'daily' ? ' (codziennie)' : ''}.`, null, now);
    }
    this.onChange();
    return r;
  }

  /** "Usuń tylko dziś": today's occurrence goes, the daily series stays. */
  skipOccurrence(id: number, by: Actor, now = new Date()): Reminder | null {
    const row = this.one<ReminderRow>('SELECT * FROM reminders WHERE id = ?', id);
    if (!row || !(row.status === 'scheduled' || row.status === 'due')) return null;
    this.ensureNextOccurrence(id, now);
    this.run(`UPDATE reminders SET status = 'cancelled' WHERE id = ?`, id);
    this.ackByRef(`reminder:${id}`, now);
    if (row.share_with_family && by !== 'family') this.addFeed('reminder_cancelled', 'info', `${actorDid(by, 'pominął', 'pominęła')} dziś: ${row.title}`, 'Codzienne przypomnienie zostaje na kolejne dni.', null, now);
    this.onChange();
    return this.getReminder(id);
  }

  /**
   * Postpones a reminder that has popped up (it may already be snoozed). Returns null when
   * there is nothing to postpone: unknown id, or a reminder that never showed / is finished.
   */
  snoozeReminder(id: number, minutes: number, now = new Date()): Reminder | null {
    const changed = this.exec(
      `UPDATE reminders SET status = 'scheduled', due_at = ?
       WHERE id = ? AND (status = 'due' OR (status = 'scheduled' AND first_fired_at IS NOT NULL))`,
      iso(addMinutes(now, minutes)),
      id,
    );
    if (!changed) return null;
    this.onChange();
    return this.getReminder(id);
  }

  /**
   * The family taps "Przypomnij teraz" on a dose she hasn't confirmed: it pops up again on her
   * screen at once (with a fresh announcement). Only reminders that have already fired count.
   */
  nudgeReminder(id: number, now = new Date()): Reminder | null {
    const reminder = this.getReminder(id);
    if (!reminder || !(reminder.status === 'due' || (reminder.status === 'scheduled' && reminder.firstFiredAt))) return null;
    this.exec(`UPDATE reminders SET status = 'scheduled', due_at = ? WHERE id = ?`, iso(now), id);
    const verb = familyViewer.gender === 'f' ? 'przypomniała' : 'przypomniał';
    this.addFeed('family_action', 'info', `${familyViewer.name} ${verb} ponownie: ${reminder.title}`, null, null, now);
    this.onChange();
    return this.getReminder(id);
  }

  /**
   * Cancels a pending reminder. For a daily one, any occurrence's id stops the whole series
   * (future occurrences are cancelled, finished ones keep their history).
   */
  cancelReminder(id: number, by: Actor): { reminder: Reminder; cancelled: number } | null {
    const row = this.one<ReminderRow>('SELECT * FROM reminders WHERE id = ?', id);
    if (!row) return null;
    const r = toReminder(row);
    let cancelled: number;
    if (row.series_id) {
      cancelled = this.exec(`UPDATE reminders SET status = 'cancelled' WHERE series_id = ? AND status IN ('scheduled', 'due')`, row.series_id);
      this.run('UPDATE reminders SET next_spawned = 1 WHERE series_id = ?', row.series_id);
    } else {
      cancelled = this.exec(`UPDATE reminders SET status = 'cancelled' WHERE id = ? AND status IN ('scheduled', 'due')`, id);
    }
    if (cancelled) {
      this.ackByRef(`reminder:${id}`);
      if (r.shareWithFamily && by !== 'family') {
        const severity: FeedSeverity = isDose(r.category) ? 'warning' : 'info';
        this.addFeed('reminder_cancelled', severity, `${actorDid(by, 'wyłączył', 'wyłączyła')} przypomnienie`, `${r.title}${r.repeat === 'daily' ? ' (codzienne)' : ''}`);
      }
      this.onChange();
    }
    return { reminder: this.getReminder(id)!, cancelled };
  }

  /** Daily reminders are stored as one row per occurrence; the next one is created on first fire/confirm. */
  private ensureNextOccurrence(id: number, now: Date): void {
    const row = this.one<ReminderRow>('SELECT * FROM reminders WHERE id = ?', id);
    if (!row || row.repeat !== 'daily' || row.next_spawned === 1) return;
    const time = row.series_time ?? hhmm(new Date(row.planned_at));
    let day = addDays(startOfDay(new Date(row.planned_at)), 1);
    let next = withTime(day, time)!;
    // After downtime, skip occurrences that would be recorded as missed anyway,
    // but keep one that is still recent enough to pop up.
    while (next <= addMinutes(now, -STALE_AFTER_HOURS * 60)) {
      day = addDays(day, 1);
      next = withTime(day, time)!;
    }
    this.run(
      `INSERT INTO reminders (title, category, planned_at, due_at, repeat, created_by, series_id, series_time, event_id, medicine_id, share_with_family, created_at)
       VALUES (?, ?, ?, ?, 'daily', ?, ?, ?, NULL, ?, ?, ?)`,
      row.title,
      row.category,
      iso(next),
      iso(next),
      row.created_by,
      row.series_id,
      time,
      row.medicine_id,
      row.share_with_family,
      iso(now),
    );
    this.run('UPDATE reminders SET next_spawned = 1 WHERE id = ?', id);
  }

  // ---------------------------------------------------------------- calendar

  createEvent(input: NewEvent, now = new Date()): { event: CalendarEvent; reminder: Reminder | null } {
    const share = input.shareWithFamily !== false;
    const id = this.run(
      `INSERT INTO events (title, starts_at, location, notes, created_by, share_with_family, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.title,
      iso(input.startsAt),
      input.location ?? null,
      input.notes ?? null,
      input.createdBy,
      share ? 1 : 0,
      iso(now),
    );
    let reminder: Reminder | null = null;
    if (input.remindBeforeMin != null) {
      const at = addMinutes(input.startsAt, -input.remindBeforeMin);
      if (at > now) {
        reminder = this.createReminder(
          { title: `${input.title} o ${hhmm(input.startsAt)}`, category: 'appointment', at, createdBy: input.createdBy, eventId: id, shareWithFamily: share, announce: false },
          now,
        );
      }
    }
    const event = this.getEvent(id)!;
    if (input.announce !== false && share) {
      const where = event.location ? ` · ${event.location}` : '';
      this.addFeed('event_created', 'info', `${actorDid(input.createdBy, 'dodał', 'dodała')} wizytę do kalendarza`, `${event.title} — ${relativeWhen(input.startsAt, now)}${where}`, null, now);
    }
    this.onChange();
    return { event, reminder };
  }

  getEvent(id: number): CalendarEvent | null {
    const row = this.one<EventRow>('SELECT * FROM events WHERE id = ?', id);
    return row ? toEvent(row) : null;
  }

  /**
   * A visit moved to another day or hour. Its own reminder ("za godzinę wizyta") moves with it,
   * keeping the same lead time; if that moment has already passed, the reminder is dropped.
   */
  moveEvent(id: number, startsAt: Date, by: Actor, now = new Date()): CalendarEvent | null {
    const before = this.getEvent(id);
    if (!before || before.status === 'cancelled') return null;
    this.run(`UPDATE events SET starts_at = ?, status = 'planned' WHERE id = ?`, iso(startsAt), id);
    for (const r of this.all<ReminderRow>(`SELECT * FROM reminders WHERE event_id = ? AND status IN ('scheduled', 'due')`, id)) {
      const lead = Date.parse(before.startsAt) - Date.parse(r.planned_at);
      const at = new Date(startsAt.getTime() - lead);
      if (at > now) {
        this.run(
          `UPDATE reminders SET planned_at = ?, due_at = ?, status = 'scheduled', first_fired_at = NULL, escalated_at = NULL, title = ? WHERE id = ?`,
          iso(at),
          iso(at),
          `${before.title} o ${hhmm(startsAt)}`,
          r.id,
        );
      } else {
        this.run(`UPDATE reminders SET status = 'cancelled' WHERE id = ?`, r.id);
      }
      this.ackByRef(`reminder:${r.id}`, now);
    }
    if (before.shareWithFamily && by !== 'family') {
      this.addFeed('event_created', 'info', `${actorDid(by, 'przełożył', 'przełożyła')} wizytę`, `${before.title}: ${relativeWhen(new Date(before.startsAt), now)} → ${relativeWhen(startsAt, now)}.`, null, now);
    }
    this.onChange();
    return this.getEvent(id);
  }

  cancelEvent(id: number, by: Actor, now = new Date()): CalendarEvent | null {
    const ev = this.getEvent(id);
    if (!ev || ev.status === 'cancelled') return null;
    this.run(`UPDATE events SET status = 'cancelled' WHERE id = ?`, id);
    for (const r of this.all<ReminderRow>(`SELECT * FROM reminders WHERE event_id = ? AND status IN ('scheduled', 'due')`, id)) {
      this.run(`UPDATE reminders SET status = 'cancelled' WHERE id = ?`, r.id);
      this.ackByRef(`reminder:${r.id}`, now);
    }
    if (ev.shareWithFamily && by !== 'family') {
      this.addFeed('reminder_cancelled', 'info', `${actorDid(by, 'odwołał', 'odwołała')} wizytę`, `${ev.title} — ${relativeWhen(new Date(ev.startsAt), now)}${ev.location ? ` · ${ev.location}` : ''}.`, null, now);
    }
    this.onChange();
    return this.getEvent(id);
  }

  listEvents(from: Date, to: Date): CalendarEvent[] {
    return this.all<EventRow>(`SELECT * FROM events WHERE starts_at BETWEEN ? AND ? AND status != 'cancelled' ORDER BY starts_at`, iso(from), iso(to)).map(toEvent);
  }

  // ---------------------------------------------------------------- tasks

  createTask(input: NewTask, now = new Date()): Task {
    const share = input.shareWithFamily !== false;
    const id = this.run(
      `INSERT INTO tasks (title, kind, items, due_date, created_by, share_with_family, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.title,
      input.kind,
      JSON.stringify(input.items ?? []),
      input.dueDate ?? null,
      input.createdBy,
      share ? 1 : 0,
      iso(now),
    );
    const task = this.getTask(id)!;
    if (input.announce !== false && share) {
      const items = task.items.length ? `: ${task.items.join(', ')}` : '';
      this.addFeed('task_created', 'info', task.kind === 'shopping' ? 'Nowa lista zakupów' : `Nowe zadanie: ${task.title}`, `${task.title}${items}`, null, now);
    }
    this.onChange();
    return task;
  }

  /** Adds items to an open shopping list instead of creating a duplicate list. */
  addTaskItems(id: number, items: string[]): Task | null {
    const task = this.getTask(id);
    if (!task) return null;
    const known = new Set(task.items.map((i) => i.toLowerCase()));
    const merged = [...task.items, ...items.filter((i) => !known.has(i.toLowerCase()))];
    this.run('UPDATE tasks SET items = ? WHERE id = ?', JSON.stringify(merged), id);
    this.onChange();
    return this.getTask(id);
  }

  getTask(id: number): Task | null {
    const row = this.one<TaskRow>('SELECT * FROM tasks WHERE id = ?', id);
    return row ? toTask(row) : null;
  }

  completeTask(id: number, by: Actor, now = new Date()): Task | null {
    const task = this.getTask(id);
    if (!task || task.status === 'done') return task;
    this.run(`UPDATE tasks SET status = 'done', done_at = ? WHERE id = ?`, iso(now), id);
    if (task.shareWithFamily) this.addFeed('task_done', 'success', `Zrobione: ${task.title}`, `Oznaczone jako zrobione o ${hhmm(now)}${by === 'agent' ? ' (głosowo)' : ''}.`, null, now);
    this.onChange();
    return this.getTask(id);
  }

  reopenTask(id: number, now = new Date()): Task | null {
    const task = this.getTask(id);
    if (!task || task.status !== 'done') return task;
    this.run(`UPDATE tasks SET status = 'open', done_at = NULL WHERE id = ?`, id);
    if (task.shareWithFamily) this.addFeed('task_created', 'info', `Znów do zrobienia: ${task.title}`, `Odznaczone o ${hhmm(now)}.`, null, now);
    this.onChange();
    return this.getTask(id);
  }

  // ---------------------------------------------------------------- water

  waterToday(now = new Date()): WaterToday {
    const row = this.one<{ ml: number | null; last: string | null }>('SELECT SUM(ml) AS ml, MAX(at) AS last FROM water_log WHERE at BETWEEN ? AND ?', iso(startOfDay(now)), iso(endOfDay(now)))!;
    return { ml: row.ml ?? 0, goalMl: WATER_GOAL_ML, glassMl: GLASS_ML, lastAt: row.last };
  }

  /** "+ szklanka"; the family hears about it once, when the day's goal is reached. */
  addWater(ml: number, now = new Date()): WaterToday {
    const before = this.waterToday(now).ml;
    this.run('INSERT INTO water_log (ml, at) VALUES (?, ?)', ml, iso(now));
    this.touchActivity(now, 'water');
    const after = before + ml;
    if (before < WATER_GOAL_ML && after >= WATER_GOAL_ML) this.addFeed('task_done', 'success', `Woda: ${litres(after)} — cel na dziś osiągnięty`, null, null, now);
    this.onChange();
    return this.waterToday(now);
  }

  /** "−": the last glass today was a tap by mistake. */
  removeLastWater(now = new Date()): WaterToday {
    const last = this.one<{ id: number }>('SELECT id FROM water_log WHERE at BETWEEN ? AND ? ORDER BY at DESC, id DESC LIMIT 1', iso(startOfDay(now)), iso(endOfDay(now)));
    if (last) this.run('DELETE FROM water_log WHERE id = ?', last.id);
    this.onChange();
    return this.waterToday(now);
  }

  /** Open tasks due by the given day (or undated) plus tasks finished that day. */
  tasksForDay(day: Date): Task[] {
    const key = dateKey(day);
    return this.all<TaskRow>(
      `SELECT * FROM tasks
       WHERE (status = 'open' AND (due_date IS NULL OR due_date <= ?))
          OR (status = 'done' AND done_at BETWEEN ? AND ?)
       ORDER BY status DESC, id`,
      key,
      iso(startOfDay(day)),
      iso(endOfDay(day)),
    ).map(toTask);
  }

  openTasks(): Task[] {
    return this.all<TaskRow>(`SELECT * FROM tasks WHERE status = 'open' ORDER BY COALESCE(due_date, '9999'), id`).map(toTask);
  }

  // ---------------------------------------------------------------- family messages

  sendToSenior(contactId: string, text: string, now = new Date(), audio: VoiceAttachment | null = null): FamilyMessage {
    const id = this.run(
      `INSERT INTO messages (direction, contact_id, text, audio_file, audio_seconds, created_at) VALUES ('to_senior', ?, ?, ?, ?, ?)`,
      contactId,
      text,
      audio?.file ?? null,
      audio?.seconds ?? null,
      iso(now),
    );
    this.onChange();
    return this.getMessage(id)!;
  }

  sendToFamily(contactId: string, text: string, urgent: boolean, now = new Date(), audio: VoiceAttachment | null = null): FamilyMessage {
    const id = this.run(
      `INSERT INTO messages (direction, contact_id, text, urgent, audio_file, audio_seconds, created_at) VALUES ('to_family', ?, ?, ?, ?, ?, ?)`,
      contactId,
      text,
      urgent ? 1 : 0,
      audio?.file ?? null,
      audio?.seconds ?? null,
      iso(now),
    );
    const message = this.getMessage(id)!;
    const to = contacts.length > 1 ? ` do: ${contactById(contactId).name}` : '';
    const title = `${audio ? 'Wiadomość głosowa' : 'Wiadomość'} od ${profile.familyCallsHerGenitive}${to}`;
    this.addFeed('message_from_senior', urgent ? 'warning' : 'info', title, text || null, `message:${id}`, now, { mediaUrl: message.audioUrl });
    this.onChange();
    return message;
  }

  getMessage(id: number): FamilyMessage | null {
    const row = this.one<MessageRow>('SELECT * FROM messages WHERE id = ?', id);
    return row ? toMessage(row) : null;
  }

  markMessageRead(id: number, now = new Date()): void {
    this.run('UPDATE messages SET read_at = COALESCE(read_at, ?) WHERE id = ?', iso(now), id);
    this.onChange();
  }

  unreadMessagesToSenior(): FamilyMessage[] {
    return this.all<MessageRow>(`SELECT * FROM messages WHERE direction = 'to_senior' AND read_at IS NULL ORDER BY id`).map(toMessage);
  }

  recentMessagesToSenior(limit = 5): FamilyMessage[] {
    return this.all<MessageRow>(`SELECT * FROM messages WHERE direction = 'to_senior' ORDER BY id DESC LIMIT ?`, limit).map(toMessage);
  }

  // ---------------------------------------------------------------- SMS inbox (simulated in the POC)

  addSms(sender: string, text: string, receivedAt = new Date()): Sms {
    const id = this.run('INSERT INTO sms (sender, text, received_at) VALUES (?, ?, ?)', sender, text, iso(receivedAt));
    this.onChange();
    return this.getSms(id)!;
  }

  getSms(id: number): Sms | null {
    const row = this.one<SmsRow>('SELECT * FROM sms WHERE id = ?', id);
    return row ? toSms(row) : null;
  }

  setSmsAssessment(id: number, a: SmsAssessment): Sms | null {
    this.run(
      'UPDATE sms SET verdict = ?, category = ?, reasons = ?, advice = ?, analyzed_by = ? WHERE id = ?',
      a.verdict,
      a.category,
      JSON.stringify(a.reasons),
      a.advice,
      a.analyzedBy,
      id,
    );
    const sms = this.getSms(id);
    // The agent may already have reported this SMS while Scam Shield was still thinking.
    if (sms && a.verdict !== 'safe' && !this.hasFeedRef(`sms:${id}`)) {
      const title = a.verdict === 'scam' ? 'Wykryto próbę oszustwa (SMS)' : 'Podejrzany SMS';
      this.addFeed('scam_detected', 'warning', title, `${a.summaryForFamily} ${seniorDid('został ostrzeżony', 'została ostrzeżona')}.`, `sms:${id}`);
    }
    this.onChange();
    return sms;
  }

  /** Warnings the senior has not dismissed yet. */
  smsAlerts(): Sms[] {
    return this.all<SmsRow>(`SELECT * FROM sms WHERE verdict IN ('scam', 'suspicious') AND senior_seen_at IS NULL ORDER BY id`).map(toSms);
  }

  newSafeSms(): Sms[] {
    return this.all<SmsRow>(`SELECT * FROM sms WHERE verdict = 'safe' AND senior_seen_at IS NULL AND read_at IS NULL ORDER BY id`).map(toSms);
  }

  markSmsSeen(id: number, now = new Date()): void {
    this.run('UPDATE sms SET senior_seen_at = COALESCE(senior_seen_at, ?) WHERE id = ?', iso(now), id);
    this.onChange();
  }

  recentSms(limit = 5): Sms[] {
    return this.all<SmsRow>('SELECT * FROM sms ORDER BY id DESC LIMIT ?', limit).map(toSms);
  }

  unreadSms(): Sms[] {
    return this.all<SmsRow>('SELECT * FROM sms WHERE read_at IS NULL ORDER BY id').map(toSms);
  }

  markSmsRead(ids: number[], now = new Date()): void {
    for (const id of ids) this.run('UPDATE sms SET read_at = COALESCE(read_at, ?), senior_seen_at = COALESCE(senior_seen_at, ?) WHERE id = ?', iso(now), iso(now), id);
    if (ids.length) this.onChange();
  }

  // ---------------------------------------------------------------- family feed

  addFeed(
    kind: FeedKind,
    severity: FeedSeverity,
    title: string,
    detail: string | null = null,
    ref: string | null = null,
    at = new Date(),
    extra: { mediaUrl?: string | null; geo?: GeoPoint | null } = {},
  ): FeedItem {
    const id = this.run(
      'INSERT INTO feed (kind, severity, title, detail, ref, media_url, geo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      kind,
      severity,
      title,
      detail,
      ref,
      extra.mediaUrl ?? null,
      extra.geo ? JSON.stringify(extra.geo) : null,
      iso(at),
    );
    this.onChange();
    return toFeed(this.one<FeedRow>('SELECT * FROM feed WHERE id = ?', id)!);
  }

  hasFeedRef(ref: string): boolean {
    return this.one<{ n: number }>('SELECT COUNT(*) AS n FROM feed WHERE ref = ?', ref)!.n > 0;
  }

  ackFeed(id: number, now = new Date()): void {
    this.run('UPDATE feed SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE id = ?', iso(now), id);
    this.onChange();
  }

  private ackByRef(ref: string, now = new Date()): void {
    this.run('UPDATE feed SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE ref = ?', iso(now), ref);
  }

  listFeed(limit = 30): FeedItem[] {
    return this.all<FeedRow>('SELECT * FROM feed ORDER BY created_at DESC, id DESC LIMIT ?', limit).map(toFeed);
  }

  attentionItems(): FeedItem[] {
    return this.all<FeedRow>(`SELECT * FROM feed WHERE severity IN ('warning', 'urgent') AND acknowledged_at IS NULL ORDER BY severity = 'urgent' DESC, id DESC`).map(toFeed);
  }

  // ---------------------------------------------------------------- safety & wellbeing

  reportScam(channel: string, description: string, smsId: number | null): { alreadyReported: boolean } {
    const ref = smsId ? `sms:${smsId}` : null;
    if (ref && this.hasFeedRef(ref)) return { alreadyReported: true };
    const channelLabel: Record<string, string> = { sms: 'SMS', phone_call: 'telefon', letter: 'pismo', other: 'inne' };
    this.addFeed('scam_detected', 'warning', `Wykryto próbę oszustwa (${channelLabel[channel] ?? channel})`, `${description} Asystent ostrzegł ${profile.familyCallsHerAccusative} i odradził jakiekolwiek płatności.`, ref);
    return { alreadyReported: false };
  }

  emergency(description: string): FeedItem {
    return this.addFeed('emergency', 'urgent', `${seniorDid('zgłosił', 'zgłosiła')} nagły problem`, `${description} Asystent polecił natychmiast zadzwonić pod 112.`);
  }

  callRequest(contactId: string, now = new Date()): FeedItem {
    const to = contactById(contactId);
    return this.addFeed('call_request', 'warning', `${profile.familyCallsHer} chce porozmawiać`, `Próba połączenia do: ${to.name} (${hhmm(now)}). Oddzwoń, gdy możesz.`, null, now);
  }

  /** One family alert per guarded call, however many times the verdict is repeated. */
  callGuardAlert(sessionId: string, reason: string | null, now = new Date()): boolean {
    const ref = `callguard:${sessionId}`;
    if (this.hasFeedRef(ref)) return false;
    this.addFeed('call_guard', 'warning', 'Strażnik rozmowy: podejrzany telefon', `${reason ? `${reason[0].toUpperCase()}${reason.slice(1)}. ` : ''}Asystent ostrzegł ${profile.familyCallsHerAccusative} i doradził zakończenie rozmowy. Warto zadzwonić.`, ref, now);
    return true;
  }

  recordWellbeing(mood: Mood, note: string | null, now = new Date()): FeedItem {
    const quoted = note ? `„${note}”` : null;
    if (mood === 'good') return this.addFeed('wellbeing', 'success', 'Samopoczucie: dobre', quoted, null, now);
    if (mood === 'ok') return this.addFeed('wellbeing', 'info', 'Samopoczucie: takie sobie', quoted, null, now);
    return this.addFeed('wellbeing', 'warning', `${profile.familyCallsHer} zgłasza gorsze samopoczucie`, `Warto zadzwonić.${quoted ? ` ${quoted}` : ''}`, null, now);
  }

  // ---------------------------------------------------------------- check-ins

  createCheckin(now = new Date(), briefing: string | null = null): Checkin {
    const id = this.run('INSERT INTO checkins (asked_at, briefing) VALUES (?, ?)', iso(now), briefing);
    this.onChange();
    return toCheckin(this.one<CheckinRow>('SELECT * FROM checkins WHERE id = ?', id)!);
  }

  checkinAskedOn(day: Date): boolean {
    return this.one<{ n: number }>('SELECT COUNT(*) AS n FROM checkins WHERE asked_at BETWEEN ? AND ?', iso(startOfDay(day)), iso(endOfDay(day)))!.n > 0;
  }

  pendingCheckin(now = new Date()): Checkin | null {
    const row = this.one<CheckinRow>(
      'SELECT * FROM checkins WHERE answered_at IS NULL AND asked_at >= ? ORDER BY id DESC LIMIT 1',
      iso(addMinutes(now, -CHECKIN_TTL_HOURS * 60)),
    );
    return row ? toCheckin(row) : null;
  }

  /** Returns false for an unknown or already answered check-in (e.g. a double tap). */
  answerCheckin(id: number, mood: Mood, note: string | null = null, now = new Date()): boolean {
    const changed = this.exec('UPDATE checkins SET answered_at = ?, mood = ?, note = ? WHERE id = ? AND answered_at IS NULL', iso(now), mood, note, id);
    if (changed !== 1) return false;
    this.recordWellbeing(mood, note, now);
    return true;
  }

  // ---------------------------------------------------------------- memory & conversation

  remember(fact: string, now = new Date()): boolean {
    const exists = this.one<{ n: number }>('SELECT COUNT(*) AS n FROM memories WHERE lower(fact) = lower(?)', fact.trim())!.n > 0;
    if (!exists) this.run('INSERT INTO memories (fact, created_at) VALUES (?, ?)', fact.trim(), iso(now));
    return !exists;
  }

  memories(): string[] {
    return this.all<{ fact: string }>('SELECT fact FROM memories ORDER BY id DESC LIMIT 60')
      .map((r) => r.fact)
      .reverse();
  }

  appendConversation(role: 'user' | 'assistant', text: string, now = new Date()): void {
    this.run('INSERT INTO conversation (role, text, created_at) VALUES (?, ?, ?)', role, text, iso(now));
  }

  /** Recent turns of the current session, oldest first, always starting with the senior. */
  recentConversation(maxMessages = 12, maxAgeMinutes = 30, now = new Date()): { role: 'user' | 'assistant'; text: string }[] {
    const rows = this.all<{ role: 'user' | 'assistant'; text: string }>(
      'SELECT role, text FROM conversation WHERE created_at >= ? ORDER BY id DESC LIMIT ?',
      iso(addMinutes(now, -maxAgeMinutes)),
      maxMessages,
    ).reverse();
    while (rows.length && rows[0].role !== 'user') rows.shift();
    return rows;
  }

  lastExchange(): SeniorState['lastExchange'] {
    const rows = this.all<{ role: string; text: string; created_at: string }>('SELECT role, text, created_at FROM conversation ORDER BY id DESC LIMIT 2');
    const [assistant, user] = rows;
    if (!assistant || assistant.role !== 'assistant' || !user || user.role !== 'user') return null;
    return { user: user.text, assistant: assistant.text, at: assistant.created_at };
  }

  // ---------------------------------------------------------------- activity

  touchActivity(now = new Date(), kind = 'app'): void {
    this.run(`INSERT INTO kv (key, value) VALUES ('last_activity_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, iso(now));
    this.logActivity(kind, now);
  }

  /** Counted per day in the family's weekly view. */
  logActivity(kind: string, at = new Date()): void {
    this.run('INSERT INTO activity (kind, created_at) VALUES (?, ?)', kind, iso(at));
  }

  getKv<T>(key: string): T | null {
    const row = this.one<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
    return row ? (JSON.parse(row.value) as T) : null;
  }

  setKv(key: string, value: unknown): void {
    this.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  }

  // ---------------------------------------------------------------- her screen settings

  // ---------------------------------------------------------------- doctors and clinic

  careTeam(): CareTeam {
    return this.getKv<CareTeam>('care_team') ?? { clinic: null, doctors: [], updatedAt: null };
  }

  /** The family keeps it up to date; she sees it as big call buttons. */
  setCareTeam(team: Omit<CareTeam, 'updatedAt'>, now = new Date()): CareTeam {
    const next: CareTeam = { ...team, updatedAt: iso(now) };
    this.setKv('care_team', next);
    this.onChange();
    return next;
  }

  /** For the "Automatycznie" theme: light while the sun is up at her home. */
  sun(now = new Date()): SunTimes {
    const t = sunTimes(now, household.lat, household.lon);
    return { sunrise: t.sunrise ? iso(t.sunrise) : null, sunset: t.sunset ? iso(t.sunset) : null };
  }

  seniorDisplay(): SeniorDisplay {
    return this.getKv<SeniorDisplay>('senior_display') ?? { settings: null, rev: null, updatedBy: null, updatedAt: null };
  }

  /**
   * Saves her screen settings. From the family they reach her phone at once (she sees who
   * changed what and can undo it); her own changes come back so the family sees what she has.
   */
  setSeniorDisplay(settings: DisplaySettings, by: 'senior' | 'family', opts: { undo?: boolean } = {}, now = new Date()): SeniorDisplay {
    const next: SeniorDisplay = { settings, rev: randomUUID(), updatedBy: by, updatedAt: iso(now) };
    this.setKv('senior_display', next);
    if (opts.undo) {
      const verb = profile.gender === 'f' ? 'przywróciła' : 'przywrócił';
      this.addFeed('family_action', 'info', `${profile.familyCallsHer} ${verb} swoje ustawienia ekranu`, 'Zmiana wyglądu z aplikacji rodziny została cofnięta na telefonie.', null, now);
    }
    this.onChange();
    return next;
  }

  lastActivity(): string | null {
    return this.one<{ value: string }>(`SELECT value FROM kv WHERE key = 'last_activity_at'`)?.value ?? null;
  }

  // ---------------------------------------------------------------- apteczka (medicines)

  /** Adds a medicine with one daily reminder per time. Dosing comes from the box, never from us. */
  addMedicine(
    input: { name: string; strength?: string | null; form?: string | null; instructions?: string | null; times: string[]; doseUnits?: number; stock?: number | null; packSize?: number | null; createdBy: Actor },
    now = new Date(),
  ): Medicine {
    const id = this.importMedicine(input, now);
    const label = `${input.name}${input.strength ? ` ${input.strength}` : ''}`;
    for (const time of input.times) {
      let at = withTime(now, time)!;
      if (at <= now) at = withTime(addDays(startOfDay(now), 1), time)!;
      this.createReminder({ title: `${doseSlotName(time)}: ${label}`, category: 'medication', at, repeat: 'daily', createdBy: input.createdBy, medicineId: id, announce: false }, now);
    }
    this.addFeed(
      'medicine_added',
      'info',
      `${actorDid(input.createdBy, 'dodał', 'dodała')} lek do apteczki`,
      `${label}${input.instructions ? ` — ${input.instructions}` : ''}${input.times.length ? ` · przypomnienia: ${input.times.join(', ')}` : ''}`,
      null,
      now,
    );
    this.onChange();
    return this.getMedicine(id)!;
  }

  /** Just the row (the demo seed wires its own reminders). */
  importMedicine(
    input: { name: string; strength?: string | null; form?: string | null; instructions?: string | null; times: string[]; doseUnits?: number; stock?: number | null; packSize?: number | null; createdBy: Actor },
    now = new Date(),
  ): number {
    return this.run(
      `INSERT INTO medicines (name, strength, form, instructions, times, dose_units, stock, pack_size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.name,
      input.strength ?? null,
      input.form ?? null,
      input.instructions ?? null,
      JSON.stringify(input.times),
      input.doseUnits ?? 1,
      input.stock ?? null,
      input.packSize ?? null,
      input.createdBy,
      iso(now),
    );
  }

  getMedicine(id: number): Medicine | null {
    const row = this.one<MedicineRow>('SELECT * FROM medicines WHERE id = ? AND active = 1', id);
    return row ? toMedicine(row) : null;
  }

  listMedicines(): Medicine[] {
    return this.all<MedicineRow>('SELECT * FROM medicines WHERE active = 1 ORDER BY id').map(toMedicine);
  }

  setMedicineStock(id: number, stock: number, now = new Date()): void {
    this.exec('UPDATE medicines SET stock = ? WHERE id = ?', stock, id);
    this.checkLowStock(id, now);
    this.onChange();
  }

  private takeDose(id: number, now: Date): void {
    this.exec('UPDATE medicines SET stock = MAX(0, stock - dose_units) WHERE id = ? AND stock IS NOT NULL', id);
    this.checkLowStock(id, now);
  }

  /** Once per low-stock episode: a heads-up for the family and a refill offer for her. */
  private checkLowStock(id: number, now: Date): void {
    const row = this.one<MedicineRow>('SELECT * FROM medicines WHERE id = ?', id);
    if (!row) return;
    const m = toMedicine(row);
    if (!m.lowStock || row.low_alerted_at) return;
    this.exec('UPDATE medicines SET low_alerted_at = ? WHERE id = ?', iso(now), id);
    const days = m.daysLeft ?? 0;
    this.addFeed('medicine_low', 'info', `Kończy się lek: ${m.name}${m.strength ? ` ${m.strength}` : ''}`, `Zostało na ${days} ${plural(days, 'dzień', 'dni', 'dni')}. ${profile.familyCallsHer} dostała propozycję zamówienia w aptece.`, `medicine:${id}`, now);
  }

  /** Low, not postponed and not already on its way. */
  refillSuggestions(now = new Date()): Medicine[] {
    return this.all<MedicineRow>(
      `SELECT * FROM medicines m WHERE active = 1 AND low_alerted_at IS NOT NULL
         AND (refill_snoozed_until IS NULL OR refill_snoozed_until <= ?)
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.medicine_id = m.id AND (o.status IN ('awaiting_senior', 'awaiting_family') OR (o.status = 'placed' AND o.decided_at >= m.low_alerted_at)))
       ORDER BY id`,
      iso(now),
    )
      .map(toMedicine)
      .filter((m) => m.lowStock);
  }

  snoozeRefill(id: number, now = new Date()): void {
    this.exec('UPDATE medicines SET refill_snoozed_until = ? WHERE id = ?', iso(addDays(now, 1)), id);
    this.onChange();
  }

  /** Her "yes" on the refill card is the consent: the order is created and confirmed at once. */
  orderRefill(id: number, now = new Date()): Order | null {
    const m = this.getMedicine(id);
    if (!m) return null;
    const quote = pharmacyQuote(m, now);
    const order = this.createOrder({ kind: 'pharmacy', title: `Apteka: ${m.name}${m.strength ? ` ${m.strength}` : ''}`, ...quote, partner: PHARMACY_PARTNER, medicineId: id }, now);
    return this.confirmOrder(order.id, now);
  }

  // ---------------------------------------------------------------- safety: SOS, falls, "czy wszystko w porządku?"

  /** 'fall': no answer to "Czy Pani upadła?"; 'fall_help': she answered that she needs help. */
  sos(reason: 'button' | 'fall' | 'fall_help' | 'help', geo: GeoPoint | null, now = new Date()): FeedItem {
    const title = {
      fall: `Możliwy upadek — ${profile.familyCallsHer} nie odpowiada`,
      fall_help: `Upadek — ${profile.familyCallsHer} prosi o pomoc`,
      help: `${profile.familyCallsHer} potrzebuje pomocy`,
      button: `SOS: ${profile.familyCallsHer} prosi o pomoc`,
    }[reason];
    const place = geo ? 'Lokalizacja w załączniku.' : 'Lokalizacja niedostępna.';
    const item = this.addFeed(reason === 'fall' || reason === 'fall_help' ? 'fall' : 'sos', 'urgent', title, `${hhmm(now)}. ${place} Zadzwoń natychmiast; bez kontaktu — 112.`, null, now, { geo });
    this.touchActivity(now, 'sos');
    return item;
  }

  /** She said she's fine after a suspected fall: the family learns it happened, without an alarm. */
  fallDismissed(now = new Date()): void {
    this.addFeed('fall', 'info', 'Możliwy upadek — wszystko w porządku', `Potwierdzone o ${hhmm(now)}: nic się nie stało.`, null, now);
    this.touchActivity(now, 'safety');
  }

  createSafetyCheck(reason: SafetyCheck['reason'], now = new Date()): SafetyCheck {
    const id = this.run('INSERT INTO safety_checks (reason, asked_at) VALUES (?, ?)', reason, iso(now));
    this.onChange();
    return toSafety(this.one<SafetyRow>('SELECT * FROM safety_checks WHERE id = ?', id)!);
  }

  openSafetyCheck(now = new Date()): SafetyCheck | null {
    const row = this.one<SafetyRow>('SELECT * FROM safety_checks WHERE answered_at IS NULL AND asked_at >= ? ORDER BY id DESC LIMIT 1', iso(addMinutes(now, -CHECKIN_TTL_HOURS * 60)));
    return row ? toSafety(row) : null;
  }

  safetyCheckAskedSince(since: Date): boolean {
    return this.one<{ n: number }>('SELECT COUNT(*) AS n FROM safety_checks WHERE asked_at >= ?', iso(since))!.n > 0;
  }

  /** Returns false for an unknown or already answered check. "help" raises an SOS. */
  answerSafetyCheck(id: number, answer: 'ok' | 'help', geo: GeoPoint | null = null, now = new Date()): boolean {
    const row = this.one<SafetyRow>('SELECT * FROM safety_checks WHERE id = ?', id);
    if (!row || row.answered_at) return false;
    this.exec('UPDATE safety_checks SET answered_at = ?, answer = ? WHERE id = ?', iso(now), answer, id);
    this.ackByRef(`safety:${id}`, now);
    if (answer === 'help') this.sos('help', geo, now);
    else {
      this.touchActivity(now, 'safety');
      if (row.escalated_at) this.addFeed('safety_check', 'success', `${profile.familyCallsHer} odpowiada: wszystko w porządku`, `Odpowiedź o ${hhmm(now)}.`, null, now);
    }
    this.onChange();
    return true;
  }

  safetyChecksToEscalate(now: Date, afterMinutes: number): SafetyCheck[] {
    return this.all<SafetyRow>('SELECT * FROM safety_checks WHERE answered_at IS NULL AND escalated_at IS NULL AND asked_at <= ?', iso(addMinutes(now, -afterMinutes))).map(toSafety);
  }

  escalateSafetyCheck(id: number, now = new Date()): void {
    const changed = this.exec('UPDATE safety_checks SET escalated_at = ? WHERE id = ? AND escalated_at IS NULL', iso(now), id);
    if (!changed) return;
    this.addFeed('safety_check', 'warning', `${profile.familyCallsHer} nie odpowiada`, `Na pytanie „Czy wszystko w porządku?” brak odpowiedzi od ${config.safetyEscalateMin} min. Zadzwoń.`, `safety:${id}`, now);
    this.onChange();
  }

  // ---------------------------------------------------------------- orders (agent actions)

  /** The agent prepares; only people decide. Nothing is placed without her tap. */
  createOrder(input: NewOrder, now = new Date()): Order {
    const id = this.run(
      `INSERT INTO orders (kind, status, title, lines, total, partner, eta, pickup_at, destination, task_id, medicine_id, created_at)
       VALUES (?, 'awaiting_senior', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.kind,
      input.title,
      JSON.stringify(input.lines),
      input.total,
      input.partner,
      input.windowLabel,
      iso(input.windowStart),
      input.destination ?? null,
      input.taskId ?? null,
      input.medicineId ?? null,
      iso(now),
    );
    this.onChange();
    return this.getOrder(id)!;
  }

  getOrder(id: number): Order | null {
    const row = this.one<OrderRow>('SELECT * FROM orders WHERE id = ?', id);
    return row ? toOrder(row) : null;
  }

  ordersToConfirm(): Order[] {
    return this.all<OrderRow>(`SELECT * FROM orders WHERE status = 'awaiting_senior' ORDER BY id`).map(toOrder);
  }

  /** Decided by the family; she gets told once. */
  orderUpdates(): Order[] {
    return this.all<OrderRow>(`SELECT * FROM orders WHERE status IN ('placed', 'declined') AND senior_seen_at IS NULL ORDER BY id`).map(toOrder);
  }

  markOrderSeen(id: number, now = new Date()): void {
    this.run('UPDATE orders SET senior_seen_at = COALESCE(senior_seen_at, ?) WHERE id = ?', iso(now), id);
    this.onChange();
  }

  expireStaleOrders(now: Date): number {
    const changed = this.exec(
      `UPDATE orders SET status = 'declined', declined_by = 'system', decided_at = ?, senior_seen_at = ? WHERE status = 'awaiting_senior' AND created_at <= ?`,
      iso(now),
      iso(now),
      iso(addMinutes(now, -ORDER_CONSENT_TTL_HOURS * 60)),
    );
    if (changed) this.onChange();
    return changed;
  }

  /** "wt. 29.09 10:00–12:00" — for feed text, which is stored and read days later. */
  private orderWhen(id: number): string {
    const row = this.one<OrderRow>('SELECT * FROM orders WHERE id = ?', id)!;
    return row.pickup_at ? `${shortDate(new Date(row.pickup_at))} ${row.eta ?? ''}`.trim() : (row.eta ?? '');
  }

  listOrders(limit = 5): Order[] {
    return this.all<OrderRow>(`SELECT * FROM orders WHERE status != 'awaiting_senior' ORDER BY id DESC LIMIT ?`, limit).map(toOrder);
  }

  /** Her "yes": placed right away, or sent to the family when above the spending limit. */
  confirmOrder(id: number, now = new Date()): Order | null {
    const order = this.getOrder(id);
    if (!order || order.status !== 'awaiting_senior') return null;
    if (order.needsFamilyApproval) {
      this.exec(`UPDATE orders SET status = 'awaiting_family' WHERE id = ?`, id);
      this.addFeed(
        'order_needs_approval',
        'warning',
        `${profile.familyCallsHer} prosi o zgodę na zamówienie`,
        `${order.title}: ${money(order.total)} · ${this.orderWhen(id)}. Kwota powyżej limitu ${money(config.spendingLimit)}.`,
        `order:${id}`,
        now,
      );
      this.onChange();
      return this.getOrder(id);
    }
    return this.placeOrder(id, now, true);
  }

  approveOrder(id: number, now = new Date()): Order | null {
    const order = this.getOrder(id);
    if (!order || order.status !== 'awaiting_family') return null;
    this.ackByRef(`order:${id}`, now);
    return this.placeOrder(id, now, false);
  }

  declineOrder(id: number, by: Actor, now = new Date()): Order | null {
    const changed = this.exec(
      `UPDATE orders SET status = 'declined', decided_at = ?, declined_by = ?, senior_seen_at = ? WHERE id = ? AND status IN ('awaiting_senior', 'awaiting_family')`,
      iso(now),
      by,
      by === 'senior' ? iso(now) : null,
      id,
    );
    if (!changed) return null;
    const order = this.getOrder(id)!;
    if (by === 'family') {
      this.ackByRef(`order:${id}`, now);
      this.addFeed('order_declined', 'info', `${familyViewer.name} ${familyViewer.gender === 'f' ? 'odrzuciła' : 'odrzucił'} zamówienie`, `${order.title}: ${money(order.total)}.`, null, now);
    }
    this.onChange();
    return order;
  }

  private placeOrder(id: number, now: Date, seniorKnows: boolean): Order {
    const order = this.getOrder(id)!;
    const reference = orderReference(order.kind);
    this.exec(
      `UPDATE orders SET status = 'placed', reference = ?, decided_at = ?, senior_seen_at = ? WHERE id = ?`,
      reference,
      iso(now),
      seniorKnows ? iso(now) : null,
      id,
    );
    const row = this.one<OrderRow>('SELECT * FROM orders WHERE id = ?', id)!;
    if (row.task_id) this.exec(`UPDATE tasks SET status = 'done', done_at = ? WHERE id = ? AND status = 'open'`, iso(now), row.task_id);
    // The POC treats a pharmacy order as delivered: the stock is topped up and a new episode starts.
    if (row.medicine_id) this.exec('UPDATE medicines SET stock = COALESCE(stock, 0) + COALESCE(pack_size, 30), low_alerted_at = NULL WHERE id = ?', row.medicine_id);
    const what = order.kind === 'taxi' ? order.destination : order.lines.filter((l) => l.name !== 'Dostawa').map((l) => l.name).join(', ');
    this.addFeed(
      'order_placed',
      'success',
      order.kind === 'groceries' ? 'Zamówiono zakupy' : order.kind === 'pharmacy' ? 'Zamówiono lek w aptece' : 'Zamówiono taksówkę',
      `${what} · ${money(order.total)} · ${order.kind === 'taxi' ? 'odbiór' : 'dostawa'} ${this.orderWhen(id)} · nr ${reference}`,
      null,
      now,
    );
    this.onChange();
    return this.getOrder(id)!;
  }

  // ---------------------------------------------------------------- demo history

  /** Past days for the demo, written directly so they don't flood the family feed. */
  importPastDose(title: string, plannedAt: Date, doneAt: Date | null): void {
    this.run(
      `INSERT INTO reminders (title, category, planned_at, due_at, repeat, status, created_by, first_fired_at, done_at, escalated_at, next_spawned, created_at)
       VALUES (?, 'medication', ?, ?, 'none', ?, 'family', ?, ?, ?, 1, ?)`,
      title,
      iso(plannedAt),
      iso(plannedAt),
      doneAt ? 'done' : 'missed',
      iso(plannedAt),
      doneAt ? iso(doneAt) : null,
      doneAt ? null : iso(addMinutes(plannedAt, config.escalateAfterMin)),
      iso(plannedAt),
    );
  }

  importPastCheckin(askedAt: Date, answeredAt: Date, mood: Mood): void {
    this.run('INSERT INTO checkins (asked_at, answered_at, mood) VALUES (?, ?, ?)', iso(askedAt), iso(answeredAt), mood);
  }

  // ---------------------------------------------------------------- weekly insights (for the family)

  weeklyInsights(now = new Date()): WeeklyInsights {
    const from = startOfDay(addDays(now, -13));
    const to = endOfDay(now);
    const meds = this.all<ReminderRow>(
      `SELECT * FROM reminders WHERE category = 'medication' AND share_with_family = 1 AND status != 'cancelled' AND planned_at BETWEEN ? AND ?`,
      iso(from),
      iso(to),
    ).map(toReminder);
    const moods = this.all<CheckinRow>('SELECT * FROM checkins WHERE answered_at IS NOT NULL AND asked_at BETWEEN ? AND ? ORDER BY asked_at', iso(from), iso(to)).map(toCheckin);
    const activity = this.all<{ created_at: string }>('SELECT created_at FROM activity WHERE created_at BETWEEN ? AND ?', iso(from), iso(to));

    const dose = (list: Reminder[]): DoseStatus => {
      const states = list.map((r) => (r.status === 'done' ? 'done' : r.status === 'missed' || (r.status === 'due' && r.escalatedAt) ? 'missed' : 'pending'));
      if (!states.length) return 'none';
      if (states.includes('missed')) return 'missed';
      return states.includes('pending') ? 'pending' : 'done';
    };

    const fortnight: InsightDay[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = startOfDay(addDays(now, -i));
      const key = dateKey(day);
      const dayMeds = meds.filter((r) => dateKey(new Date(r.plannedAt)) === key);
      fortnight.push({
        date: key,
        label: WEEKDAY_SHORT[day.getDay()],
        morning: dose(dayMeds.filter((r) => new Date(r.plannedAt).getHours() < 14)),
        evening: dose(dayMeds.filter((r) => new Date(r.plannedAt).getHours() >= 14)),
        mood: (moods.filter((c) => dateKey(new Date(c.askedAt)) === key).at(-1)?.mood ?? null) as Mood | null,
        interactions: activity.filter((a) => dateKey(new Date(a.created_at)) === key).length,
      });
    }
    const week = fortnight.slice(-7);
    const slots = week.flatMap((d) => [d.morning, d.evening]);
    const dosesTaken = slots.filter((s) => s === 'done').length;
    const dosesPlanned = dosesTaken + slots.filter((s) => s === 'missed').length;
    const scamsBlocked = this.one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM feed WHERE kind IN ('scam_detected', 'call_guard') AND created_at >= ?`,
      iso(startOfDay(addDays(now, -6))),
    )!.n;

    const watch: Insight[] = [];
    const info: Insight[] = [];
    const good: Insight[] = [];
    const recent = fortnight.slice(-4);
    const before = fortnight.slice(0, -4);
    for (const slot of ['morning', 'evening'] as const) {
      const name = slot === 'morning' ? 'Poranne' : 'Wieczorne';
      const recentMisses = recent.filter((d) => d[slot] === 'missed').length;
      const earlierMisses = before.filter((d) => d[slot] === 'missed').length;
      const weekDone = week.filter((d) => d[slot] === 'done').length;
      if (recentMisses >= 2 && earlierMisses <= 1) {
        watch.push({ tone: 'watch', text: `${name} leki pominięte ${recentMisses} razy w ostatnich 4 dniach — wcześniej przyjmowane regularnie. Może warto porozmawiać o porze przypomnienia.` });
      } else if (weekDone >= 6 && !week.some((d) => d[slot] === 'missed')) {
        good.push({ tone: 'good', text: `${name} leki przyjęte każdego dnia w tym tygodniu.` });
      }
    }
    const yesterday = fortnight.at(-2)!;
    const usual = fortnight.slice(-8, -2).map((d) => d.interactions);
    const average = usual.reduce((a, b) => a + b, 0) / Math.max(1, usual.length);
    if (average >= 3 && yesterday.interactions < average * 0.5) {
      watch.push({ tone: 'watch', text: `Wczoraj mniej kontaktu z asystentką niż zwykle: ${yesterday.interactions} ${plural(yesterday.interactions, 'raz', 'razy', 'razy')}, zwykle około ${Math.round(average)}.` });
    }
    const lastMoods = fortnight.map((d) => d.mood).filter((m): m is Mood => m !== null).slice(-3);
    if (lastMoods.filter((m) => m !== 'good').length >= 2) {
      watch.push({ tone: 'watch', text: 'Samopoczucie w ostatnich dniach gorsze niż zwykle — warto zadzwonić.' });
    }
    if (scamsBlocked > 0) {
      info.push({ tone: 'info', text: `Scam Shield zatrzymał w tym tygodniu ${scamsBlocked} ${plural(scamsBlocked, 'próbę', 'próby', 'prób')} oszustwa.` });
    }
    return { days: week, dosesTaken, dosesPlanned, scamsBlocked, insights: [...watch, ...info, ...good] };
  }

  // ---------------------------------------------------------------- views

  seniorState(ai: AiStatus, now = new Date()): SeniorState {
    return {
      now: iso(now),
      tz: config.tz,
      profile,
      contacts,
      today: {
        reminders: this.listReminders(startOfDay(now), endOfDay(now)),
        events: this.listEvents(startOfDay(now), endOfDay(now)),
        tasks: this.tasksForDay(now),
      },
      dueReminders: this.dueReminders(),
      incomingMessages: this.unreadMessagesToSenior(),
      smsAlerts: this.smsAlerts(),
      newSms: this.newSafeSms(),
      pendingCheckin: this.pendingCheckin(now),
      ordersToConfirm: this.ordersToConfirm(),
      orderUpdates: this.orderUpdates(),
      medicines: this.listMedicines(),
      refillSuggestions: this.refillSuggestions(now).map((medicine) => {
        const quote = pharmacyQuote(medicine, now);
        return { medicine, price: quote.total, eta: `${dayLabel(quote.windowStart, now)} ${quote.windowLabel}` };
      }),
      safetyCheck: this.openSafetyCheck(now),
      video: null,
      health: this.health.view('senior', now),
      display: this.seniorDisplay(),
      sun: this.sun(now),
      careTeam: this.careTeam(),
      water: this.waterToday(now),
      /** Her visits in the coming month, to move or cancel from "Mój lekarz". */
      upcomingEvents: this.listEvents(now, endOfDay(addDays(now, 30))),
      week: this.weeklyInsights(now).days,
      healthCheck: this.health.openCheck(now),
      lastExchange: this.lastExchange(),
      ai,
    };
  }

  familyState(ai: AiStatus, now = new Date()): FamilyState {
    const alerts = this.attentionItems();
    const lastActivityAt = this.lastActivity();
    return {
      now: iso(now),
      tz: config.tz,
      profile,
      contacts,
      viewer: familyViewer,
      status: this.familyStatus(alerts, lastActivityAt, now),
      lastActivityAt,
      alerts,
      today: this.timeline(now),
      upcoming: this.listEvents(startOfDay(addDays(now, 1)), endOfDay(addDays(now, 14)))
        .filter((e) => e.shareWithFamily)
        .slice(0, 5),
      feed: this.listFeed(30),
      sentMessages: this.recentMessagesToSenior(5),
      orders: this.listOrders(5),
      insights: this.weeklyInsights(now),
      spendingLimit: config.spendingLimit,
      medicines: this.listMedicines(),
      video: null,
      health: this.health.view('family', now),
      display: this.seniorDisplay(),
      sun: this.sun(now),
      careTeam: this.careTeam(),
      water: this.waterToday(now),
      ai,
    };
  }

  private familyStatus(alerts: FeedItem[], lastActivityAt: string | null, now: Date): FamilyState['status'] {
    const urgent = alerts.find((a) => a.severity === 'urgent');
    if (urgent) return { level: 'urgent', label: 'Pilne — sprawdź', reason: urgent.title };
    if (alerts.length) return { level: 'attention', label: 'Wymaga uwagi', reason: alerts[0].title };
    if (lastActivityAt) {
      const last = new Date(lastActivityAt);
      if (daytimeHoursBetween(last, now) >= config.inactivityHours) {
        return { level: 'attention', label: 'Brak aktywności', reason: `Ostatni kontakt z asystentem: ${relativeWhen(last, now)}.` };
      }
    }
    return { level: 'ok', label: 'Wszystko OK', reason: null };
  }

  /** "Dzisiaj" list for the family: the important facts, never conversation content. */
  private timeline(now: Date): TimelineItem[] {
    const items: TimelineItem[] = [];
    for (const r of this.listReminders(startOfDay(now), endOfDay(now))) {
      if (!r.shareWithFamily || r.status === 'cancelled' || r.eventId) continue;
      const isMed = isDose(r.category);
      const icon = r.category === 'medication' ? '💊' : r.category === 'injection' ? '💉' : r.category === 'appointment' ? '🩺' : '🔔';
      let statusLabel: string;
      let tone: TimelineItem['tone'];
      if (r.status === 'done') {
        statusLabel = `${isMed ? 'potwierdzone' : 'wykonane'} ${hhmm(new Date(r.doneAt!))}`;
        tone = 'done';
      } else if (r.status === 'due' && r.escalatedAt) {
        statusLabel = 'niepotwierdzone';
        tone = 'warning';
      } else if (r.status === 'due') {
        statusLabel = 'czeka na potwierdzenie';
        tone = 'pending';
      } else if (r.status === 'missed') {
        statusLabel = 'pominięte';
        tone = 'warning';
      } else {
        statusLabel = r.firstFiredAt ? 'odłożone na później' : 'zaplanowane';
        tone = 'neutral';
      }
      items.push({ key: `r${r.id}`, time: hhmm(new Date(r.plannedAt)), icon, title: r.title, statusLabel, tone });
    }
    for (const e of this.listEvents(startOfDay(now), endOfDay(now))) {
      if (!e.shareWithFamily) continue;
      const confirmed = e.status === 'confirmed';
      items.push({ key: `e${e.id}`, time: hhmm(new Date(e.startsAt)), icon: '🩺', title: e.title, statusLabel: confirmed ? 'wizyta potwierdzona' : 'wizyta zaplanowana', tone: confirmed ? 'done' : 'neutral' });
    }
    for (const t of this.tasksForDay(now)) {
      if (!t.shareWithFamily) continue;
      const done = t.status === 'done';
      const title = t.items.length ? `${t.title}: ${t.items.join(', ')}` : t.title;
      items.push({ key: `t${t.id}`, time: null, icon: t.kind === 'shopping' ? '🛒' : '📝', title, statusLabel: done ? 'wykonane' : 'zaplanowane', tone: done ? 'done' : 'neutral' });
    }
    return items.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
  }
}
