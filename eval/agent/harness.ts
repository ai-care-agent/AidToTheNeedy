import '../../server/env';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { runSeniorAgent, type ChatInput } from '../../server/ai/agent';
import { setClient } from '../../server/ai/client';
import { Care } from '../../server/care';
import { openDb } from '../../server/db';
import { config } from '../../server/env';
import { seedDemo } from '../../server/seed';
import { addMinutes, parseLocalDateTime } from '../../server/time';
import type { AgentAction } from '../../shared/types';
import { cases, type AgentCase } from './cases';
import { GUARDED_TOOLS, expectedGuarded, notCalled, type Outcome, type ToolCall } from './checks';
import { DEFAULT_NOW, nullClient, pinWeather, recorder, recordingClient, type ApiExchange } from './fixtures';
import { GENERAL_RUBRIC, judgeReplies } from './judge';

// The eval-specific half of run-eval.mjs: how to load the cases, run the real agent on one,
// and grade what it did. The runner owns files, retries, timeouts and resume.

/** Pass as --model to run the null baseline: no API call, every reply is "Dobrze.". */
export const NULL_MODEL = 'null-baseline';

interface RunContext {
  model?: string;
}

interface TraceTurn {
  role: 'system' | 'user' | 'assistant' | 'tool_call' | 'tool_result';
  content: string;
  name?: string;
  thinking?: string;
}

export interface CaseRun {
  output: string;
  transcript: TraceTurn[];
  model: string | undefined;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
  stop_reason: string | undefined;
  outcome: Outcome;
  requests: number;
  retries: number;
  context: string;
}

let configuredFor: string | null = null;

function configure(model: string | undefined): void {
  if (!model) throw new Error('pass --model: the eval compares models, so the model under test must be explicit');
  if (configuredFor === model) return;
  if (configuredFor) throw new Error(`one model per run: already configured for ${configuredFor}`);
  config.model = model;
  pinWeather();
  setClient(model === NULL_MODEL ? nullClient(model) : recordingClient());
  // Agent progress lines would bury the runner's own output.
  console.log = () => {};
  configuredFor = model;
}

export async function loadCases() {
  return cases.map((c) => ({
    ...c,
    prompt: c.turns.map((t, i) => `${c.turns.length > 1 ? `[${i + 1}] ` : ''}${t.text}${t.image ? ` [zdjęcie: ${t.image}]` : ''}`).join('\n'),
    // The settings the agent ran with, so a result can be traced back to them.
    meta: { why: c.why, chat_effort: config.chatEffort, fallbacks: config.fallbacks },
  }));
}

function loadImage(name: string): NonNullable<ChatInput['image']> {
  const ext = extname(name).toLowerCase();
  const mediaType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { mediaType, data: readFileSync(join('public', 'samples', name)).toString('base64') };
}

/** A failed turn, with the HTTP status the runner's backoff needs to tell transient errors apart. */
function turnError(code: string, log: ApiExchange[]): Error {
  const last = log.findLast((ex) => ex.status !== 200);
  const detail = last?.response?.error?.message ?? 'no response recorded';
  return Object.assign(new Error(`agent turn failed (${code}): ${last?.status ?? '?'} ${detail}`), { status: last?.status });
}

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((b) => b?.type === 'text')
          .map((b) => b.text)
          .join('\n')
      : '';

