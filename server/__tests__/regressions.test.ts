import { describe, expect, it } from 'vitest';
import { aiStatus } from '../ai/client';
import { buildTools, type ToolContext } from '../ai/tools';
import { Care } from '../care';
import { openDb } from '../db';
import { tick } from '../scheduler';

// One test per bug found in code review, so they stay fixed.

const at = (s: string) => new Date(s);
const newCare = () => new Care(openDb(':memory:'));

function tool(ctx: ToolContext, name: string) {
  const t = buildTools(ctx).find((x) => x.name === name)! as unknown as { parse: (input: unknown) => unknown; run: (input: unknown) => unknown };
  // async, so a validation error thrown by run() surfaces as a rejection
  return async (input: unknown) => t.run(t.parse(input));
}

describe('reminders', () => {
  it('an unanswered evening card expires instead of hiding the next morning', () => {
    const care = newCare();
    care.createReminder({ title: 'Leki wieczorne', category: 'medication', at: at('2026-09-28T20:00'), repeat: 'daily', createdBy: 'family' }, at('2026-09-28T10:00'));
    care.createReminder({ title: 'Leki poranne', category: 'medication', at: at('2026-09-29T08:00'), repeat: 'daily', createdBy: 'family' }, at('2026-09-28T10:00'));
    for (const t of ['2026-09-28T20:00', '2026-09-28T20:30', '2026-09-29T02:01', '2026-09-29T08:00']) tick(care, at(t));

    expect(care.dueReminders().map((r) => r.title)).toEqual(['Leki poranne']);
    const evening = care.listReminders(at('2026-09-28T00:00'), at('2026-09-28T23:59'))[0];
    expect(evening.status).toBe('missed');
    // The family alert from the escalation is still there.
    expect(care.attentionItems().map((a) => a.title)).toEqual(['Leki niepotwierdzone: Leki wieczorne']);
  });

  it('keeps the recent occurrence of a daily series after a long downtime', () => {
    const care = newCare();
    const sat = care.createReminder({ title: 'Leki', category: 'medication', at: at('2026-10-03T08:00'), repeat: 'daily', createdBy: 'family' }, at('2026-10-02T12:00'));
    tick(care, at('2026-10-05T10:00')); // server was off from Saturday 07:00 to Monday 10:00
    expect(care.getReminder(sat.id)!.status).toBe('missed');
    tick(care, at('2026-10-05T10:00'));
    expect(care.dueReminders().map((r) => r.plannedAt)).toEqual([at('2026-10-05T08:00').toISOString()]);
  });

  it('a daily reminder in the spring-forward gap does not drift to a later hour', () => {
    const care = newCare();
    const r = care.createReminder({ title: 'Leki', category: 'medication', at: at('2027-03-27T02:30'), repeat: 'daily', createdBy: 'family' }, at('2027-03-26T12:00'));
    let id = r.id;
    for (const day of ['2027-03-27', '2027-03-28', '2027-03-29']) {
      tick(care, at(`${day}T04:00`));
      care.completeReminder(id, 'senior', at(`${day}T04:05`));
      id = care.listReminders(at(`${day}T23:00`), at('2027-04-30T00:00'))[0].id;
    }
    expect(new Date(care.getReminder(id)!.plannedAt).getHours()).toBe(2);
  });

  it('cancelling a finished one-off reminder changes nothing', () => {
    const care = newCare();
    const r = care.createReminder({ title: 'Spacer', category: 'other', at: at('2026-09-28T11:00'), createdBy: 'senior' }, at('2026-09-28T10:00'));
    care.completeReminder(r.id, 'senior', at('2026-09-28T11:05'));
    expect(care.cancelReminder(r.id, 'agent')!.cancelled).toBe(0);
    expect(care.getReminder(r.id)!.status).toBe('done');
    expect(care.listFeed(5).some((f) => f.kind === 'reminder_cancelled')).toBe(false);
  });

  it('snooze works on a card that was already snoozed, and refuses one that never showed', async () => {
    const care = newCare();
    const now = new Date();
    const shown = care.createReminder({ title: 'Witamina D', category: 'medication', at: now, createdBy: 'family' }, now);
    tick(care, now);
    care.snoozeReminder(shown.id, 10, now);
    expect(care.snoozeReminder(shown.id, 60, now)!.dueAt).toBe(new Date(now.getTime() + 3_600_000).toISOString());

    const later = care.createReminder({ title: 'Spacer', category: 'other', at: new Date(now.getTime() + 7_200_000), createdBy: 'senior' }, now);
    const snooze = tool({ care, now, actions: [] }, 'snooze_reminder');
    await expect(snooze({ reminder_id: later.id, minutes: 30 })).rejects.toThrow('has not popped up yet');
  });
});

