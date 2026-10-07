import type { GuideTarget } from './guide';

// DTOs shared by the server and the web apps. All timestamps are ISO-8601 strings (UTC).

export type Actor = 'senior' | 'family' | 'agent' | 'system';

/** 'medication' and 'injection' are doses: the family is told when one isn't confirmed. */
export type ReminderCategory = 'medication' | 'injection' | 'appointment' | 'other';
export type ReminderStatus = 'scheduled' | 'due' | 'done' | 'missed' | 'cancelled';

export interface Reminder {
  id: number;
  title: string;
  category: ReminderCategory;
  /** Originally planned time — what the family sees. */
  plannedAt: string;
  /** When it pops up next (differs from plannedAt after a snooze). */
  dueAt: string;
  repeat: 'none' | 'daily';
  status: ReminderStatus;
  createdBy: Actor;
  firstFiredAt: string | null;
  doneAt: string | null;
  escalatedAt: string | null;
  eventId: number | null;
  shareWithFamily: boolean;
}

export interface CalendarEvent {
  id: number;
  title: string;
  startsAt: string;
  location: string | null;
  notes: string | null;
  status: 'planned' | 'confirmed' | 'cancelled';
  createdBy: Actor;
  shareWithFamily: boolean;
}

export interface Task {
  id: number;
  title: string;
  kind: 'shopping' | 'other';
  items: string[];
  /** Local date YYYY-MM-DD, or null for "whenever". */
  dueDate: string | null;
  status: 'open' | 'done';
  createdBy: Actor;
  doneAt: string | null;
  shareWithFamily: boolean;
}

export type SmsVerdict = 'pending' | 'safe' | 'suspicious' | 'scam';

export interface Sms {
  id: number;
  sender: string;
  text: string;
  receivedAt: string;
  verdict: SmsVerdict;
  category: string | null;
  reasons: string[];
  advice: string | null;
  analyzedBy: 'model' | 'heuristic' | null;
  /** Set once the senior dismissed the warning / notification. */
  seniorSeenAt: string | null;
  readAt: string | null;
}

export interface FamilyMessage {
  id: number;
  direction: 'to_senior' | 'to_family';
  contactId: string;
  /** For a voice message: what was said (live transcript), if the browser could transcribe it. */
  text: string;
  urgent: boolean;
  /** Voice messages: the recording, played in the other person's app. */
  audioUrl: string | null;
  audioSeconds: number | null;
  createdAt: string;
  readAt: string | null;
}

export type FeedKind =
  | 'medication_taken'
  | 'medication_missed'
  | 'reminder_done'
  | 'reminder_missed'
  | 'reminder_created'
  | 'reminder_cancelled'
  | 'event_created'
  | 'task_created'
  | 'task_done'
  | 'scam_detected'
  | 'message_from_senior'
  | 'call_request'
  | 'wellbeing'
  | 'emergency'
  | 'family_action'
  | 'order_placed'
  | 'order_needs_approval'
  | 'order_declined'
  | 'call_guard'
  | 'sos'
  | 'fall'
  | 'safety_check'
  | 'medicine_added'
  | 'medicine_low'
  | 'video_call'
  | 'health';

export type FeedSeverity = 'info' | 'success' | 'warning' | 'urgent';

export interface FeedItem {
  id: number;
  kind: FeedKind;
  severity: FeedSeverity;
  title: string;
  detail: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  /** Warning/urgent item nobody has acknowledged yet. */
  needsAttention: boolean;
  /** A voice message attached to the item (played inline). */
  mediaUrl: string | null;
  /** Set for an order that waits for the family's approval. */
  orderId: number | null;
  /** Where she was when she asked for help (SOS, fall), if the phone shared it. */
  geo: GeoPoint | null;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  accuracy: number | null;
}

export type Mood = 'good' | 'ok' | 'bad';

export interface Checkin {
  id: number;
  askedAt: string;
  answeredAt: string | null;
  mood: Mood | null;
  /** Morning briefing spoken before the wellbeing question (plan, weather, air quality). */
  briefing: string | null;
}

export type OrderKind = 'groceries' | 'taxi' | 'pharmacy';
export type OrderStatus = 'awaiting_senior' | 'awaiting_family' | 'placed' | 'declined';

