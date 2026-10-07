import { dirname, join } from 'node:path';

// Imported first by the entry point: loads .env and pins the process timezone,
// so that local-time arithmetic (reminders at 08:00, "jutro") is done in the household's zone.
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on the real environment.
}

const tz = process.env.APP_TZ ?? 'Europe/Warsaw';
process.env.TZ = tz;

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** "off" omits the parameter, for models without effort support (e.g. Claude Haiku 4.5). */
function effort(value: string | undefined, fallback: Effort): Effort | null {
  if (value === 'off') return null;
  const allowed: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
  return allowed.includes(value as Effort) ? (value as Effort) : fallback;
}

const dbPath = process.env.DB_PATH ?? 'data/care.db';

export const config = {
  port: Number(process.env.PORT ?? 8787),
  tz,
  dbPath,
  audioDir: process.env.AUDIO_DIR ?? join(dbPath === ':memory:' ? 'data' : dirname(dbPath), 'audio'),
  model: process.env.AI_MODEL ?? 'claude-opus-5',
  chatEffort: effort(process.env.AI_EFFORT, 'low'),
  scamEffort: effort(process.env.AI_SCAM_EFFORT, 'medium'),
  fallbacks: (process.env.AI_FALLBACKS ?? 'on') !== 'off',
  escalateAfterMin: Number(process.env.ESCALATE_AFTER_MIN ?? 30),
  checkinTime: process.env.CHECKIN_TIME ?? '09:00',
  inactivityHours: Number(process.env.INACTIVITY_HOURS ?? 6),
  /** Orders above this total (zł) need the family's approval after she confirms. */
  spendingLimit: Number(process.env.SPENDING_LIMIT ?? 150),
  /** Daytime hours of silence before the app asks "Czy wszystko w porządku?". */
  safetyCheckHours: Number(process.env.SAFETY_CHECK_HOURS ?? 4),
  /** Minutes without an answer before the family is told. */
  safetyEscalateMin: Number(process.env.SAFETY_ESCALATE_MIN ?? 15),
  /** Where the browser reaches the app; OAuth providers redirect back to it. */
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/+$/, ''),
};
