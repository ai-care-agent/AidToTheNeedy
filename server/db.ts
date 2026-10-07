import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  planned_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  repeat TEXT NOT NULL DEFAULT 'none',
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_by TEXT NOT NULL,
  series_id TEXT,
  series_time TEXT,
  event_id INTEGER,
  medicine_id INTEGER,
  first_fired_at TEXT,
  done_at TEXT,
  escalated_at TEXT,
  next_spawned INTEGER NOT NULL DEFAULT 0,
  share_with_family INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reminders_due ON reminders(status, due_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  location TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  created_by TEXT NOT NULL,
  share_with_family INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  items TEXT NOT NULL DEFAULT '[]',
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL,
  share_with_family INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  done_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  text TEXT NOT NULL,
  urgent INTEGER NOT NULL DEFAULT 0,
  audio_file TEXT,
  audio_seconds REAL,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE TABLE IF NOT EXISTS sms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT NOT NULL,
  text TEXT NOT NULL,
  received_at TEXT NOT NULL,
  verdict TEXT NOT NULL DEFAULT 'pending',
  category TEXT,
  reasons TEXT NOT NULL DEFAULT '[]',
  advice TEXT,
  analyzed_by TEXT,
  senior_seen_at TEXT,
  read_at TEXT
);

CREATE TABLE IF NOT EXISTS feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  ref TEXT,
  media_url TEXT,
  geo TEXT,
  created_at TEXT NOT NULL,
  acknowledged_at TEXT
);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asked_at TEXT NOT NULL,
  answered_at TEXT,
  mood TEXT,
  note TEXT,
  briefing TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  lines TEXT NOT NULL DEFAULT '[]',
  total REAL NOT NULL,
  partner TEXT NOT NULL,
  eta TEXT,
  pickup_at TEXT,
  destination TEXT,
  reference TEXT,
  task_id INTEGER,
  medicine_id INTEGER,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  declined_by TEXT,
  senior_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS medicines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  strength TEXT,
  form TEXT,
  instructions TEXT,
  times TEXT NOT NULL DEFAULT '[]',
  dose_units REAL NOT NULL DEFAULT 1,
  stock REAL,
  pack_size INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  low_alerted_at TEXT,
  refill_snoozed_until TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS safety_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reason TEXT NOT NULL,
  asked_at TEXT NOT NULL,
  answered_at TEXT,
  answer TEXT,
  escalated_at TEXT
);

CREATE TABLE IF NOT EXISTS water_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ml INTEGER NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS water_time ON water_log(at);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_time ON activity(created_at);

CREATE TABLE IF NOT EXISTS health_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  value2 REAL,
  measured_at TEXT NOT NULL,
  source TEXT NOT NULL,
  device TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS health_time ON health_readings(metric, measured_at);
-- A sync that returns the same data twice must not double the steps.
CREATE UNIQUE INDEX IF NOT EXISTS health_unique ON health_readings(metric, source, measured_at);

CREATE TABLE IF NOT EXISTS health_sources (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  detail TEXT,
  tokens TEXT,
  connected_at TEXT,
  last_sync_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric TEXT NOT NULL,
  reading_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  answered_at TEXT,
  answer TEXT
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const TABLES = ['reminders', 'events', 'tasks', 'messages', 'sms', 'feed', 'memories', 'conversation', 'checkins', 'orders', 'medicines', 'safety_checks', 'activity', 'health_readings', 'health_sources', 'health_checks', 'water_log', 'kv'];

/** Columns added after the first release; CREATE TABLE IF NOT EXISTS won't add them to an existing file. */
const ADDED_COLUMNS: { table: string; column: string; type: string }[] = [
  { table: 'reminders', column: 'series_time', type: 'TEXT' },
  { table: 'messages', column: 'audio_file', type: 'TEXT' },
  { table: 'messages', column: 'audio_seconds', type: 'REAL' },
  { table: 'feed', column: 'media_url', type: 'TEXT' },
  { table: 'checkins', column: 'briefing', type: 'TEXT' },
  { table: 'reminders', column: 'medicine_id', type: 'INTEGER' },
  { table: 'feed', column: 'geo', type: 'TEXT' },
  { table: 'orders', column: 'medicine_id', type: 'INTEGER' },
];

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  for (const { table, column, type } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  return db;
}

export function clearAll(db: DB): void {
  db.exec(TABLES.map((t) => `DELETE FROM ${t};`).join('\n') + "\nDELETE FROM sqlite_sequence;");
}