/** Something the agent prepared on her behalf; only a person can confirm it. */
export interface Order {
  id: number;
  kind: OrderKind;
  status: OrderStatus;
  title: string;
  lines: { name: string; price: number }[];
  total: number;
  partner: string;
  /** Human-readable delivery window or pickup time. */
  eta: string | null;
  destination: string | null;
  reference: string | null;
  /** Above the household's spending limit the family must approve after she confirms. */
  needsFamilyApproval: boolean;
  createdAt: string;
  decidedAt: string | null;
  declinedBy: Actor | null;
}

/** Needed for Polish past-tense verbs ("dodał" / "dodała"). */
export type Gender = 'f' | 'm';

export interface Contact {
  id: string;
  name: string;
  relation: string;
  phone: string;
  gender: Gender;
}

export interface SeniorProfile {
  firstName: string;
  fullName: string;
  gender: Gender;
  age: number;
  city: string;
  /** Polite vocative used by the assistant, e.g. "Pani Halino". */
  addressAs: string;
  /** How the family refers to the senior, e.g. "Mama", with the forms Polish needs ("od Mamy", "zadzwoń do Mamy", "ostrzegł Mamę"). */
  familyCallsHer: string;
  familyCallsHerGenitive: string;
  familyCallsHerAccusative: string;
  familyCallsHerInstrumental: string;
  phone: string;
  assistantName: string;
}

export interface AiStatus {
  configured: boolean;
  model: string;
}

export interface SeniorState {
  now: string;
  tz: string;
  profile: SeniorProfile;
  contacts: Contact[];
  today: { reminders: Reminder[]; events: CalendarEvent[]; tasks: Task[] };
  dueReminders: Reminder[];
  incomingMessages: FamilyMessage[];
  smsAlerts: Sms[];
  newSms: Sms[];
  pendingCheckin: Checkin | null;
  /** Orders waiting for her yes/no, and decided ones she hasn't been told about yet. */
  ordersToConfirm: Order[];
  orderUpdates: Order[];
  medicines: Medicine[];
  /** Running low and not yet reordered or postponed: she is offered a refill (with its price). */
  refillSuggestions: { medicine: Medicine; price: number; eta: string }[];
  safetyCheck: SafetyCheck | null;
  video: VideoCallState | null;
  health: HealthView;
  /** Her screen settings as last saved (by her, or by the family from their app). */
  display: SeniorDisplay;
  sun: SunTimes;
  careTeam: CareTeam;
  water: WaterToday;
  /** Her visits from now on (the coming month). */
  upcomingEvents: CalendarEvent[];
  /** Her doses over the last 7 days, for the rings on her home screen. */
  week: InsightDay[];
  /** A worrying reading she has not answered yet ("zmierz jeszcze raz"). */
  healthCheck: HealthCheck | null;
  lastExchange: { user: string; assistant: string; at: string } | null;
  ai: AiStatus;
}

export type StatusLevel = 'ok' | 'attention' | 'urgent';

export interface TimelineItem {
  key: string;
  /** Local HH:mm, or null for items without a time (e.g. shopping). */
  time: string | null;
  icon: string;
  title: string;
  statusLabel: string;
  tone: 'done' | 'pending' | 'warning' | 'neutral';
}

export interface FamilyState {
  now: string;
  tz: string;
  profile: SeniorProfile;
  contacts: Contact[];
  viewer: Contact;
  status: { level: StatusLevel; label: string; reason: string | null };
  lastActivityAt: string | null;
  alerts: FeedItem[];
  today: TimelineItem[];
  upcoming: CalendarEvent[];
  feed: FeedItem[];
  sentMessages: FamilyMessage[];
  orders: Order[];
  insights: WeeklyInsights;
  spendingLimit: number;
  medicines: Medicine[];
  video: VideoCallState | null;
  /** Only the metrics she shares with the family; the others are null. */
  health: HealthView;
  display: SeniorDisplay;
  sun: SunTimes;
  careTeam: CareTeam;
  water: WaterToday;
  ai: AiStatus;
}

/** One medicine in her "apteczka", as she (or the photo of the box) described it. */
export interface Medicine {
  id: number;
  name: string;
  strength: string | null;
  form: string | null;
  /** Dosing as printed on the box or the prescription — never invented. */
  instructions: string | null;
  /** Local HH:mm, one daily reminder each. */
  times: string[];
  doseUnits: number;
  stock: number | null;
  packSize: number | null;
  daysLeft: number | null;
  lowStock: boolean;
}

