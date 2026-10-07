import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentAction } from '../../shared/types';
import { aiStatus } from '../ai/client';
import { buildTools } from '../ai/tools';
import { Care } from '../care';
import { openDb } from '../db';
import { config } from '../env';
import { tick } from '../scheduler';
import { addMinutes } from '../time';
import { acceptVideoCall, currentVideoCall, endVideoCall, relaySignal, startVideoCall } from '../video';

const at = (s: string) => new Date(s);
const newCare = () => new Care(openDb(':memory:'));

describe('apteczka', () => {
  const add = (care: Care, stock: number, now = at('2026-09-28T10:00')) =>
    care.addMedicine({ name: 'Atorwastatyna', strength: '20 mg', instructions: '1 tabletka wieczorem', times: ['20:00'], stock, packSize: 30, createdBy: 'senior' }, now);

  it('creates a daily reminder per time and counts pills down as doses are confirmed', () => {
    const care = newCare();
    const m = add(care, 12);
    const [r] = care.listReminders(at('2026-09-28T00:00'), at('2026-09-28T23:59'));
    expect(r).toMatchObject({ title: 'Leki wieczorne: Atorwastatyna 20 mg', category: 'medication', repeat: 'daily' });
    expect(care.listFeed(1)[0].title).toBe('Mama dodała lek do apteczki');

    tick(care, at('2026-09-28T20:00'));
    care.completeReminder(r.id, 'senior', at('2026-09-28T20:02'));
    expect(care.getMedicine(m.id)!.stock).toBe(11);
  });

  it('offers a refill once the stock runs low, once, and a refill tops it up', () => {
    const care = newCare();
    const m = add(care, 8);
    expect(care.refillSuggestions()).toEqual([]);

    const [r] = care.listReminders(at('2026-09-28T00:00'), at('2026-09-28T23:59'));
    tick(care, at('2026-09-28T20:00'));
    care.completeReminder(r.id, 'senior', at('2026-09-28T20:01'));
    expect(care.getMedicine(m.id)).toMatchObject({ stock: 7, daysLeft: 7, lowStock: true });
    expect(care.refillSuggestions().map((x) => x.id)).toEqual([m.id]);
    expect(care.listFeed(5).filter((f) => f.kind === 'medicine_low')).toHaveLength(1);

    // A second low reading in the same episode stays quiet.
    care.setMedicineStock(m.id, 6);
    expect(care.listFeed(5).filter((f) => f.kind === 'medicine_low')).toHaveLength(1);

    const order = care.orderRefill(m.id)!;
    expect(order).toMatchObject({ kind: 'pharmacy', status: 'placed' });
    expect(care.getMedicine(m.id)!.stock).toBe(36);
    expect(care.refillSuggestions()).toEqual([]);
  });

  it('"nie teraz" hides the refill offer for a day', () => {
    const care = newCare();
    const m = add(care, 3);
    care.setMedicineStock(m.id, 3);
    expect(care.refillSuggestions()).toHaveLength(1);
    care.snoozeRefill(m.id, new Date());
    expect(care.refillSuggestions(new Date())).toEqual([]);
    expect(care.refillSuggestions(addMinutes(new Date(), 25 * 60))).toHaveLength(1);
  });

  it('the agent can prepare a refill, but she confirms it', async () => {
    const care = newCare();
    const m = add(care, 3);
    const t = buildTools({ care, now: new Date(), actions: [] }).find((x) => x.name === 'propose_medicine_refill')! as unknown as { parse: (i: unknown) => unknown; run: (i: unknown) => unknown };
    const result = JSON.parse(String(await t.run(t.parse({ medicine_id: m.id }))));
    expect(care.getOrder(result.id)!.status).toBe('awaiting_senior');
  });

  it('medicines appear in both apps', () => {
    const care = newCare();
    add(care, 20);
    expect(care.seniorState(aiStatus()).medicines).toHaveLength(1);
    expect(care.familyState(aiStatus()).medicines[0]).toMatchObject({ name: 'Atorwastatyna', daysLeft: 20 });
  });
});

