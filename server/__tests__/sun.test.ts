import { describe, expect, it } from 'vitest';
import { aiStatus } from '../ai/client';
import { Care } from '../care';
import { openDb } from '../db';
import { sunTimes } from '../sun';

const hhmm = (d: Date | null) => d && d.toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });
const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
/** Within a few minutes of the published tables. */
const near = (got: string | null, want: string) => expect(Math.abs(minutes(got!) - minutes(want))).toBeLessThanOrEqual(3);

describe('sunrise and sunset', () => {
  it('matches the tables for Warsaw and Lublin through the year', () => {
    const warsaw = sunTimes(new Date('2026-09-29T12:00:00+02:00'), 52.2297, 21.0122);
    near(hhmm(warsaw.sunrise), '06:33');
    near(hhmm(warsaw.sunset), '18:21');
    const midsummer = sunTimes(new Date('2026-06-21T12:00:00+02:00'), 51.2465, 22.5684);
    near(hhmm(midsummer.sunrise), '04:13');
    near(hhmm(midsummer.sunset), '20:50');
    const midwinter = sunTimes(new Date('2026-12-21T12:00:00+01:00'), 51.2465, 22.5684);
    near(hhmm(midwinter.sunrise), '07:32');
    near(hhmm(midwinter.sunset), '15:26');
  });

  it('has no sunrise in a polar night, and both apps get the household times', () => {
    expect(sunTimes(new Date('2026-12-21T12:00:00Z'), 69.65, 18.96)).toEqual({ sunrise: null, sunset: null });
    const care = new Care(openDb(':memory:'));
    const now = new Date('2026-09-29T10:00:00Z');
    const sun = care.seniorState(aiStatus(), now).sun;
    expect(sun.sunrise! < now.toISOString() && now.toISOString() < sun.sunset!).toBe(true);
    expect(care.familyState(aiStatus(), now).sun).toEqual(sun);
  });
});
