import {
  Activity,
  AudioLines,
  Contrast,
  HeartPulse,
  Home as HomeIcon,
  Monitor,
  MousePointerClick,
  Pill,
  Presentation,
  ShieldCheck,
  SlidersHorizontal,
  Type,
  UsersRound,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { IconBadge, type Tone } from '../components/ui';

const ENTRIES: { href: string; title: string; text: string; icon: LucideIcon; tone: Tone; primary?: boolean }[] = [
  { href: '/present', title: 'Tryb prezentacji', text: 'Oba telefony (albo widok komputera) i panel sterowania demo — na spotkanie.', icon: Presentation, tone: 'brand', primary: true },
  { href: '/senior', title: 'Aplikacja seniora', text: 'Głosowa asystentka: plan dnia, leki, pisma, SMS-y, wideo z rodziną, SOS.', icon: HomeIcon, tone: 'sun' },
  { href: '/family', title: 'Aplikacja rodziny', text: 'Status „Wszystko OK”, alerty, apteczka, podsumowanie dnia — bez podglądania rozmów.', icon: UsersRound, tone: 'sky' },
  { href: '/demo', title: 'Panel demo', text: 'Symulacja SMS-ów (także oszustw), leków, upadku, ciszy i zamówień.', icon: SlidersHorizontal, tone: 'sand' },
];

const SCOPE = [
  ['Asystent głosowy', 'rozmowa po polsku, przypomnienia, kalendarz, lista zadań, pamięć długoterminowa'],
  ['Pisma i wiadomości', 'zdjęcie pisma → proste wyjaśnienie, kwota, termin i przypomnienie; odczytywanie SMS-ów'],
  ['Aplikacja rodziny', 'status seniora, „Dzisiaj: lek potwierdzony, wizyta zaplanowana”, alerty, wiadomości'],
  ['Scam Shield', 'ostrzeżenie przed oszustwem w SMS-ie, piśmie lub rozmowie telefonicznej + alert dla rodziny'],
  ['Strażnik rozmowy', 'słucha rozmowy przez głośnik i ostrzega na bieżąco: BLIK, „bezpieczne konto”, „policja”'],
  ['Agent działa', 'zakupy z dostawą i taksówka na wizytę — zawsze za zgodą seniorki, większe kwoty zatwierdza rodzina'],
  ['Głos bliskich', 'wiadomości głosowe w obie strony — mama słyszy głos córki, nie syntezator'],
  ['Wgląd dla rodziny', 'podsumowanie dnia pisane przez AI, 7 dni leków, samopoczucia i aktywności, wykrywanie zmian'],
  ['Poranny briefing', 'asystentka sama zaczyna dzień: plan, pogoda i jakość powietrza (smog)'],
  ['Wideo z rodziną', 'połączenie wideo jednym dotknięciem w obie strony; mama może też poprosić głosem'],
  ['Bezpieczeństwo', 'wykrywanie upadku czujnikiem telefonu, SOS z lokalizacją, „Czy wszystko w porządku?” po długiej ciszy'],
  ['Apteczka', 'zdjęcie opakowania → lek i przypomnienia, liczenie tabletek, zamówienie w aptece, gdy się kończy'],
];

const DESIGN: { icon: LucideIcon; tone: Tone; title: string; text: string }[] = [
  { icon: Type, tone: 'sun', title: 'Duży, czytelny tekst', text: 'Atkinson Hyperlegible, tekst od 20 px, przełącznik A / A+ / A++.' },
  { icon: Contrast, tone: 'sky', title: 'Ciemno, jasno albo za słońcem', text: 'Cztery zestawy kolorów, w tym „Automatycznie”; tekst ≥ 7:1, strefy zawsze z ikoną i słowem.' },
  { icon: MousePointerClick, tone: 'rose', title: 'Duże cele dotyku', text: 'Przyciski od 56 px, kafelki z ikoną i podpisem; przesunięcie palcem to tylko skrót.' },
  { icon: AudioLines, tone: 'teal', title: 'Głos najpierw', text: 'Kula asystentki pokazuje, czy słucha, myśli czy mówi.' },
  { icon: Monitor, tone: 'lilac', title: 'Dzień w trzech kołach', text: 'Leki, ruch i sen jak w aplikacjach sportowych — dotknięcie czyta wynik na głos.' },
  { icon: ShieldCheck, tone: 'sand', title: 'Zgoda i prywatność', text: 'Nic nie dzieje się bez „Tak”; rodzina nie widzi rozmów.' },
];

const NEW: { icon: LucideIcon; tone: Tone; title: string }[] = [
  { icon: Activity, tone: 'rose', title: 'Zdrowie z opaski' },
  { icon: Video, tone: 'brand', title: 'Wideo' },
  { icon: HeartPulse, tone: 'danger', title: 'Upadek i SOS' },
  { icon: Pill, tone: 'teal', title: 'Apteczka' },
];

export function Home() {
  return (
    <main className="min-h-dvh bg-paper">
      <div className="mx-auto max-w-5xl px-5 py-10">
        <div className="flex flex-wrap items-center gap-6">
          <span className="orb size-20" data-phase="idle" aria-hidden>
            <AudioLines size={36} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold uppercase tracking-widest text-brand">Proof of concept</p>
            <h1 className="mt-1 text-4xl font-bold sm:text-5xl">AI Care Agent</h1>
            <p className="mt-3 text-xl leading-relaxed text-muted">„Twój rodzic ma pomocnika dostępnego 24/7. Ty nie musisz być dostępna 24/7.”</p>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-2">
          {NEW.map((n) => (
            <span key={n.title} className="inline-flex items-center gap-2 rounded-full bg-surface py-1 pl-1 pr-3 font-semibold shadow-sm ring-1 ring-line">
              <IconBadge icon={n.icon} tone={n.tone} size={28} /> Nowość: {n.title}
            </span>
          ))}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {ENTRIES.map((e) => (
            <a
              key={e.href}
              href={e.href}
              className={`flex gap-4 rounded-[1.75rem] p-5 shadow-soft ring-1 transition hover:-translate-y-0.5 hover:shadow-lift ${e.primary ? 'bg-brand text-on-accent ring-brand' : 'bg-surface ring-white/5'}`}
            >
              <IconBadge icon={e.icon} tone={e.primary ? 'ok' : e.tone} size={52} />
              <span>
                <span className="block text-xl font-bold">{e.title}</span>
                <span className={`mt-1 block leading-snug ${e.primary ? 'text-on-accent/85' : 'text-muted'}`}>{e.text}</span>
              </span>
            </a>
          ))}
        </div>

        <section className="mt-10">
          <h2 className="text-2xl font-bold">Projekt „Nocny puls” — sportowy wygląd, czytelny dla starszych oczu</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DESIGN.map((d) => (
              <div key={d.title} className="flex gap-3 rounded-3xl bg-surface p-4 shadow-soft ring-1 ring-white/5">
                <IconBadge icon={d.icon} tone={d.tone} size={44} />
                <div>
                  <p className="font-bold">{d.title}</p>
                  <p className="leading-snug text-muted">{d.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10 rounded-[1.75rem] bg-surface p-6 shadow-soft ring-1 ring-white/5">
          <h2 className="text-xl font-bold">Zakres POC: Senior ↔ AI Agent ↔ Rodzina</h2>
          <dl className="mt-4 space-y-3">
            {SCOPE.map(([term, desc]) => (
              <div key={term} className="grid gap-1 sm:grid-cols-[11rem_1fr]">
                <dt className="font-semibold">{term}</dt>
                <dd className="text-muted">{desc}</dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="mt-6 text-sm leading-relaxed text-muted">
          Mikrofon działa w Chrome i Edge (komputer, Android) oraz w Safari. Na telefonie aplikację trzeba otworzyć przez HTTPS (kamera, mikrofon, czujnik ruchu). Dane demo: seniorka Halina (79 lat, Lublin) i jej córka Anna.
        </p>
      </div>
    </main>
  );
}