describe('safety', () => {
  it('asks "czy wszystko w porządku?" after a long daytime silence, only by day, and escalates if unanswered', () => {
    const care = newCare();
    care.touchActivity(at('2026-09-28T08:30'));
    tick(care, addMinutes(at('2026-09-28T08:30'), config.safetyCheckHours * 60 - 5));
    expect(care.openSafetyCheck(at('2026-09-28T12:30'))).toBeNull();

    const askedAt = addMinutes(at('2026-09-28T08:30'), config.safetyCheckHours * 60 + 1);
    tick(care, askedAt);
    const check = care.openSafetyCheck(askedAt)!;
    expect(check.reason).toBe('inactivity');

    tick(care, addMinutes(askedAt, config.safetyEscalateMin));
    expect(care.attentionItems()[0]).toMatchObject({ kind: 'safety_check', severity: 'warning', title: 'Mama nie odpowiada' });

    expect(care.answerSafetyCheck(check.id, 'ok', null, addMinutes(askedAt, 20))).toBe(true);
    expect(care.attentionItems()).toEqual([]);
    expect(care.listFeed(1)[0].title).toBe('Mama odpowiada: wszystko w porządku');
    expect(care.answerSafetyCheck(check.id, 'ok')).toBe(false);
  });

  it('never asks at night', () => {
    const care = newCare();
    care.touchActivity(at('2026-09-28T13:00'));
    tick(care, at('2026-09-28T21:30'));
    expect(care.openSafetyCheck(at('2026-09-28T21:30'))).toBeNull();
  });

  it('"potrzebuję pomocy" raises an urgent SOS with her location', () => {
    const care = newCare();
    const check = care.createSafetyCheck('manual');
    care.answerSafetyCheck(check.id, 'help', { lat: 51.24, lon: 22.56, accuracy: 20 });
    const sos = care.attentionItems()[0];
    expect(sos).toMatchObject({ kind: 'sos', severity: 'urgent', title: 'Mama potrzebuje pomocy', geo: { lat: 51.24, lon: 22.56, accuracy: 20 } });
    expect(care.familyState(aiStatus()).status.level).toBe('urgent');
  });

  it('a fall she dismisses is noted without an alarm', () => {
    const care = newCare();
    care.fallDismissed();
    expect(care.listFeed(1)[0]).toMatchObject({ kind: 'fall', severity: 'info', needsAttention: false });
  });

  it('tells the family whether she asked for help after a fall or did not answer at all', () => {
    const care = newCare();
    care.sos('fall_help', null, at('2026-09-28T10:00'));
    care.sos('fall', null, at('2026-09-28T10:05'));
    expect(care.attentionItems().map((a) => [a.kind, a.title])).toEqual([
      ['fall', 'Możliwy upadek — Mama nie odpowiada'],
      ['fall', 'Upadek — Mama prosi o pomoc'],
    ]);
  });
});

describe('video calls', () => {
  afterEach(() => {
    const c = currentVideoCall();
    if (c) endVideoCall(c.id, 'family', 'hangup');
    vi.useRealTimers();
  });

  it('rings, connects, relays signals and reports the duration', () => {
    const call = startVideoCall('family', () => {});
    expect(currentVideoCall()).toMatchObject({ status: 'ringing', from: 'family' });
    expect(relaySignal(call.id, 'family', { sdp: { type: 'offer', sdp: 'v=0' } })).toBe(true);
    expect(acceptVideoCall(call.id)!.status).toBe('active');
    expect(acceptVideoCall(call.id)).toBeNull();
    const ended = endVideoCall(call.id, 'senior', 'hangup')!;
    expect(ended.call.status).toBe('ended');
    expect(currentVideoCall()).toBeNull();
    expect(relaySignal(call.id, 'family', {})).toBe(false);
  });

  it('gives up after 45 seconds of ringing', () => {
    vi.useFakeTimers();
    const missed = vi.fn();
    startVideoCall('family', missed);
    vi.advanceTimersByTime(46_000);
    expect(missed).toHaveBeenCalledOnce();
    expect(currentVideoCall()).toBeNull();
  });

  it('a new call replaces one that is still ringing', () => {
    const first = startVideoCall('senior', () => {});
    const second = startVideoCall('family', () => {});
    expect(second.id).not.toBe(first.id);
    expect(currentVideoCall()!.id).toBe(second.id);
  });
});

