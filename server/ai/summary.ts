import type { DailySummary, HealthView } from '../../shared/types';
import { readingText } from '../health';
import { fmtInt, fmtSleep } from '../health/rules';
import type { Care } from '../care';
import { familyViewer, profile } from '../profile';
import { dateKey, relativeWhen, startOfDay } from '../time';
import { aiStatus, generateText } from './client';

// Instead of four calls a day: a few sentences for the daughter, written from the same
// facts the Family App shows (never from conversation content).

const SYSTEM = `Piszesz krótkie podsumowanie dnia pani ${profile.firstName} (${profile.age} lat) dla jej córki ${familyViewer.name} w Aplikacji Rodzinnej. Masz tylko fakty z aplikacji; nie znasz treści rozmów i niczego nie zgadujesz.
Napisz dwa do czterech zdań po polsku, ciepło i konkretnie: co poszło dobrze i co wymaga uwagi, z godzinami, jeśli są. O seniorce pisz w trzeciej osobie („${profile.familyCallsHer}…”). Jeśli coś warto zrobić, zaproponuj to jednym zdaniem („Warto zadzwonić wieczorem”). Bez diagnoz i porad medycznych, bez list, nagłówków i emotikon.`;

const CACHE_KEY = 'daily_summary';

interface Cached extends DailySummary {
  fingerprint: string;
}

export async function dailySummary(care: Care, now = new Date()): Promise<DailySummary> {
  const state = care.familyState(aiStatus(), now);
  const todayFeed = state.feed.filter((f) => new Date(f.createdAt) >= startOfDay(now));
  const fingerprint = `${dateKey(now)}|${state.feed[0]?.id ?? 0}|${state.health.latest.blood_pressure?.id ?? 0}|${Math.floor((state.health.today.steps ?? 0) / 1000)}|${state.today.map((t) => t.statusLabel).join(',')}|${aiStatus().configured}`;
  const cached = care.getKv<Cached>(CACHE_KEY);
  if (cached?.fingerprint === fingerprint) return { text: cached.text, generatedAt: cached.generatedAt, source: cached.source };

  const facts = [
    `Status: ${state.status.label}${state.status.reason ? ` (${state.status.reason})` : ''}.`,
    `Ostatni kontakt z asystentką: ${state.lastActivityAt ? relativeWhen(new Date(state.lastActivityAt), now) : 'brak danych'}.`,
    `Plan dnia:\n${state.today.map((t) => `- ${t.time ?? ''} ${t.title}: ${t.statusLabel}`).join('\n') || '- brak'}`,
    `Zdarzenia dzisiaj:\n${todayFeed.map((f) => `- ${f.title}${f.detail ? `: ${f.detail}` : ''}`).join('\n') || '- brak'}`,
    `Obserwacje z tygodnia:\n${state.insights.insights.map((i) => `- ${i.text}`).join('\n') || '- brak'}`,
    `Zdrowie z opaski i ciśnieniomierza (tylko to, co udostępnia; bez interpretacji medycznej):\n${healthFacts(state.health).join('\n') || '- brak danych'}`,
  ].join('\n');

  const fromModel = await generateText(SYSTEM, facts, 'summary');
  const summary: DailySummary = { text: fromModel ?? template(care, now), generatedAt: now.toISOString(), source: fromModel ? 'model' : 'template' };
  care.setKv(CACHE_KEY, { ...summary, fingerprint });
  return summary;
}

function healthFacts(h: HealthView): string[] {
  const lines: string[] = [];
  const bp = h.latest.blood_pressure;
  if (bp) lines.push(`- Ostatnie ciśnienie: ${readingText('blood_pressure', bp.value, bp.value2)} (${bp.label})`);
  const hr = h.latest.heart_rate;
  if (hr) lines.push(`- Tętno teraz: ${readingText('heart_rate', hr.value, null)} (${hr.label})`);
  if (h.today.steps !== null) lines.push(`- Kroki dziś do teraz: ${fmtInt(h.today.steps)} (cel ${fmtInt(h.today.stepsGoal)})`);
  if (h.today.sleepMin !== null) lines.push(`- Sen ostatniej nocy: ${fmtSleep(h.today.sleepMin)}`);
  for (const i of h.insights) lines.push(`- ${i.text}`);
  if (h.staleSince) lines.push('- Opaska od dawna nie wysyła danych (może trzeba ją naładować).');
  return lines;
}

function template(care: Care, now: Date): string {
  const state = care.familyState(aiStatus(), now);
  const meds = state.today.filter((t) => t.icon === '💊');
  const taken = meds.filter((t) => t.tone === 'done').length;
  const parts = [
    meds.length ? `Leki: ${taken} z ${meds.length} dzisiejszych dawek potwierdzone.` : null,
    state.alerts.length ? `Wymaga uwagi: ${state.alerts.map((a) => a.title.toLowerCase()).join('; ')}.` : 'Nie było niepokojących zdarzeń.',
    state.lastActivityAt ? `Ostatni kontakt z asystentką: ${relativeWhen(new Date(state.lastActivityAt), now)}.` : null,
    state.health.today.steps !== null ? `Kroki dziś: ${fmtInt(state.health.today.steps)}.` : null,
    state.health.insights.find((i) => i.tone === 'watch')?.text ?? null,
  ];
  return parts.filter(Boolean).join(' ');
}
