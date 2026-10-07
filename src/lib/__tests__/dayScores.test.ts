import { describe, expect, it } from 'vitest';
import type { HealthDay, HealthThresholds, InsightDay } from '../../../shared/types';
import { dayRings, monitorRows } from '../dayScores';

const T: HealthThresholds = { hrHigh: 120, hrLow: 40, sysHigh: 180, diaHigh: 110, sysLow: 90, spo2Low: 90, tempHigh: 38, stepsGoal: 4000 };
const health = (over: Partial<HealthDay> = {}): HealthDay => ({ date: '2026-09-29', label: 'wt', steps: 5000, sleepMin: 450, hrAvg: 70, hrMin: 58, hrMax: 90, bpSys: 130, bpDia: 80, bpReadings: 1, spo2: 96, temp: null, ...over });
const doses = (morning: InsightDay['morning'], evening: InsightDay['evening']): InsightDay => ({ date: '2026-09-29', label: 'wt', morning, evening, mood: null, interactions: 3 });

describe('rings of a day', () => {
  it('does not colour a dose still ahead of her as a failure', () => {
    const [meds] = dayRings(doses('done', 'pending'), health(), T, true);
    expect(meds).toMatchObject({ value: '1/2', zone: 'progress', sub: 'przed nią: 1' });
    expect(dayRings(doses('done', 'missed'), health(), T, false)[0].zone).toBe('yellow');
    expect(dayRings(doses('missed', 'missed'), health(), T, false)[0].zone).toBe('red');
  });

  it("shows today's steps as progress, a past day by thirds", () => {
    expect(dayRings(undefined, health({ steps: 1000 }), T, true)[1].zone).toBe('progress');
    expect(dayRings(undefined, health({ steps: 1000 }), T, false)[1].zone).toBe('red');
    expect(dayRings(undefined, health({ steps: 4200 }), T, true)[1]).toMatchObject({ zone: 'green', pct: 100, sub: 'cel osiągnięty' });
  });

  it('scores sleep against 7.5 hours', () => {
    expect(dayRings(undefined, health({ sleepMin: 330 }), T, true)[2]).toMatchObject({ value: '5:30', zone: 'yellow' });
    expect(dayRings(undefined, health({ sleepMin: null }), T, true)[2].zone).toBe('none');
  });
});

describe('health monitor', () => {
  it('compares a day with the rest of her week', () => {
    const week = [health({ hrMin: 57 }), health({ hrMin: 58 }), health({ hrMin: 60 }), health({ hrMin: 59 }), health({ hrMin: 72, bpSys: 150, bpDia: 94, steps: 900 })];
    const rows = monitorRows(week, 4, T);
    expect(rows.find((r) => r.metric === 'heart_rate')).toMatchObject({ value: '72', inRange: false });
    expect(rows.find((r) => r.metric === 'blood_pressure')).toMatchObject({ value: '150/94', inRange: false });
    // Today's steps are never judged before the day is over.
    expect(rows.find((r) => r.metric === 'steps')!.inRange).toBeNull();
    expect(monitorRows(week, 1, T).find((r) => r.metric === 'heart_rate')!.inRange).toBe(true);
  });
});