describe('family nudges a dose', () => {
  it('re-announces a dose that popped up, but not one still ahead of her', () => {
    const care = newCare();
    const r = care.createReminder({ title: 'Leki wieczorne', category: 'medication', at: at('2026-09-28T20:00'), createdBy: 'family' }, at('2026-09-28T10:00'));
    expect(care.nudgeReminder(r.id, at('2026-09-28T12:00'))).toBeNull();

    tick(care, at('2026-09-28T20:00'));
    const fired = care.dueReminders()[0];
    const nudged = care.nudgeReminder(r.id, at('2026-09-28T20:40'))!;
    tick(care, at('2026-09-28T20:40'));
    const again = care.dueReminders()[0];
    expect(again.id).toBe(r.id);
    expect(again.dueAt).not.toBe(fired.dueAt);
    expect(nudged.dueAt).toBe(at('2026-09-28T20:40').toISOString());
    expect(care.listFeed(3).some((f) => f.title === 'Anna przypomniała ponownie: Leki wieczorne')).toBe(true);

    care.completeReminder(r.id, 'senior', at('2026-09-28T20:41'));
    expect(care.nudgeReminder(r.id, at('2026-09-28T20:50'))).toBeNull();
  });
});

describe('accessibility by voice', () => {
  it('turns "powiększ tekst" or "włącz lupę" into an action for her device', async () => {
    const actions: AgentAction[] = [];
    const tool = buildTools({ care: newCare(), now: new Date(), actions }).find((x) => x.name === 'adjust_screen')! as unknown as { parse: (i: unknown) => { change: string }; run: (i: unknown) => Promise<string> };
    await tool.run(tool.parse({ change: 'text_bigger' }));
    await tool.run(tool.parse({ change: 'magnifier' }));
    expect(actions).toEqual([
      { type: 'accessibility', change: 'text_bigger' },
      { type: 'accessibility', change: 'magnifier' },
    ]);
    expect(() => tool.parse({ change: 'delete_everything' })).toThrow();
  });
});

describe('her screen, set up remotely', () => {
  const big = { scale: 175, theme: 'contrast' as const, bold: true, reducedMotion: false, speechRate: 0.95, tapToRead: false, steadyTouch: false, flashAlerts: false };

  it('reaches her state with who changed it, and a new revision every time', () => {
    const care = newCare();
    expect(care.seniorState(aiStatus()).display).toEqual({ settings: null, rev: null, updatedBy: null, updatedAt: null });
    const first = care.setSeniorDisplay(big, 'family', {}, at('2026-09-29T13:00'));
    const again = care.setSeniorDisplay(big, 'family', {}, at('2026-09-29T13:01'));
    expect(again.rev).not.toBe(first.rev);
    expect(care.seniorState(aiStatus()).display).toMatchObject({ settings: big, updatedBy: 'family' });
    expect(care.familyState(aiStatus()).display.settings).toEqual(big);
  });

  it('tells the family when she undoes their change', () => {
    const care = newCare();
    care.setSeniorDisplay(big, 'family');
    care.setSeniorDisplay({ ...big, scale: 100, theme: 'dark', bold: false }, 'senior', { undo: true });
    expect(care.listFeed(1)[0].title).toBe('Mama przywróciła swoje ustawienia ekranu');
    expect(care.familyState(aiStatus()).display.updatedBy).toBe('senior');
  });
});

describe('pointing at her screen', () => {
  it('lets the assistant light up a button when she asks where something is', async () => {
    const actions: AgentAction[] = [];
    const tool = buildTools({ care: newCare(), now: new Date(), actions }).find((x) => x.name === 'show_on_screen')! as unknown as { parse: (i: unknown) => unknown; run: (i: unknown) => Promise<string> };
    const reply = JSON.parse(String(await tool.run(tool.parse({ target: 'medicines' }))));
    expect(actions).toEqual([{ type: 'guide', target: 'medicines' }]);
    expect(reply.pokazane).toBe('kafelek Moje leki');
    expect(() => tool.parse({ target: 'settings_of_the_bank' })).toThrow();
  });
});
