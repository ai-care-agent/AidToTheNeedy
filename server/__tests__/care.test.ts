import { describe, expect, it } from 'vitest';
import { aiStatus } from '../ai/client';
import { Care } from '../care';
import { openDb } from '../db';
import { config } from '../env';
import { tick } from '../scheduler';
import { seedDemo } from '../seed';
import { addMinutes } from '../time';

const at = (s: string) => new Date(s); // local time: TZ is pinned to Europe/Warsaw
const newCare = () => new Care(openDb(':memory:'));

describe('medication reminders', () => {
  it('fires, escalates to the family and clears the alert once confirmed', () => {
    const care = newCare();
    const r = care.createReminder({ title: 'Leki wieczorne', category: 'medication', at: at('2026-09-28T20:00'), repeat: 'daily', createdBy: 'family' }, at('2026-09-28T10:00'));

    tick(care, at('2026-09-28T19:59'));
    expect(care.getReminder(r.id)!.status).toBe('scheduled');

    tick(care, at('2026-09-28T20:00'));
    expect(care.dueReminders().map((d) => d.id)).toEqual([r.id]);

    tick(care, addMinutes(at('2026-09-28T20:00'), config.escalateAfterMin));
    const family = care.familyState(aiStatus(), at('2026-09-28T20:40'));
    expect(family.status.level).toBe('attention');
    expect(family.alerts[0].title).toContain('Leki niepotwierdzone');
    expect(family.today.find((i) => i.title === 'Leki wieczorne')!.statusLabel).toBe('niepotwierdzone');

    care.completeReminder(r.id, 'senior', at('2026-09-28T20:45'));
    const after = care.familyState(aiStatus(), at('2026-09-28T20:46'));
    expect(after.alerts).toEqual([]);
    expect(after.status.level).toBe('ok');
    expect(after.feed[0].title).toBe('Leki przyjęte: Leki wieczorne');
    expect(after.feed[0].detail).toContain('z opóźnieniem');
  });

  it('creates the next daily occurrence exactly once, at the same wall-clock time', () => {
    const care = newCare();
    const r = care.createReminder({ title: 'Leki poranne', category: 'medication', at: at('2026-10-24T08:00'), repeat: 'daily', createdBy: 'family' }, at('2026-10-23T12:00'));
    tick(care, at('2026-10-24T08:00'));
    care.completeReminder(r.id, 'senior', at('2026-10-24T08:03'));
    tick(care, at('2026-10-24T08:10'));

    // 25 October 2026 is the switch from CEST to CET: still 08:00 local.
    const next = care.listReminders(at('2026-10-25T00:00'), at('2026-10-25T23:59'));
    expect(next).toHaveLength(1);
    expect(next[0].plannedAt).toBe(at('2026-10-25T08:00').toISOString());
    expect(new Date(next[0].plannedAt).getHours()).toBe(8);
  });

  it('snoozes without losing the escalation clock', () => {
    const care = newCare();
    const r = care.createReminder({ title: 'Witamina D', category: 'medication', at: at('2026-09-28T12:00'), createdBy: 'family' }, at('2026-09-28T11:00'));
    tick(care, at('2026-09-28T12:00'));
    care.snoozeReminder(r.id, 10, at('2026-09-28T12:05'));
    expect(care.dueReminders()).toEqual([]);
    tick(care, at('2026-09-28T12:15'));
    expect(care.dueReminders()).toHaveLength(1);
    tick(care, addMinutes(at('2026-09-28T12:00'), config.escalateAfterMin));
    expect(care.getReminder(r.id)!.escalatedAt).not.toBeNull();
  });

  it('records reminders missed while the server was down instead of popping them up', () => {
    const care = newCare();
    const r = care.createReminder({ title: 'Leki', category: 'medication', at: at('2026-09-28T08:00'), createdBy: 'family' }, at('2026-09-27T12:00'));
    tick(care, at('2026-09-28T16:00'));
    expect(care.getReminder(r.id)!.status).toBe('missed');
    expect(care.dueReminders()).toEqual([]);
  });

  it('stops a daily series when cancelled and tells the family', () => {
    const care = newCare();
    const r = care.createReminder({ title: 'Leki', category: 'medication', at: at('2026-09-28T08:00'), repeat: 'daily', createdBy: 'family' }, at('2026-09-27T12:00'));
    care.cancelReminder(r.id, 'agent');
    tick(care, at('2026-09-29T09:00'));
    expect(care.listReminders(at('2026-09-28T00:00'), at('2026-09-30T23:59'))).toEqual([]);
    expect(care.attentionItems()[0].title).toBe('Mama wyłączyła przypomnienie');
  });
});

describe('family view', () => {
  it('keeps private items out of the family timeline', () => {
    const care = newCare();
    const now = at('2026-09-28T10:00');
    care.createReminder({ title: 'Kupić prezent dla Anny', category: 'other', at: at('2026-09-28T15:00'), createdBy: 'agent', shareWithFamily: false }, now);
    care.createReminder({ title: 'Spacer', category: 'other', at: at('2026-09-28T16:00'), createdBy: 'agent' }, now);
    const family = care.familyState(aiStatus(), now);
    expect(family.today.map((i) => i.title)).toEqual(['Spacer']);
    expect(family.feed.map((f) => f.detail).join(' ')).not.toContain('prezent');
  });

  it('turns yellow after hours without any interaction during the day', () => {
    const care = newCare();
    care.touchActivity(at('2026-09-28T09:00'));
    expect(care.familyState(aiStatus(), at('2026-09-28T12:00')).status.level).toBe('ok');
    const later = care.familyState(aiStatus(), addMinutes(at('2026-09-28T09:00'), config.inactivityHours * 60 + 1));
    expect(later.status.level).toBe('attention');
    expect(later.status.reason).toContain('Ostatni kontakt');
  });

  it('marks urgent problems red', () => {
    const care = newCare();
    care.emergency('Silny ból w klatce piersiowej.');
    expect(care.familyState(aiStatus()).status.level).toBe('urgent');
  });

  it('reports each suspicious SMS to the family once', () => {
    const care = newCare();
    const sms = care.addSms('+44 7700 900418', 'Konto zostanie zablokowane: https://x.info');
    care.setSmsAssessment(sms.id, { verdict: 'scam', category: 'bank_impersonation', reasons: ['link'], advice: 'Proszę nie klikać.', summaryForFamily: 'SMS podszywający się pod bank.', analyzedBy: 'heuristic' });
    expect(care.reportScam('sms', 'SMS od fałszywego banku.', sms.id).alreadyReported).toBe(true);
    expect(care.attentionItems().filter((a) => a.kind === 'scam_detected')).toHaveLength(1);
    expect(care.smsAlerts().map((s) => s.id)).toEqual([sms.id]);
  });
});

describe('demo seed', () => {
  it('builds a believable afternoon', () => {
    const care = newCare();
    const now = at('2026-09-28T14:00');
    seedDemo(care, now);
    const family = care.familyState(aiStatus(), now);
    expect(family.status.level).toBe('ok');
    expect(family.today.map((i) => `${i.time} ${i.statusLabel}`)).toEqual(['08:00 potwierdzone 08:04', '11:00 wykonane 11:06', '20:00 zaplanowane', 'null zaplanowane']);
    expect(family.upcoming[0].title).toContain('kardiologa');
    expect(care.seniorState(aiStatus(), now).dueReminders).toEqual([]);
    tick(care, now);
    expect(care.pendingCheckin(now)).toBeNull();
  });
});
