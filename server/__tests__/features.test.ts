import { describe, expect, it } from 'vitest';
import { screenCall, verdictFromRules } from '../../shared/callGuardRules';
import { composeBriefing } from '../ai/briefing';
import { aiStatus } from '../ai/client';
import { dailySummary } from '../ai/summary';
import { buildTools } from '../ai/tools';
import { audioFile, saveAudio } from '../audio';
import { Care } from '../care';
import { openDb } from '../db';
import { config } from '../env';
import { groceryQuote, GROCERY_PARTNER } from '../partners';
import { seedDemo } from '../seed';
import { addDays, shortDate, startOfDay, withTime } from '../time';

const at = (s: string) => new Date(s);
const newCare = () => new Care(openDb(':memory:'));

function tool(care: Care, name: string, now = new Date()) {
  const t = buildTools({ care, now, actions: [] }).find((x) => x.name === name)! as unknown as { parse: (i: unknown) => unknown; run: (i: unknown) => unknown };
  return async (input: unknown) => JSON.parse(String(await t.run(t.parse(input))));
}

function order(care: Care, items: string[], now = at('2026-09-28T10:00')) {
  return care.createOrder({ kind: 'groceries', title: 'Zakupy z dostawą', ...groceryQuote(items, now), partner: GROCERY_PARTNER }, now);
}

describe('agent actions with consent', () => {
  it('places a small order on her yes and tells the family', () => {
    const care = newCare();
    const list = care.createTask({ title: 'Zakupy', kind: 'shopping', items: ['chleb', 'mleko'], createdBy: 'senior' });
    const o = care.createOrder({ kind: 'groceries', title: 'Zakupy z dostawą', ...groceryQuote(list.items, at('2026-09-28T10:00')), partner: GROCERY_PARTNER, taskId: list.id });
    expect(o.status).toBe('awaiting_senior');
    expect(care.seniorState(aiStatus()).ordersToConfirm.map((x) => x.id)).toEqual([o.id]);

    const placed = care.confirmOrder(o.id)!;
    expect(placed.status).toBe('placed');
    expect(placed.reference).toMatch(/^SO-\d{5}$/);
    expect(care.getTask(list.id)!.status).toBe('done');
    expect(care.listFeed(1)[0].title).toBe('Zamówiono zakupy');
    // She confirmed it herself, so there is no "your order was approved" card for her.
    expect(care.orderUpdates()).toEqual([]);
    expect(care.confirmOrder(o.id)).toBeNull();
  });

  it('above the limit it waits for the family, and she hears the decision', () => {
    const care = newCare();
    const big = order(care, Array.from({ length: 12 }, () => 'miód'));
    expect(big.total).toBeGreaterThan(config.spendingLimit);
    expect(big.needsFamilyApproval).toBe(true);

    expect(care.confirmOrder(big.id)!.status).toBe('awaiting_family');
    const alert = care.attentionItems()[0];
    expect(alert).toMatchObject({ kind: 'order_needs_approval', orderId: big.id });

    expect(care.approveOrder(big.id)!.status).toBe('placed');
    expect(care.attentionItems()).toEqual([]);
    expect(care.orderUpdates().map((x) => x.id)).toEqual([big.id]);
    care.markOrderSeen(big.id);
    expect(care.orderUpdates()).toEqual([]);
  });

  it('a family decline is reported back to her; her own decline is not', () => {
    const care = newCare();
    const big = order(care, Array.from({ length: 12 }, () => 'kawa'));
    care.confirmOrder(big.id);
    expect(care.declineOrder(big.id, 'family')!.status).toBe('declined');
    expect(care.orderUpdates().map((x) => x.status)).toEqual(['declined']);

    const small = order(care, ['chleb']);
    care.declineOrder(small.id, 'senior');
    expect(care.orderUpdates()).toHaveLength(1);
  });

  it('the agent can prepare orders but has no tool to confirm them', async () => {
    const care = newCare();
    care.createTask({ title: 'Zakupy', kind: 'shopping', items: ['chleb', 'jabłka'], createdBy: 'senior' });
    const result = await tool(care, 'propose_grocery_order')({});
    expect(result).toMatchObject({ ok: true, wymaga_zgody_rodziny: false });
    expect(care.getOrder(result.id)!.status).toBe('awaiting_senior');

    const names = buildTools({ care, now: new Date(), actions: [] }).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['propose_grocery_order', 'propose_taxi', 'start_call_guard', 'record_voice_message', 'get_weather']));
    expect(names.some((n) => /confirm|approve|place|pay/.test(n))).toBe(false);
  });

  it('delivery times read relative to the moment they are shown, and feed text stays absolute', () => {
    const care = newCare();
    const tomorrow10 = withTime(addDays(startOfDay(new Date()), 1), '10:00')!;
    const o = care.createOrder({ kind: 'groceries', title: 'Zakupy z dostawą', lines: [{ name: 'chleb', price: 4.99 }], total: 4.99, partner: GROCERY_PARTNER, windowStart: tomorrow10, windowLabel: '10:00–12:00' });
    expect(o.eta).toBe('jutro 10:00–12:00');
    care.confirmOrder(o.id);
    expect(care.listFeed(1)[0].detail).toContain(`dostawa ${shortDate(tomorrow10)} 10:00–12:00`);

    const old = care.createOrder({ kind: 'groceries', title: 'Zakupy', lines: [], total: 9.99, partner: GROCERY_PARTNER, windowStart: addDays(tomorrow10, -4), windowLabel: '10:00–12:00' });
    expect(old.eta).not.toMatch(/^(dziś|jutro)/);
  });

  it('withdraws a consent card nobody answered for hours', () => {
    const care = newCare();
    const o = order(care, ['chleb'], at('2026-09-28T10:00'));
    expect(care.expireStaleOrders(at('2026-09-28T12:59'))).toBe(0);
    expect(care.expireStaleOrders(at('2026-09-28T13:01'))).toBe(1);
    expect(care.getOrder(o.id)).toMatchObject({ status: 'declined', declinedBy: 'system' });
    expect(care.ordersToConfirm()).toEqual([]);
    expect(care.orderUpdates()).toEqual([]);
  });

  it('a taxi cannot be ordered for the past', async () => {
    await expect(tool(newCare(), 'propose_taxi')({ destination: 'Przychodnia', pickup_at: '2020-01-01T09:00' })).rejects.toThrow('in the past');
  });
});

