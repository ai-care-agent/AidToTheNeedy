import { describe, expect, it } from 'vitest';
import { aiStatus } from '../ai/client';
import { Care } from '../care';
import { openDb } from '../db';
import { tick } from '../scheduler';

const at = (s: string) => new Date(s);
const newCare = () => new Care(openDb(':memory:'));

describe('her plan for the day, by hand', () => {
  it('ticks a dose at the time she took it, and a tap by mistake can be undone', () => {
    const care = newCare();
    const m = care.addMedicine({ name: 'Metformina', strength: '500 mg', instructions: null, times: ['08:00'], stock: 10, packSize: 30, createdBy: 'family' }, at('2026-09-29T06:00'));
    const [r] = care.listReminders(at('2026-09-29T00:00'), at('2026-09-29T23:59'));
    tick(care, at('2026-09-29T08:00'));

    const done = care.completeReminder(r.id, 'senior', at('2026-09-29T09:30'), at('2026-09-29T08:10'))!;
    expect(done).toMatchObject({ status: 'done', doneAt: at('2026-09-29T08:10').toISOString() });
    expect(care.getMedicine(m.id)!.stock).toBe(9);
    expect(care.listFeed(1)[0].detail).toContain('Potwierdzone o 08:10');

    const undone = care.undoReminder(r.id, 'senior', at('2026-09-29T09:31'))!;
    expect(undone).toMatchObject({ status: 'scheduled', doneAt: null });
    // Back in ten minutes, not at once.
    expect(undone.dueAt).toBe(at('2026-09-29T09:41').toISOString());
    expect(care.getMedicine(m.id)!.stock).toBe(10);
    expect(care.undoReminder(r.id, 'senior')).toBeNull();
  });

  it('moves a daily item from today on, or skips just today', () => {
    const care = newCare();
    const r = care.createReminder({ title: 'Krople do oczu', category: 'medication', at: at('2026-09-29T09:00'), repeat: 'daily', createdBy: 'family' }, at('2026-09-29T07:00'));
    const moved = care.updateReminder(r.id, { time: '10:30', title: 'Krople do oczu (2 krople)' }, 'senior', at('2026-09-29T07:05'))!;
    expect(moved).toMatchObject({ title: 'Krople do oczu (2 krople)', status: 'scheduled' });
    expect(moved.plannedAt).toBe(at('2026-09-29T10:30').toISOString());
    expect(care.listFeed(1)[0].title).toBe('Mama zmieniła plan');

    // Today skipped, tomorrow still there — at the new time.
    care.skipOccurrence(r.id, 'senior', at('2026-09-29T07:10'));
    expect(care.getReminder(r.id)!.status).toBe('cancelled');
    const tomorrow = care.listReminders(at('2026-09-30T00:00'), at('2026-09-30T23:59'));
    expect(tomorrow).toHaveLength(1);
    expect(tomorrow[0].plannedAt).toBe(at('2026-09-30T10:30').toISOString());
  });

  it('treats an injection like a dose: escalated when not confirmed, and named as such', () => {
    const care = newCare();
    const r = care.createReminder({ title: 'Insulina', category: 'injection', at: at('2026-09-29T12:00'), createdBy: 'family' }, at('2026-09-29T10:00'));
    tick(care, at('2026-09-29T12:00'));
    tick(care, at('2026-09-29T12:31'));
    expect(care.attentionItems().map((a) => a.title)).toContain('Zastrzyk niepotwierdzony: Insulina');
    care.completeReminder(r.id, 'family', at('2026-09-29T12:40'));
    expect(care.listFeed(1)[0].title).toBe('Zastrzyk wykonany: Insulina');
    expect(care.listFeed(1)[0].detail).toContain('przez: Anna');
  });

  it('counts water in glasses, tells the family once at the goal, and takes back a mistaken glass', () => {
    const care = newCare();
    const now = at('2026-09-29T15:00');
    for (let i = 0; i < 5; i++) care.addWater(250, now);
    expect(care.waterToday(now)).toMatchObject({ ml: 1250, goalMl: 1500 });
    care.addWater(250, now);
    care.addWater(250, now);
    expect(care.listFeed(5).filter((f) => f.title.startsWith('Woda:'))).toHaveLength(1);
    expect(care.removeLastWater(now).ml).toBe(1500);
    expect(care.seniorState(aiStatus(), now).water.ml).toBe(1500);
    expect(care.familyState(aiStatus(), now).water.ml).toBe(1500);
    expect(care.waterToday(at('2026-09-30T09:00')).ml).toBe(0);
  });

  it('reopens a task ticked by mistake', () => {
    const care = newCare();
    const t = care.createTask({ title: 'Kupić chleb', kind: 'shopping', items: [], createdBy: 'senior' });
    care.completeTask(t.id, 'senior');
    expect(care.reopenTask(t.id)!.status).toBe('open');
  });
});

describe('moving a visit', () => {
  it('moves the visit and its reminder together, keeping the lead time, and tells the family', () => {
    const care = newCare();
    const now = at('2026-09-29T09:00');
    const { event, reminder } = care.createEvent({ title: 'Wizyta u kardiologa', startsAt: at('2026-09-30T10:30'), location: 'Przychodnia Lipowa', createdBy: 'family', remindBeforeMin: 60 }, now);
    const moved = care.moveEvent(event.id, at('2026-10-02T12:00'), 'senior', now)!;
    expect(moved.startsAt).toBe(at('2026-10-02T12:00').toISOString());
    const r = care.getReminder(reminder!.id)!;
    expect(r).toMatchObject({ status: 'scheduled', title: 'Wizyta u kardiologa o 12:00' });
    expect(r.plannedAt).toBe(at('2026-10-02T11:00').toISOString());
    expect(care.listFeed(1)[0]).toMatchObject({ title: 'Mama przełożyła wizytę' });
    expect(care.seniorState(aiStatus(), now).upcomingEvents.map((e) => e.id)).toEqual([event.id]);
  });

  it('drops a reminder whose moment has passed, and cancelling clears both', () => {
    const care = newCare();
    const { event, reminder } = care.createEvent({ title: 'Okulista', startsAt: at('2026-09-29T16:00'), createdBy: 'senior', remindBeforeMin: 120 }, at('2026-09-29T09:00'));
    // Moved to 14:30 at 13:00: "two hours before" would be 12:30, already gone.
    care.moveEvent(event.id, at('2026-09-29T14:30'), 'senior', at('2026-09-29T13:00'));
    expect(care.getReminder(reminder!.id)!.status).toBe('cancelled');

    const second = care.createEvent({ title: 'Dentysta', startsAt: at('2026-10-05T09:00'), createdBy: 'family', remindBeforeMin: 60 }, at('2026-09-29T09:00'));
    care.cancelEvent(second.event.id, 'senior', at('2026-09-29T13:05'));
    expect(care.getEvent(second.event.id)!.status).toBe('cancelled');
    expect(care.getReminder(second.reminder!.id)!.status).toBe('cancelled');
    expect(care.listFeed(1)[0].title).toBe('Mama odwołała wizytę');
    expect(care.cancelEvent(second.event.id, 'senior')).toBeNull();
  });
});
