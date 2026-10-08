import type { DB } from './db';

/**
 * For the uptime monitor and the container healthcheck. It sits in front of the password and tells
 * nothing about the household: only whether the server answers and its database is readable.
 */
export function healthz(db: DB): { status: 'ok' | 'error' } {
  try {
    // A real table, so the database file itself is read, not just the open connection.
    db.prepare('SELECT count(*) AS n FROM kv').get();
    return { status: 'ok' };
  } catch {
    return { status: 'error' };
  }
}