describe('family view', () => {
  it('night-time silence does not turn the status yellow in the morning', () => {
    const care = newCare();
    care.touchActivity(at('2026-09-28T20:30'));
    expect(care.familyState(aiStatus(), at('2026-09-29T08:00')).status.level).toBe('ok');
    expect(care.familyState(aiStatus(), at('2026-09-29T11:00')).status.level).toBe('ok');
    const afternoon = care.familyState(aiStatus(), at('2026-09-29T14:00'));
    expect(afternoon.status.level).toBe('attention');
    expect(afternoon.status.reason).toContain('wczoraj o 20:30');
  });

  it('a double-tapped check-in answer alerts the family once', () => {
    const care = newCare();
    const c = care.createCheckin(at('2026-09-28T09:00'));
    expect(care.answerCheckin(c.id, 'bad', null, at('2026-09-28T09:01'))).toBe(true);
    expect(care.answerCheckin(c.id, 'bad', null, at('2026-09-28T09:01'))).toBe(false);
    expect(care.answerCheckin(9999, 'bad')).toBe(false);
    expect(care.attentionItems().filter((a) => a.kind === 'wellbeing')).toHaveLength(1);
  });

  it('private shopping items never join the list the family sees', async () => {
    const care = newCare();
    const now = at('2026-09-28T10:00');
    care.createTask({ title: 'Zakupy', kind: 'shopping', items: ['chleb'], createdBy: 'senior' }, now);
    const addTask = tool({ care, now, actions: [] }, 'add_task');
    await addTask({ title: 'Prezent', kind: 'shopping', items: ['prezent dla Anny'], share_with_family: false });
    await addTask({ title: 'Zakupy', kind: 'shopping', items: ['mleko'], share_with_family: true });

    const visible = care.familyState(aiStatus(), now).today.map((i) => i.title).join(' | ');
    expect(visible).toContain('Zakupy: chleb, mleko');
    expect(visible).not.toContain('prezent');
  });

  it('keeps the newest memories when there are many', () => {
    const care = newCare();
    for (let i = 1; i <= 61; i++) care.remember(`Fakt numer ${i}.`);
    const facts = care.memories();
    expect(facts).toHaveLength(60);
    expect(facts.at(-1)).toBe('Fakt numer 61.');
  });
});

describe('Scam Shield and the inbox', () => {
  it('reading the inbox leaves SMS that are still being checked unread', async () => {
    const care = newCare();
    const now = new Date();
    const sms = care.addSms('+44 7700 900418', 'Konto zostanie zablokowane: https://x.info', now);
    await tool({ care, now, actions: [] }, 'read_inbox')({});
    care.setSmsAssessment(sms.id, { verdict: 'scam', category: 'bank_impersonation', reasons: ['link'], advice: 'Proszę nie klikać.', summaryForFamily: 'SMS podszywający się pod bank.', analyzedBy: 'model' });
    expect(care.smsAlerts().map((s) => s.id)).toEqual([sms.id]);
  });

  it('does not alert the family twice when the agent reported the SMS first', () => {
    const care = newCare();
    const sms = care.addSms('+44 7700 900418', 'Konto zostanie zablokowane: https://x.info');
    care.reportScam('sms', 'SMS od fałszywego banku.', sms.id);
    care.setSmsAssessment(sms.id, { verdict: 'scam', category: 'bank_impersonation', reasons: ['link'], advice: 'Proszę nie klikać.', summaryForFamily: 'SMS podszywający się pod bank.', analyzedBy: 'model' });
    expect(care.attentionItems().filter((a) => a.kind === 'scam_detected')).toHaveLength(1);
  });
});
