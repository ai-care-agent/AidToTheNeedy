import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { runSeniorAgent } from '../ai/agent';
import { setClient } from '../ai/client';
import { assessSms } from '../ai/scamShield';
import { Care } from '../care';
import { openDb } from '../db';
import { config } from '../env';
import { seedDemo, smsPresets } from '../seed';
import { addDays, dateKey, endOfDay, startOfDay } from '../time';

// The real SDK and tool runner run against a fake transport, so the whole loop —
// request shape, tool execution, tool results, final reply — is exercised offline.

interface Captured {
  body: Record<string, any>;
  headers: Headers;
}

function fakeClaude(responses: Array<Record<string, unknown> | { status: number }>) {
  const requests: Captured[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    if ('status' in next) return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }), { status: next.status as number, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  setClient(new Anthropic({ apiKey: 'test-key', fetch, maxRetries: 0 }));
  return requests;
}

const message = (content: unknown[], stop_reason: string) => ({
  id: `msg_${Math.random().toString(36).slice(2)}`,
  type: 'message',
  role: 'assistant',
  model: config.model,
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
});

function household() {
  const care = new Care(openDb(':memory:'));
  seedDemo(care);
  return care;
}

afterEach(() => setClient(null));

describe('senior voice agent', () => {
  it('creates a reminder through the tool loop and answers in one short reply', async () => {
    const care = household();
    const tomorrow9 = `${dateKey(addDays(new Date(), 1))}T09:00`;
    const requests = fakeClaude([
      message([{ type: 'tool_use', id: 'toolu_1', name: 'create_reminder', input: { title: 'Zadzwonić do Zosi', at: tomorrow9, category: 'other', repeat: 'none', share_with_family: true } }], 'tool_use'),
      message([{ type: 'text', text: 'Dobrze, przypomnę jutro o dziewiątej, żeby zadzwonić do Zosi.' }], 'end_turn'),
    ]);

    const res = await runSeniorAgent(care, { text: 'Przypomnij mi jutro o dziewiątej, żeby zadzwonić do Zosi.' });

    expect(res).toEqual({ reply: 'Dobrze, przypomnę jutro o dziewiątej, żeby zadzwonić do Zosi.', actions: [] });
    const tomorrow = addDays(new Date(), 1);
    const created = care.listReminders(startOfDay(tomorrow), endOfDay(tomorrow)).find((r) => r.title === 'Zadzwonić do Zosi');
    expect(created).toMatchObject({ category: 'other', createdBy: 'agent', shareWithFamily: true });
    expect(care.listFeed(1)[0].title).toBe('Mama dodała przypomnienie');
    expect(care.recentConversation().map((t) => t.role)).toEqual(['user', 'assistant']);

    const [first, second] = requests;
    expect(first.body.model).toBe(config.model);
    expect(first.body.output_config).toEqual(config.chatEffort ? { effort: config.chatEffort } : undefined);
    expect(first.body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(first.body.tools.map((t: { name: string }) => t.name)).toContain('create_reminder');
    expect(first.body.messages.at(-1).content[0].text).toContain('<kontekst_aplikacji>');
    if (config.fallbacks) {
      expect(first.body.fallbacks).toBe('default');
      expect(first.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    }
    const toolResult = second.body.messages.at(-1).content[0];
    expect(toolResult).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' });
    expect(JSON.parse(toolResult.content)).toMatchObject({ ok: true, tytul: 'Zadzwonić do Zosi' });
  });

  it('keeps tool definitions and the system prompt identical between turns (cacheable prefix)', async () => {
    const care = household();
    const requests = fakeClaude([message([{ type: 'text', text: 'Dzień dobry!' }], 'end_turn'), message([{ type: 'text', text: 'Proszę bardzo.' }], 'end_turn')]);
    await runSeniorAgent(care, { text: 'Dzień dobry' });
    await runSeniorAgent(care, { text: 'Dziękuję' });
    expect(JSON.stringify(requests[1].body.tools)).toBe(JSON.stringify(requests[0].body.tools));
    expect(requests[1].body.system).toEqual(requests[0].body.system);
    // The second turn carries the first one as plain text history.
    expect(requests[1].body.messages.slice(0, 2)).toEqual([
      { role: 'user', content: 'Dzień dobry' },
      { role: 'assistant', content: 'Dzień dobry!' },
    ]);
  });

  it('returns UI actions for calls and emergencies', async () => {
    const care = household();
    fakeClaude([
      message(
        [
          { type: 'tool_use', id: 'toolu_a', name: 'emergency_alert', input: { description: 'Silny ból w klatce piersiowej.' } },
          { type: 'tool_use', id: 'toolu_b', name: 'call_family', input: { contact_id: 'anna' } },
        ],
        'tool_use',
      ),
      message([{ type: 'text', text: 'Proszę natychmiast zadzwonić pod numer sto dwanaście. Powiadomiłam Annę.' }], 'end_turn'),
    ]);
    const res = await runSeniorAgent(care, { text: 'Bardzo boli mnie w klatce piersiowej.' });
    expect(res.actions.map((a) => a.type)).toEqual(['emergency', 'call']);
    expect(care.attentionItems()[0]).toMatchObject({ severity: 'urgent', kind: 'emergency' });
  });

  it('hands invalid tool input back to the model as an error instead of executing it', async () => {
    const care = household();
    const requests = fakeClaude([
      message([{ type: 'tool_use', id: 'toolu_x', name: 'create_reminder', input: { title: 'Leki', at: '2020-01-01T08:00', category: 'medication', repeat: 'none', share_with_family: true } }], 'tool_use'),
      message([{ type: 'text', text: 'Na którą godzinę ustawić przypomnienie?' }], 'end_turn'),
    ]);
    await runSeniorAgent(care, { text: 'Przypomnij mi o lekach.' });
    const result = requests[1].body.messages.at(-1).content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('in the past');
  });

  it('answers politely when the request is declined', async () => {
    const care = household();
    fakeClaude([message([], 'refusal')]);
    const res = await runSeniorAgent(care, { text: '…' });
    expect(res.reply).toContain('nie mogę pomóc');
  });

  it('speaks a friendly message when the API fails', async () => {
    const care = household();
    fakeClaude([{ status: 500 }]);
    const res = await runSeniorAgent(care, { text: 'Co mam dzisiaj?' });
    expect(res.error).toBe('api_error');
    expect(res.reply).toContain('Proszę spróbować ponownie');
  });
});

describe('Scam Shield classifier', () => {
  const bank = smsPresets.find((p) => p.id === 'bank')!;

  it('uses the structured verdict from the model', async () => {
    const requests = fakeClaude([
      message(
        [{ type: 'text', text: JSON.stringify({ verdict: 'scam', category: 'bank_impersonation', reasons: ['Link do fałszywej strony banku.'], advice_for_senior: 'Proszę nie klikać w link.', summary_for_family: 'SMS podszywający się pod bank.' }) }],
        'end_turn',
      ),
    ]);
    const a = await assessSms(bank.sender, bank.text);
    expect(a).toMatchObject({ verdict: 'scam', category: 'bank_impersonation', analyzedBy: 'model', advice: 'Proszę nie klikać w link.' });
    expect(requests[0].body.output_config.format.type).toBe('json_schema');
    expect(requests[0].body.messages[0].content).toContain('<sms>');
  });

  it('falls back to local rules when the API is unavailable', async () => {
    fakeClaude([{ status: 503 }]);
    const a = await assessSms(bank.sender, bank.text);
    expect(a).toMatchObject({ verdict: 'scam', analyzedBy: 'heuristic' });
  });
});
