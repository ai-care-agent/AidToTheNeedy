import { Accessibility, Activity, FastForward, HeartPulse, ListOrdered, MessageSquareWarning, Pill, RotateCcw, ShoppingBasket, SlidersHorizontal, Sunrise, Video, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { AiStatus, SmsPreset } from '../../shared/types';
import { getJson, postJson } from '../lib/api';
import { fmtTime } from '../lib/format';

interface DemoStatus {
  now: string;
  tz: string;
  ai: AiStatus;
  escalateAfterMin: number;
  safetyCheckHours: number;
  safetyEscalateMin: number;
  spendingLimit: number;
  presets: SmsPreset[];
  demoFamilyMessage: string;
}

const BP_PRESETS: { label: string; sys: number; dia: number; tone: 'ok' | 'brand' | 'danger' }[] = [
  { label: 'Normalne', sys: 126, dia: 81, tone: 'ok' },
  { label: 'Podwyższone', sys: 152, dia: 94, tone: 'brand' },
  { label: 'Bardzo wysokie', sys: 184, dia: 112, tone: 'danger' },
];

const TEMP_PRESETS: { label: string; value: number; tone: 'ok' | 'brand' | 'danger' }[] = [
  { label: 'W normie', value: 36.6, tone: 'ok' },
  { label: 'Podgorączkowa', value: 37.7, tone: 'brand' },
  { label: 'Gorączka', value: 38.9, tone: 'danger' },
];

const SCRIPT: { step: string; say?: string }[] = [
  { step: '„Poranny briefing — teraz”: asystentka sama zaczyna dzień (plan, pogoda, smog) i pyta o samopoczucie.' },
  { step: 'Plan dnia głosem:', say: 'Co mam dzisiaj do zrobienia?' },
  { step: 'Przypomnienie o leku — teraz, potem „Eskaluj” — córka dostaje alert. „Leki wzięte” go zamyka.' },
  { step: 'SMS „Konto zostanie zablokowane” — czerwone ostrzeżenie i alert u córki. Potem:', say: 'Czy ten SMS jest prawdziwy?' },
  { step: 'Strażnik rozmowy: kafelek „Strażnik rozmowy” → „Przykładowa rozmowa na policjanta” — ostrzeżenie w trakcie rozmowy. Albo głosem:', say: 'Dzwoni do mnie ktoś z banku.' },
  { step: 'Agent działa — zakupy z dostawą (potwierdza seniorka jednym dotknięciem):', say: 'Zamów mi zakupy z mojej listy.' },
  { step: '„Duże zakupy — ponad limit”: po „Tak” córka zatwierdza w aplikacji rodzinnej.' },
  { step: 'Taksówka na wizytę:', say: 'Zamów mi taksówkę na jutrzejszą wizytę u kardiologa.' },
  { step: 'Córka nagrywa wiadomość głosową (mikrofon w „Napisz do Mamy”) — mama słyszy jej głos i odpowiada nagraniem.' },
  { step: 'Wideo jednym dotknięciem: „Wideo” w aplikacji rodziny — u mamy duży ekran „Odbierz”. Albo mama głosem:', say: 'Połącz mnie z Anną na wideo.' },
  { step: 'Upadek: „Symuluj upadek” — „Czy Pani upadła?” i 30 s na odpowiedź; bez odpowiedzi alarm z lokalizacją u córki. Przycisk SOS: 5 s na anulowanie.' },
  { step: 'Cisza w ciągu dnia: „Czy wszystko w porządku?” — bez odpowiedzi po kwadransie córka dostaje alert.' },
  { step: 'Apteczka: „Moje leki” → „Dodaj lek ze zdjęcia” → „Przykład” — przypomnienia ustawiają się z opakowania. „Lek się kończy” → zamówienie w aptece za zgodą.' },
  { step: 'Zdrowie: „Ciśnienie 184/112” — u seniorki „Ciśnienie jest wysokie” i prośba o ponowny pomiar, u córki alert. „Normalne” zamyka alert. Suwak tętna zmienia wartość na żywo w obu aplikacjach. Albo głosem:', say: 'Zmierzyłam ciśnienie, mam 150 na 95.' },
  { step: 'Ułatwienia (na dole u seniorki): wielkość tekstu, „Wysoki kontrast”, tempo głosu, czytanie po dotknięciu. Kafelek „Lupa”: aparat jako lupa — powiększ, zatrzymaj, „Przeczytaj”. Albo głosem:', say: 'Nie widzę, powiększ tekst.' },
  { step: 'Plan na dziś u seniorki: kółko przy pozycji = zrobione (z godziną), dotknięcie nazwy = „zrobione wcześniej”, zmiana godziny, usunięcie; „Dodaj” → „Już zrobione”. Woda: „+ Szklanka wody”. Albo głosem:', say: 'Wypiłam szklankę wody.' },
  { step: 'Wizyta: „Mój lekarz” → „Wizyta u kardiologa” → „Przenieś” — dzień strzałkami, godzina przyciskami; córka widzi „Mama przełożyła wizytę”. Albo głosem:', say: 'Przełóż wizytę u kardiologa na piątek na jedenastą.' },
  { step: 'Temperatura: „Gorączka 38,9 °C” poniżej — prośba o ponowny pomiar i alert u córki. Kafelek „Mój lekarz” — telefony do lekarzy i przychodni.' },
  { step: 'Pokaż palcem: w aplikacji rodziny „Opieka” → „Moje leki” — u mamy wszystko przygasa, kafelek pulsuje pod dłonią; gdy go naciśnie, córka widzi „Mama nacisnęła ✓”. Albo mama pyta:', say: 'Gdzie są moje leki?' },
  { step: '„Dopasuj ekran” (Ułatwienia w panelu) — pięć pytań jak u okulisty; każda odpowiedź od razu zmienia ekran.' },
  { step: 'Ekran Mamy zdalnie: w aplikacji rodziny „Opieka” → „Słaby wzrok” — u mamy największy tekst i kontrast, komunikat kto zmienił i przycisk „Cofnij”.' },
  { step: 'Aplikacja rodziny reaguje na żywo: nowe zdarzenia wyskakują u góry, ❤️ przy „Leki przyjęte” trafia do mamy, „Przypomnij teraz” przy niepotwierdzonej dawce wyświetla ją mamie jeszcze raz.' },
  { step: '„Przeczytaj pismo” → rachunek (przypomnienie o terminie) albo fałszywe wezwanie (ostrzeżenie).' },
  { step: 'Aplikacja rodziny: „Podsumowanie dnia” (AI) i „Ostatnie 7 dni” z obserwacjami — zamiast czterech telefonów.' },
];

export function DemoPanel({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    getJson<DemoStatus>('/api/demo/status').then(setStatus).catch(() => setLog(['✗ Brak połączenia z serwerem API']));
  }, []);

  async function run(label: string, url: string, body?: unknown) {
    setBusy(label);
    try {
      const result = await postJson<Record<string, unknown>>(url, body);
      const note = url.endsWith('/escalate') && result.escalated === 0 ? ' — brak niepotwierdzonych przypomnień' : '';
      setLog((l) => [`${fmtTime(new Date())} ✓ ${label}${note}`, ...l].slice(0, 6));
    } catch {
      setLog((l) => [`${fmtTime(new Date())} ✗ ${label}`, ...l].slice(0, 6));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`space-y-4 text-ink ${compact ? 'p-4' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <SlidersHorizontal size={22} className="text-brand" /> Panel demo
        </h1>
        {status && (
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${status.ai.configured ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}>
            {status.ai.configured ? `Claude: ${status.ai.model}` : 'Bez klucza API — tylko reguły lokalne'}
          </span>
        )}
      </div>

      <Group icon={MessageSquareWarning} title="Przychodzący SMS (Scam Shield)">
        <div className="grid gap-2">
          {status?.presets.map((p) => (
            <Action key={p.id} tone={p.expected === 'scam' ? 'danger' : 'ok'} busy={busy === p.label} onClick={() => void run(`SMS: ${p.label}`, '/api/demo/sms', { presetId: p.id })}>
              {p.label}
            </Action>
          ))}
        </div>
        <CustomSms onSend={(sender, text) => void run(`SMS od ${sender}`, '/api/demo/sms', { sender, text })} />
      </Group>

      <Group icon={Pill} title="Leki i apteczka">
        <Action busy={busy === 'Przypomnienie o leku'} onClick={() => void run('Przypomnienie o leku', '/api/demo/medication-now')}>
          Przypomnienie o leku — teraz
        </Action>
        <Action busy={busy === 'Eskalacja'} onClick={() => void run('Eskalacja', '/api/demo/escalate')}>
          <FastForward size={16} className="mr-1.5 inline" />
          Brak potwierdzenia — eskaluj teraz
        </Action>
        {status && <Hint>Bez przyspieszania alert trafia do rodziny po {status.escalateAfterMin} min.</Hint>}
        <Action busy={busy === 'Lek się kończy'} onClick={() => void run('Lek się kończy', '/api/demo/low-stock')}>
          Lek się kończy — propozycja zamówienia w aptece
        </Action>
        <Hint>Nowy lek: u seniorki „Moje leki” → „Dodaj lek ze zdjęcia” → „Przykład (demo)”.</Hint>
      </Group>

      <Group icon={HeartPulse} title="Bezpieczeństwo">
        <Action tone="danger" busy={busy === 'Upadek'} onClick={() => void run('Upadek', '/api/demo/fall')}>
          Symuluj upadek (czujnik ruchu telefonu)
        </Action>
        <Action busy={busy === 'Czy wszystko w porządku?'} onClick={() => void run('Czy wszystko w porządku?', '/api/demo/safety-check')}>
          „Czy wszystko w porządku?” — długa cisza w ciągu dnia
        </Action>
        {status && (
          <Hint>
            Bez odpowiedzi rodzina dostaje alert po {status.safetyEscalateMin} min. Pytanie pada samo po {status.safetyCheckHours} godz. ciszy w dzień. SOS: czerwony przycisk u seniorki.
          </Hint>
        )}
      </Group>

      <Group icon={Activity} title="Zdrowie (opaska i ciśnieniomierz)">
        <Action busy={busy === 'Połącz urządzenia demo'} onClick={() => void run('Połącz urządzenia demo', '/api/family/health/sources/demo/connect')}>
          Połącz opaskę i ciśnieniomierz demo
        </Action>
        <div className="grid grid-cols-3 gap-2">
          {BP_PRESETS.map((p) => (
            <Action key={p.label} tone={p.tone} busy={busy === `Ciśnienie ${p.sys}/${p.dia}`} onClick={() => void run(`Ciśnienie ${p.sys}/${p.dia}`, '/api/demo/health/reading', { metric: 'blood_pressure', value: p.sys, value2: p.dia })}>
              <span className="block">{p.label}</span>
              <span className="block tabular-nums">
                {p.sys}/{p.dia}
              </span>
            </Action>
          ))}
        </div>
        <Slider label="Tętno w spoczynku" unit="ud./min" min={40} max={160} initial={72} onCommit={(v) => void run(`Tętno ${v}`, '/api/demo/health/reading', { metric: 'heart_rate', value: v })} />
        <div className="grid grid-cols-3 gap-2">
          {TEMP_PRESETS.map((p) => (
            <Action key={p.value} tone={p.tone} busy={busy === `Temperatura ${p.value}`} onClick={() => void run(`Temperatura ${p.value}`, '/api/demo/health/reading', { metric: 'temperature', value: p.value })}>
              <span className="block">{p.label}</span>
              <span className="block tabular-nums">{String(p.value).replace('.', ',')} °C</span>
            </Action>
          ))}
        </div>
        <Slider label="Saturacja" unit="%" min={82} max={100} initial={97} onCommit={(v) => void run(`Saturacja ${v}%`, '/api/demo/health/reading', { metric: 'spo2', value: v })} />
        <Hint>Alert: ciśnienie od 180/110, tętno w spoczynku powyżej 120, saturacja poniżej 90 (progi zmienia rodzina). Prawdziwe źródła: Bluetooth na telefonie seniorki, Google Health, Withings.</Hint>
      </Group>

      <Group icon={Accessibility} title="Ułatwienia i pomoc na odległość">
        <Action busy={busy === 'Dopasuj ekran'} onClick={() => void run('Dopasuj ekran', '/api/demo/screen-setup')}>
          „Dopasuj ekran” u seniorki — jak przy pierwszym uruchomieniu
        </Action>
        <div className="grid grid-cols-2 gap-2">
          <Action busy={busy === 'Podgląd: wieczór'} onClick={() => void run('Podgląd: wieczór', '/api/demo/theme-preview', { theme: 'dark' })}>
            🌙 Zachód słońca — podgląd
          </Action>
          <Action busy={busy === 'Podgląd: dzień'} onClick={() => void run('Podgląd: dzień', '/api/demo/theme-preview', { theme: 'light' })}>
            ☀️ Dzień — podgląd
          </Action>
        </div>
        <Hint>Działa, gdy kolory to „Automatycznie” (u seniorki „Aa” albo w „Ekran Mamy” → „Spokojnie”); po 2 minutach wraca do pory dnia. W demo domyślnie ciemno; dla prawdziwych użytkowników VITE_DEFAULT_THEME=auto.</Hint>
        <Hint>„Pokaż palcem” i „Ekran Mamy”: w aplikacji rodziny, zakładka „Opieka”. U seniorki: przycisk „Aa” obok zegara.</Hint>
      </Group>

      <Group icon={Video} title="Wideo z rodziną">
        <Hint>
          „Wideo” u seniorki (przy kontakcie) albo w aplikacji rodziny. Kamera wymaga localhost lub HTTPS (<code>npm run dev:https</code>); w trybie prezentacji obie strony łączą się w jednym oknie.
        </Hint>
      </Group>

      <Group icon={Sunrise} title="Poranek i rodzina">
        <Action busy={busy === 'Poranny briefing'} onClick={() => void run('Poranny briefing', '/api/demo/checkin')}>
          Poranny briefing + „Jak się Pani czuje?” — teraz
        </Action>
        <Action onClick={() => void run('Wiadomość od Anny', '/api/demo/family-message')}>Wiadomość tekstowa od Anny</Action>
        {status && <Hint>„{status.demoFamilyMessage}”</Hint>}
      </Group>

      <Group icon={ShoppingBasket} title="Agent działa — zamówienia">
        <Action onClick={() => void run('Zamówienie z listy', '/api/demo/order', { size: 'list' })}>Zakupy z listy — do potwierdzenia</Action>
        <Action onClick={() => void run('Duże zamówienie', '/api/demo/order', { size: 'large' })}>Duże zakupy — ponad limit (zgoda rodziny)</Action>
        {status && <Hint>Limit bez zgody rodziny: {status.spendingLimit} zł. Zamówienie zawsze potwierdza seniorka.</Hint>}
      </Group>

      <Group icon={ListOrdered} title="Scenariusz prezentacji">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-snug">
          {SCRIPT.map((s) => (
            <li key={s.step}>
              {s.step}
              {s.say && <span className="mt-0.5 block font-semibold text-brand">„{s.say}”</span>}
            </li>
          ))}
        </ol>
      </Group>

      <Group icon={RotateCcw} title="Dane">
        <Action
          tone="plain"
          onClick={() => {
            if (window.confirm('Przywrócić dane demo na dziś? Obecne przypomnienia i historia zostaną usunięte.')) void run('Reset danych demo', '/api/demo/reset');
          }}
        >
          Reset danych demo
        </Action>
      </Group>

      {log.length > 0 && (
        <ul className="space-y-1 rounded-2xl bg-ink p-3 font-mono text-xs text-on-accent">
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DemoPage() {
  return (
    <main className="min-h-dvh bg-family-bg">
      <div className="mx-auto max-w-md px-4 py-6">
        <DemoPanel />
      </div>
    </main>
  );
}

function Group({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-2xl bg-surface p-3 shadow-soft ring-1 ring-white/5">
      <h2 className="flex items-center gap-2 text-sm font-bold text-muted">
        <Icon size={17} /> {title}
      </h2>
      {children}
    </section>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-snug text-muted">{children}</p>;
}

function Action({ children, onClick, tone = 'brand', busy = false }: { children: ReactNode; onClick: () => void; tone?: 'brand' | 'danger' | 'ok' | 'plain'; busy?: boolean }) {
  const tones = {
    brand: 'bg-brand-soft text-brand-strong hover:bg-brand hover:text-on-accent',
    danger: 'bg-danger-soft text-danger hover:bg-danger hover:text-on-accent',
    ok: 'bg-ok-soft text-ok hover:bg-ok hover:text-on-accent',
    plain: 'bg-paper text-ink ring-1 ring-line hover:bg-line',
  };
  return (
    <button type="button" onClick={onClick} disabled={busy} className={`w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition disabled:opacity-60 ${tones[tone]}`}>
      {children}
    </button>
  );
}

/** Sends when released, not on every pixel of the drag. */
function Slider({ label, unit, min, max, initial, onCommit }: { label: string; unit: string; min: number; max: number; initial: number; onCommit: (v: number) => void }) {
  const [value, setValue] = useState(initial);
  const commit = () => onCommit(value);
  return (
    <label className="block text-sm">
      <span className="flex justify-between font-semibold">
        {label}
        <span className="tabular-nums">
          {value} {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={(e) => (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') && commit()}
        className="mt-1 w-full accent-brand"
      />
    </label>
  );
}

function CustomSms({ onSend }: { onSend: (sender: string, text: string) => void }) {
  const [sender, setSender] = useState('');
  const [text, setText] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!sender.trim() || !text.trim()) return;
    onSend(sender.trim(), text.trim());
    setText('');
  }

  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold text-muted">Własny SMS…</summary>
      <form onSubmit={submit} className="mt-2 space-y-2">
        <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="Nadawca, np. +48 600 000 000" className="w-full rounded-lg bg-paper px-3 py-2 ring-1 ring-line" />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Treść SMS-a" className="w-full rounded-lg bg-paper px-3 py-2 ring-1 ring-line" />
        <button type="submit" className="w-full rounded-lg bg-ink py-2 font-semibold text-on-accent">
          Wyślij SMS do seniorki
        </button>
      </form>
    </details>
  );
}