describe('call guard', () => {
  const script = [
    'Dzień dobry, nazywam się komisarz Marek Wójcik, dzwonię z komendy policji.',
    'Pani wnuczka spowodowała wypadek samochodowy i została zatrzymana.',
    'Żeby uniknęła aresztu, potrzebna jest kaucja, dwadzieścia tysięcy złotych.',
  ];

  it('warns early and escalates as the "na policjanta" script unfolds', () => {
    expect(screenCall(script[0]).level).toBe('suspicious');
    expect(screenCall(script.slice(0, 2).join(' ')).level).toBe('scam');
    const verdict = verdictFromRules(script.join(' '), 'Pani Halino');
    expect(verdict.warning).toContain('Proszę się rozłączyć');
  });

  it('works on speech-recognition text without diacritics', () => {
    expect(screenCall('prosze podac kod blik i nikomu o tym nie mowic').level).toBe('scam');
  });

  it('leaves an ordinary call alone', () => {
    expect(screenCall('Cześć mamo, jak się czujesz? W sobotę przyjedziemy z Zosią na obiad.').level).toBe('safe');
    expect(screenCall('Dzień dobry, tu przychodnia, przypominamy o jutrzejszej wizycie o dziesiątej.').level).toBe('safe');
  });

  it('alerts the family once per call', () => {
    const care = newCare();
    expect(care.callGuardAlert('call-1', 'prośba o kod BLIK')).toBe(true);
    expect(care.callGuardAlert('call-1', 'prośba o kod BLIK')).toBe(false);
    expect(care.attentionItems().filter((a) => a.kind === 'call_guard')).toHaveLength(1);
  });
});

