import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { healthz } from '../healthz';

describe('healthz', () => {
  it('is ok while the database answers', () => {
    expect(healthz(openDb(':memory:'))).toEqual({ status: 'ok' });
  });

  it('reports an error once the database is gone', () => {
    const db = openDb(':memory:');
    db.close();
    expect(healthz(db)).toEqual({ status: 'error' });
  });
});