export async function runCase(c: AgentCase, ctx: RunContext): Promise<CaseRun> {
  configure(ctx.model);
  const start = parseLocalDateTime(c.at ?? DEFAULT_NOW);
  if (!start) throw new Error(`case ${c.id}: bad "at" ${c.at}`);
  const care = new Care(openDb(':memory:'));
  seedDemo(care, start);
  c.setup?.(care, start);

  const log: ApiExchange[] = [];
  const turnStarts: number[] = [];
  const replies: string[] = [];
  const actions: AgentAction[] = [];
  await recorder.run(log, async () => {
    for (const [i, turn] of c.turns.entries()) {
      turnStarts.push(log.length);
      const res = await runSeniorAgent(care, { text: turn.text, image: turn.image ? loadImage(turn.image) : undefined }, addMinutes(start, i));
      if (res.error) throw turnError(res.error, log);
      replies.push(res.reply);
      actions.push(...res.actions);
    }
  });

  const turnOf = (k: number) => turnStarts.findLastIndex((s) => s <= k);
  const ok = log.map((ex, k) => ({ ex, turn: turnOf(k) })).filter(({ ex }) => ex.status === 200 && ex.response);

  // Tool calls come from each response; their results arrive in the next request.
  const calls: ToolCall[] = [];
  const byId = new Map<string, ToolCall>();
  for (const { ex, turn } of ok) {
    for (const message of ex.request?.messages ?? []) {
      for (const block of Array.isArray(message.content) ? message.content : []) {
        const call = block.type === 'tool_result' ? byId.get(block.tool_use_id) : undefined;
        if (call) Object.assign(call, { result: textOf(block.content), isError: Boolean(block.is_error) });
      }
    }
    for (const block of ex.response!.content ?? []) {
      if (block.type !== 'tool_use') continue;
      // Without a tool_result in a later request the tool never ran (the loop ran out of turns).
      const call: ToolCall = { turn, name: block.name, input: block.input ?? {}, result: '(not run)', isError: true };
      calls.push(call);
      byId.set(block.id, call);
    }
  }

  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  for (const { ex } of ok) for (const key of Object.keys(usage) as (keyof typeof usage)[]) usage[key] += ex.response!.usage?.[key] ?? 0;
  const models = [...new Set(ok.map(({ ex }) => String(ex.response!.model)))];

  // The context block is the first text of the newest user message of each turn's first request.
  const contextOf = (turn: number) => {
    const first = ok.find((x) => x.turn === turn)?.ex.request;
    const content = first?.messages?.at(-1)?.content;
    return Array.isArray(content) && content[0]?.type === 'text' ? String(content[0].text) : '';
  };

  const transcript: TraceTurn[] = [{ role: 'system', content: textOf(ok[0]?.ex.request?.system) }];
  c.turns.forEach((turn, i) => {
    transcript.push({ role: 'system', content: contextOf(i) });
    transcript.push({ role: 'user', content: `${turn.text}${turn.image ? ` [zdjęcie: ${turn.image}]` : ''}` });
    for (const { ex } of ok.filter((x) => x.turn === i)) {
      let thinking = '';
      for (const block of ex.response!.content ?? []) {
        if (block.type === 'thinking') {
          // Shown on the turn it preceded; empty unless the API returns a summary.
          thinking += block.thinking ?? '';
          continue;
        }
        if (block.type === 'text') transcript.push({ role: 'assistant', content: block.text, ...(thinking ? { thinking } : {}) });
        else if (block.type === 'tool_use') {
          transcript.push({ role: 'tool_call', name: block.name, content: JSON.stringify(block.input, null, 2), ...(thinking ? { thinking } : {}) });
          const call = byId.get(block.id);
          transcript.push({ role: 'tool_result', content: call ? `${call.isError ? 'ERROR: ' : ''}${call.result}` : '(not run)' });
        } else continue;
        thinking = '';
      }
    }
  });

  return {
    output: replies.join('\n'),
    transcript,
    model: models.length ? models.join('+') : undefined,
    usage,
    stop_reason: ok.at(-1)?.ex.response!.stop_reason,
    outcome: { care, now: start, calls, actions, replies },
    requests: ok.length,
    retries: log.length - ok.length,
    context: contextOf(0),
  };
}

export async function gradeCase(c: AgentCase, run: CaseRun) {
  const allowed = expectedGuarded(c.expect, c.allow);
  const guards = GUARDED_TOOLS.filter((t) => !allowed.has(t)).map((t) => notCalled(t, `does not call ${t}`));
  const failed = [...c.expect, ...guards].filter((check) => !check.test(run.outcome)).map((check) => check.desc);

  const rubric: Record<string, string> = { ...GENERAL_RUBRIC };
  c.rubric.forEach((text, i) => (rubric[`case_${i + 1}`] = text));
  const verdict = await judgeReplies({
    context: run.context,
    turns: c.turns.map((t, i) => ({ said: t.text, image: t.image, calls: run.outcome.calls.filter((call) => call.turn === i), reply: run.outcome.replies[i] ?? '' })),
    rubric,
  });
  const misses = verdict.items.filter((item) => !item.pass);

  const actionsOk = failed.length === 0;
  const replyOk = misses.length === 0;
  return {
    grade: { pass: Number(actionsOk && replyOk), actions: Number(actionsOk), reply: Number(replyOk) },
    explanation: {
      actions: actionsOk ? 'All checks passed.' : `Failed: ${failed.join('; ')}.`,
      reply: replyOk ? 'All rubric items passed.' : misses.map((m) => `${m.id}: ${m.reason}`).join(' | '),
    },
    judge_model: verdict.model,
    judge_usage: verdict.usage,
  };
}

/** Per-case side-channel numbers for the report (cost is derived from model × usage). */
export function perfFrom(run: CaseRun) {
  return {
    requests: run.requests,
    retries: run.retries,
    tool_calls: run.outcome.calls.length,
    in_tokens: run.usage.input_tokens + run.usage.cache_read_input_tokens + run.usage.cache_creation_input_tokens,
    out_tokens: run.usage.output_tokens,
  };
}