describe('insights for the family', () => {
  it('surfaces the story hidden in the last two weeks', () => {
    const care = newCare();
    const now = at('2026-09-28T14:30');
    seedDemo(care, now);
    const week = care.familyState(aiStatus(), now).insights;
    expect(week.days).toHaveLength(7);
    expect(week.days.at(-1)).toMatchObject({ date: '2026-09-28', morning: 'done', evening: 'pending' });
    expect(week.dosesTaken).toBe(11);
    expect(week.dosesPlanned).toBe(13);
    const texts = week.insights.map((i) => `${i.tone}: ${i.text}`);
    expect(texts[0]).toContain('Wieczorne leki pominięte 2 razy');
    expect(texts.join('\n')).toContain('Wczoraj mniej kontaktu');
    expect(texts.join('\n')).toContain('Samopoczucie w ostatnich dniach gorsze');
    expect(texts.join('\n')).toContain('Scam Shield zatrzymał w tym tygodniu 1 próbę');
    expect(texts.at(-1)).toBe('good: Poranne leki przyjęte każdego dnia w tym tygodniu.');
  });

  it('writes a daily summary from app facts even without AI', async () => {
    const care = newCare();
    seedDemo(care);
    const summary = await dailySummary(care);
    expect(summary.source).toBe('template');
    expect(summary.text).toContain('Leki:');
    // Cached until something changes.
    expect((await dailySummary(care)).generatedAt).toBe(summary.generatedAt);
  });
});

describe('morning briefing', () => {
  it('greets, gives the date and the rest of the day (template without AI and weather)', async () => {
    const care = newCare();
    const now = at('2026-09-29T09:00');
    care.createReminder({ title: 'Leki wieczorne', category: 'medication', at: at('2026-09-29T20:00'), createdBy: 'family', announce: false }, at('2026-09-28T12:00'));
    care.createEvent({ title: 'Wizyta u kardiologa', startsAt: at('2026-09-29T10:30'), createdBy: 'family', announce: false }, at('2026-09-28T12:00'));
    const text = await composeBriefing(care, now);
    expect(text).toMatch(/^Dzień dobry, Pani Halino! Dziś wtorek, 29 września\./);
    expect(text).toContain('o 10:30 wizyta u kardiologa');
    expect(text).toContain('o 20:00 leki wieczorne');
  });

  it('shows the briefing on the check-in card', () => {
    const care = newCare();
    const c = care.createCheckin(new Date(), 'Dzień dobry!');
    expect(care.pendingCheckin()).toMatchObject({ id: c.id, briefing: 'Dzień dobry!' });
  });
});

describe('voice messages', () => {
  it('only serves files it created', () => {
    expect(audioFile('../../etc/passwd')).toBeNull();
    expect(audioFile('../care.db')).toBeNull();
    expect(audioFile('00000000-0000-0000-0000-000000000000.webm')).toBeNull();
  });

  it('attaches the recording to the message and the family feed', () => {
    const care = newCare();
    const toMom = care.sendToSenior('anna', 'Mamo, przyjadę w sobotę', new Date(), { file: 'a.webm', seconds: 4.2 });
    expect(toMom).toMatchObject({ audioUrl: '/api/audio/a.webm', audioSeconds: 4.2 });
    care.sendToFamily('anna', 'Dobrze, czekam', false, new Date(), { file: 'b.webm', seconds: 3 });
    expect(care.listFeed(1)[0]).toMatchObject({ title: 'Wiadomość głosowa od Mamy do: Anna', mediaUrl: '/api/audio/b.webm' });
  });

  it('saves a recording and serves it back with the right type', () => {
    const name = saveAudio(Buffer.from('fake-opus').toString('base64'), 'audio/webm;codecs=opus');
    expect(name).toMatch(/^[0-9a-f-]{36}\.webm$/);
    expect(audioFile(name)).toMatchObject({ contentType: 'audio/webm' });
    expect(audioFile(name)!.path.startsWith(config.audioDir.replace(/\/$/, ''))).toBe(true);
  });
});
