import type { Care } from '../care';
import { profile } from '../profile';
import { endOfDay, hhmm, polishDate } from '../time';
import { airSentence, getWeather, weatherSentence } from '../weather';
import { generateText } from './client';
import { fmtSleep } from '../health/rules';

// The morning card: the assistant starts the day by itself (plan, weather, air), then asks
// how she feels. The senior doesn't have to open anything or know what to ask.

const SYSTEM = `Przygotowujesz poranny komunikat głosowy asystentki ${profile.assistantName} dla pani ${profile.fullName} (${profile.age} lat). Zostanie przeczytany na głos, a zaraz po nim asystentka zapyta o samopoczucie.
Napisz trzy lub cztery krótkie, ciepłe zdania: powitanie („Dzień dobry, ${profile.addressAs}!”), dzień tygodnia i data, pogoda z praktyczną radą, jakość powietrza (krótko, a szczególnie wtedy, gdy jest zła), najważniejsze punkty planu dnia z godzinami. Jeśli są dane o śnie, możesz jednym ciepłym zdaniem wspomnieć, jak długo spała (bez oceny medycznej); przy dobrej pogodzie zachęć do krótkiego spaceru.
Bez list, emotikon i nawiasów. Godziny i liczby tak, żeby dobrze brzmiały na głos. Nie zadawaj pytań i nie dodawaj informacji, których nie ma w danych.`;

function planItems(care: Care, now: Date): { time: string; title: string }[] {
  const events = care.listEvents(now, endOfDay(now)).map((e) => ({ at: e.startsAt, title: `${e.title}${e.location ? ` (${e.location})` : ''}` }));
  const reminders = care
    .listReminders(now, endOfDay(now))
    .filter((r) => !r.eventId && (r.status === 'scheduled' || r.status === 'due'))
    .map((r) => ({ at: r.plannedAt, title: r.title }));
  return [...events, ...reminders].sort((a, b) => a.at.localeCompare(b.at)).map((x) => ({ time: hhmm(new Date(x.at)), title: x.title }));
}

export async function composeBriefing(care: Care, now = new Date()): Promise<string> {
  const weather = await getWeather();
  const today = weather && weatherSentence(weather, 'today');
  const air = weather && airSentence(weather);
  const plan = planItems(care, now);
  const tasks = care.openTasks().map((t) => (t.items.length ? `${t.title}: ${t.items.join(', ')}` : t.title));

  const sleep = care.health.view('senior', now).today.sleepMin;
  const facts = [
    `Data: ${polishDate(now)}.`,
    `Sen ostatniej nocy: ${sleep !== null ? fmtSleep(sleep) : 'brak danych'}`,
    `Pogoda: ${today ?? 'brak prognozy'}`,
    `Powietrze: ${air ?? 'brak danych'}`,
    `Plan na dziś:\n${plan.length ? plan.map((p) => `- ${p.time} ${p.title}`).join('\n') : '- nic nie zaplanowano'}`,
    `Zadania: ${tasks.join('; ') || 'brak'}`,
  ].join('\n');

  const fromModel = await generateText(SYSTEM, facts, 'briefing');
  if (fromModel) return fromModel;

  const planText = plan.length ? `W planie: ${plan.map((p) => `o ${p.time} ${p.title.charAt(0).toLowerCase()}${p.title.slice(1)}`).join(', ')}.` : 'Dziś nic nie jest zaplanowane.';
  return [`Dzień dobry, ${profile.addressAs}!`, `Dziś ${polishDate(now, false)}.`, today, air, planText].filter(Boolean).join(' ');
}

let inFlight = false;

/** Composes the briefing first, so the card appears complete; one at a time. */
export async function startMorningCheckin(care: Care, now = new Date()): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    care.createCheckin(now, await composeBriefing(care, now));
  } finally {
    inFlight = false;
  }
}
