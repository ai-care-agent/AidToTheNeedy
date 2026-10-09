import type { Care } from '../../server/care';
import { addDays, parseLocalDateTime, startOfDay, withTime } from '../../server/time';
import type { AgentAction } from '../../shared/types';

/** One tool call the agent made, with what the tool returned. */
export interface ToolCall {
  turn: number;
  name: string;
  input: Record<string, any>;
  result: string;
  isError: boolean;
}

/** What a case left behind: the household's end state, the tool calls, the UI actions and the replies. */
export interface Outcome {
  care: Care;
  /** The time of the first turn. */
  now: Date;
  calls: ToolCall[];
  actions: AgentAction[];
  replies: string[];
}

export interface Check {
  desc: string;
  test: (o: Outcome) => boolean;
  /** Set on checks that expect this tool, so a high-impact tool it names counts as expected. */
  tool?: string;
}

/** High-impact tools that must not fire unless the case expects or allows them. */
export const GUARDED_TOOLS = ['emergency_alert', 'report_scam', 'cancel_reminder', 'cancel_calendar_event'] as const;

/** A successful call of the tool whose input matches. */
export const called = (name: string, desc = `calls ${name}`, match: (input: Record<string, any>, o: Outcome) => boolean = () => true): Check => ({
  desc,
  tool: name,
  test: (o) => o.calls.some((c) => c.name === name && !c.isError && match(c.input, o)),
});

export const notCalled = (name: string, desc = `does not call ${name}`): Check => ({
  desc,
  test: (o) => !o.calls.some((c) => c.name === name),
});

export const shows = (type: AgentAction['type'], desc = `shows ${type} on her screen`, match: (a: AgentAction) => boolean = () => true): Check => ({
  desc,
  test: (o) => o.actions.some((a) => a.type === type && match(a)),
});

export const state = (desc: string, test: (o: Outcome) => boolean): Check => ({ desc, test });

export const anyOf = (desc: string, ...checks: Check[]): Check => ({
  desc,
  tool: checks.find((c) => c.tool)?.tool,
  test: (o) => checks.some((c) => c.test(o)),
});

/** The local time `dayOffset` days after the case's first turn, at HH:mm. */
export function at(o: Outcome, dayOffset: number, time: string): Date {
  return withTime(addDays(startOfDay(o.now), dayOffset), time)!;
}

/** True when a tool's local-time argument is exactly that minute. */
export function sameMinute(value: unknown, expected: Date): boolean {
  return typeof value === 'string' && parseLocalDateTime(value)?.getTime() === expected.getTime();
}

/** Accent- and case-insensitive substring test for Polish text. */
export function mentions(text: unknown, ...needles: string[]): boolean {
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/ł/g, 'l');
  return typeof text === 'string' && needles.some((n) => fold(text).includes(fold(n)));
}

/** The guarded tools a case's checks expect, plus the ones it explicitly allows. */
export function expectedGuarded(checks: Check[], allow: readonly string[] = []): Set<string> {
  return new Set([...checks.map((c) => c.tool).filter((t): t is string => Boolean(t)), ...allow]);
}
