import Anthropic from '@anthropic-ai/sdk';
import type { ChatResponse } from '../../shared/types';
import type { Care } from '../care';
import { config } from '../env';
import { aiStatus, describeError, fallbackParams, getClient } from './client';
import { contextBlock, seniorSystemPrompt } from './prompts';
import { buildTools, type ToolContext } from './tools';

export interface ChatInput {
  text: string;
  image?: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string };
}

const NOT_CONFIGURED =
  'Asystent głosowy nie jest jeszcze skonfigurowany. Proszę poprosić kogoś z rodziny o dodanie klucza ANTHROPIC_API_KEY w pliku .env.';

/**
 * One spoken turn: the senior's words (and optionally a photo) in, a short spoken reply out.
 * `now` is injectable so the eval (eval/agent) can replay a conversation at a fixed hour.
 */
export async function runSeniorAgent(care: Care, input: ChatInput, now = new Date()): Promise<ChatResponse> {
  care.touchActivity(now, 'chat');
  if (!aiStatus().configured) return { reply: NOT_CONFIGURED, actions: [], error: 'not_configured' };

  const ctx: ToolContext = { care, now, actions: [] };
  // Text-only history of the current session; the context block goes into the newest turn only.
  const history: Anthropic.Beta.BetaMessageParam[] = care.recentConversation(12, 30, now).map((t) => ({ role: t.role, content: t.text }));
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: 'text', text: contextBlock(care, now) }];
  if (input.image) content.push({ type: 'image', source: { type: 'base64', media_type: input.image.mediaType, data: input.image.data } });
  content.push({ type: 'text', text: input.text });

  const started = Date.now();
  const runner = getClient().beta.messages.toolRunner({
    model: config.model,
    max_tokens: 16000,
    system: [{ type: 'text', text: seniorSystemPrompt, cache_control: { type: 'ephemeral' } }],
    tools: buildTools(ctx),
    messages: [...history, { role: 'user', content }],
    ...(config.chatEffort ? { output_config: { effort: config.chatEffort } } : {}),
    max_iterations: 8,
    ...fallbackParams(),
  });

  let final: Anthropic.Beta.BetaMessage | null = null;
  const toolsUsed: string[] = [];
  const usage = { requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  try {
    for await (const message of runner) {
      final = message;
      usage.requests += 1;
      usage.input += message.usage.input_tokens;
      usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
      usage.output += message.usage.output_tokens;
      for (const block of message.content) if (block.type === 'tool_use') toolsUsed.push(block.name);
    }
  } catch (err) {
    console.error('[agent] request failed:', describeError(err));
    return { ...errorReply(err), actions: ctx.actions };
  }

  const reply = replyText(final);
  care.appendConversation('user', input.image ? `[zdjęcie dokumentu] ${input.text}` : input.text, now);
  care.appendConversation('assistant', reply, now);
  console.log(
    `[agent] ${Date.now() - started} ms · ${usage.requests} req · tools: ${toolsUsed.join(', ') || '—'} · tokens in ${usage.input} / cache read ${usage.cacheRead} / cache write ${usage.cacheWrite} / out ${usage.output} · stop: ${final?.stop_reason}`,
  );
  return { reply, actions: ctx.actions };
}

function replyText(final: Anthropic.Beta.BetaMessage | null): string {
  if (!final) return 'Przepraszam, coś poszło nie tak. Spróbujmy jeszcze raz.';
  if (final.stop_reason === 'refusal') return 'Przepraszam, w tej sprawie nie mogę pomóc. Czy mogę pomóc w czymś innym?';
  const text = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join(' ')
    // Replies are spoken; strip Markdown the model may still produce.
    .replace(/[*_#`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text) return text;
  // Only tool calls and no words means the loop hit max_iterations.
  return final.stop_reason === 'tool_use' ? 'Przepraszam, coś poszło nie tak. Spróbujmy jeszcze raz.' : 'Dobrze.';
}

function errorReply(err: unknown): Omit<ChatResponse, 'actions'> {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { reply: 'Asystent nie może się połączyć, bo klucz dostępu jest nieprawidłowy. Proszę dać znać rodzinie.', error: 'auth' };
  }
  if (err instanceof Anthropic.RateLimitError) return { reply: 'Mam teraz dużo pracy. Proszę spróbować za chwilę.', error: 'rate_limited' };
  if (err instanceof Anthropic.APIConnectionError) return { reply: 'Nie mam połączenia z internetem. Proszę spróbować za chwilę.', error: 'connection' };
  if (err instanceof Anthropic.APIError) return { reply: 'Przepraszam, wystąpił problem z asystentem. Proszę spróbować ponownie.', error: 'api_error' };
  return { reply: NOT_CONFIGURED, error: 'not_configured' };
}