/** What the photo of a box says, before she agrees to add it. */
export interface MedicineProposal {
  name: string;
  strength: string | null;
  form: string | null;
  instructions: string | null;
  times: string[];
  doseUnits: number;
  packSize: number | null;
  /** Anything unclear on the photo, said plainly. */
  caution: string | null;
}

export interface SafetyCheck {
  id: number;
  reason: 'inactivity' | 'manual';
  askedAt: string;
}

export type VideoCallStatus = 'ringing' | 'active' | 'ended';

export interface VideoCallState {
  id: string;
  from: 'senior' | 'family';
  status: VideoCallStatus;
  startedAt: string;
  acceptedAt: string | null;
}

export type DoseStatus = 'done' | 'missed' | 'pending' | 'none';

export interface InsightDay {
  /** Local date YYYY-MM-DD. */
  date: string;
  /** Short Polish weekday label, e.g. "pon". */
  label: string;
  morning: DoseStatus;
  evening: DoseStatus;
  mood: Mood | null;
  /** Interactions with the app that day (conversations, confirmations, answers). */
  interactions: number;
}

export interface Insight {
  tone: 'good' | 'watch' | 'info';
  text: string;
}

export interface WeeklyInsights {
  days: InsightDay[];
  dosesTaken: number;
  dosesPlanned: number;
  scamsBlocked: number;
  insights: Insight[];
}

export interface DailySummary {
  text: string;
  generatedAt: string;
  source: 'model' | 'template';
}

export type AgentAction =
  | { type: 'call'; contact: Contact }
  | { type: 'emergency' }
  | { type: 'call_guard' }
  | { type: 'record_message'; contact: Contact }
  | { type: 'video_call'; contact: Contact }
  | { type: 'accessibility'; change: AccessibilityChange }
  | { type: 'guide'; target: GuideTarget };

// ------------------------------------------------------------------ water

export interface WaterToday {
  ml: number;
  goalMl: number;
  /** One tap on "+ szklanka" adds this much. */
  glassMl: number;
  lastAt: string | null;
}

// ------------------------------------------------------------------ her doctors and clinic

export interface Doctor {
  id: string;
  name: string;
  /** "lekarz rodzinny", "kardiolog"… */
  specialty: string;
  phone: string | null;
  /** Where this doctor sees her, when it's not the main clinic. */
  place: string | null;
}

export interface Clinic {
  name: string;
  address: string | null;
  phone: string | null;
  /** "pn–pt 8:00–18:00" */
  hours: string | null;
}

/** Who treats her — shown with call buttons on her phone, edited by the family. */
export interface CareTeam {
  clinic: Clinic | null;
  doctors: Doctor[];
  updatedAt: string | null;
}

// ------------------------------------------------------------------ her screen ("Ułatwienia")

/** 'auto' is light from sunrise to sunset at her home, dark after. */
export type DisplayTheme = 'auto' | 'dark' | 'light' | 'contrast';

/** Today's sunrise and sunset at the household (null in a polar day or night). */
export interface SunTimes {
  sunrise: string | null;
  sunset: string | null;
}

/** How her phone shows and says things; she or the family can change it. */
export interface DisplaySettings {
  /** Root font size in %. */
  scale: number;
  theme: DisplayTheme;
  bold: boolean;
  reducedMotion: boolean;
  speechRate: number;
  tapToRead: boolean;
  /** Tremor: a second tap within a moment of the first is ignored. */
  steadyTouch: boolean;
  /** Hard of hearing: the screen flashes (and the phone vibrates) with every chime. */
  flashAlerts: boolean;
}

export interface SeniorDisplay {
  settings: DisplaySettings | null;
  /** Changes with every save (a random id, so a demo reset can't make an old one look new). */
  rev: string | null;
  updatedBy: 'senior' | 'family' | null;
  updatedAt: string | null;
}

