import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { AiStatus } from '../../shared/types';
import { config } from '../env';

let client: Anthropic | null = null;

/** Credentials resolve from ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile. */
export function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/** Tests inject a client whose `fetch` returns canned API responses. */
export function setClient(c: Anthropic | null): void {
  client = c;
}

export function aiStatus(): AiStatus {
  const configured =
    client !== null ||
    Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE) ||
    existsSync(join(homedir(), '.config', 'anthropic'));
  return { configured, model: config.model };
}

/**
 * Request fields shared by every call: the server-side fallback re-runs a declined
 * request on Anthropic's recommended model instead of returning the refusal.
 */
export function fallbackParams(): { betas?: ['server-side-fallback-2026-07-01']; fallbacks?: 'default' } {
  return config.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `${err.status ?? ''} ${err.name}: ${err.message}`.trim();
  return err instanceof Error ? err.message : String(err);
}

/** A single plain-text completion; null when AI is off or the call fails (callers have a template). */
export async function generateText(system: string, user: string, label: string): Promise<string | null> {
  if (!aiStatus().configured) return null;
  try {
    const response = await getClient().beta.messages.create({
      model: config.model,
      max_tokens: 4000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
      ...(config.chatEffort ? { output_config: { effort: config.chatEffort } } : {}),
      ...fallbackParams(),
    });
    if (response.stop_reason === 'refusal') return null;
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .replace(/[*_#`>]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return text || null;
  } catch (err) {
    console.error(`[${label}] model call failed, using the template:`, describeError(err));
    return null;
  }
}