/** What she can change by voice on her own device ("powiększ tekst", "włącz lupę"). */
export const ACCESSIBILITY_CHANGES = ['text_bigger', 'text_smaller', 'speak_slower', 'speak_faster', 'theme_dark', 'theme_light', 'theme_contrast', 'magnifier', 'settings'] as const;
export type AccessibilityChange = (typeof ACCESSIBILITY_CHANGES)[number];

export interface ChatResponse {
  reply: string;
  actions: AgentAction[];
  /** Machine-readable problem, e.g. "not_configured"; the reply is still speakable. */
  error?: string;
}

export interface SmsPreset {
  id: string;
  label: string;
  sender: string;
  text: string;
  expected: 'scam' | 'safe';
}

export type CallGuardLevel = 'safe' | 'suspicious' | 'scam';

export interface CallGuardVerdict {
  level: CallGuardLevel;
  /** Short Polish reason shown on screen, e.g. "prośba o kod BLIK". */
  reason: string | null;
  /** One urgent spoken sentence when the level is not safe. */
  warning: string | null;
  source: 'rules' | 'model';
}

export interface WeatherNow {
  temp: number | null;
  description: string;
  air: string | null;
  airLevel: 'good' | 'moderate' | 'poor' | null;
}

// ------------------------------------------------------------------ health (bands, cuffs, manual readings)

export type HealthMetric = 'heart_rate' | 'blood_pressure' | 'steps' | 'sleep' | 'spo2' | 'temperature';

export const HEALTH_METRICS: HealthMetric[] = ['heart_rate', 'blood_pressure', 'temperature', 'steps', 'sleep', 'spo2'];

export type HealthSourceId = 'demo' | 'bluetooth' | 'google' | 'withings' | 'manual';

/** 'normal' = in the usual range, 'watch' = worth a look, 'alert' = she is asked to measure again. */
export type HealthLevel = 'normal' | 'watch' | 'alert';

export interface HealthReading {
  id: number;
  metric: HealthMetric;
  /** bpm, systolic mmHg, steps, minutes asleep, SpO2 %, body temperature °C. */
  value: number;
  /** Diastolic mmHg for blood pressure. */
  value2: number | null;
  measuredAt: string;
  source: HealthSourceId;
  device: string | null;
}

export interface HealthLatest extends HealthReading {
  level: HealthLevel;
  /** Plain Polish, never a diagnosis: "w typowym zakresie", "podwyższone". */
  label: string;
}

export interface HealthDay {
  /** Local date YYYY-MM-DD. */
  date: string;
  label: string;
  steps: number | null;
  sleepMin: number | null;
  hrAvg: number | null;
  hrMin: number | null;
  hrMax: number | null;
  /** Average of the day's blood-pressure readings. */
  bpSys: number | null;
  bpDia: number | null;
  bpReadings: number;
  spo2: number | null;
  /** The day's highest body temperature, °C. */
  temp: number | null;
}

export interface HealthSource {
  id: HealthSourceId;
  name: string;
  kind: 'band' | 'cloud' | 'demo';
  metrics: HealthMetric[];
  status: 'connected' | 'available' | 'not_configured' | 'error';
  lastSyncAt: string | null;
  /** Account or device name, or the last error. */
  detail: string | null;
  /** What it takes to use it (free developer account, env variables…). */
  setup: string;
}

export interface HealthThresholds {
  hrHigh: number;
  hrLow: number;
  sysHigh: number;
  diaHigh: number;
  sysLow: number;
  spo2Low: number;
  /** Body temperature from which she is asked to measure again and the family is told (°C). */
  tempHigh: number;
  stepsGoal: number;
}

export interface HealthView {
  latest: Partial<Record<HealthMetric, HealthLatest>>;
  today: { steps: number | null; stepsGoal: number; sleepMin: number | null };
  /** The last 7 days, oldest first. */
  days: HealthDay[];
  insights: Insight[];
  sources: HealthSource[];
  sharing: Record<HealthMetric, boolean>;
  thresholds: HealthThresholds;
  /** Set when no band or cuff has sent anything for a long while (flat battery?). */
  staleSince: string | null;
}

export interface HealthCheck {
  id: number;
  metric: HealthMetric;
  reading: HealthLatest;
  createdAt: string;
}

/** The pulse as a band reports it right now (pushed over SSE, not stored every beat). */
export interface LivePulse {
  bpm: number;
  at: string;
  source: HealthSourceId;
}
