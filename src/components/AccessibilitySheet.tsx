import { Bold, Check, Hand, Moon, Pointer, RotateCcw, Search, Snail, Sun, Volume2, Wand, Zap, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { DEFAULTS, setA11y, SPEECH_RATES, useA11y, useSunTimes, type A11ySettings, type ResolvedTheme, type Theme } from '../lib/a11y';
import { fmtTime } from '../lib/format';
import { Sheet, TextSizeControl } from './ui';

interface Palette {
  bg: string;
  card: string;
  text: string;
  accent: string;
  onAccent: string;
  outline?: string;
}

/** The colours of each look, for previews drawn in them (the choice is seen, not described). */
export const PALETTES: Record<ResolvedTheme, Palette> = {
  dark: { bg: '#07090b', card: '#141b20', text: '#f2f5f7', accent: '#19d3a8', onAccent: '#061014' },
  light: { bg: '#f7f3ec', card: '#ffffff', text: '#1b1a17', accent: '#0d5c4f', onAccent: '#ffffff' },
  contrast: { bg: '#000000', card: '#000000', text: '#ffffff', accent: '#ffe600', onAccent: '#000000', outline: '#ffffff' },
};

export const THEMES: { key: Theme; label: string; hint: string }[] = [
  { key: 'auto', label: 'Automatycznie', hint: 'jasny w dzień, ciemny po zachodzie słońca' },
  { key: 'dark', label: 'Ciemny', hint: 'mniej razi wieczorem' },
  { key: 'light', label: 'Jasny', hint: 'ciepły, jak papier' },
  { key: 'contrast', label: 'Wysoki kontrast', hint: 'biel, czerń i żółć' },
];

/** "Dziś jasno 6:27–18:15" — when "Automatycznie" switches, in her time zone. */
export function useAutoHint(): string | null {
  const sun = useSunTimes();
  if (!sun?.sunrise || !sun.sunset) return null;
  return `dziś jasny ${fmtTime(sun.sunrise)}–${fmtTime(sun.sunset)}`;
}

function Mini({ p, time = '12:30', icon }: { p: Palette; time?: string; icon?: ReactNode }) {
  const edge = p.outline ? `inset 0 0 0 2px ${p.outline}` : undefined;
  return (
    <span className="block min-w-0 flex-1 rounded-2xl p-2.5" style={{ background: p.bg, boxShadow: edge }}>
      <span className="block rounded-xl p-2.5" style={{ background: p.card, color: p.text, boxShadow: edge }}>
        <span className="flex items-center justify-between gap-1 text-lg font-bold">
          {time} {icon}
        </span>
        <span className="mt-2 block rounded-lg px-1 py-1 text-center text-sm font-bold" style={{ background: p.accent, color: p.onAccent }}>
          Zadzwoń
        </span>
      </span>
    </span>
  );
}

/** A theme in miniature; "Automatycznie" shows its day and its evening side by side. */
export function ThemeSwatch({ theme }: { theme: Theme }) {
  if (theme !== 'auto') return <Mini p={PALETTES[theme]} />;
  return (
    <span className="flex gap-1.5">
      <Mini p={PALETTES.light} time="12:30" icon={<Sun size={16} />} />
      <Mini p={PALETTES.dark} time="21:00" icon={<Moon size={16} />} />
    </span>
  );
}

/**
 * "Ułatwienia": text size, colours, heavier text, less motion, the voice's pace, reading
 * aloud on touch and the magnifier. Changes apply at once, so she sees what she chose.
 */
export function AccessibilitySheet({
  onClose,
  onSay,
  onMagnifier,
  onSetup,
  senior = true,
}: {
  onClose: () => void;
  onSay?: (text: string) => void;
  onMagnifier?: () => void;
  onSetup?: () => void;
  senior?: boolean;
}) {
  const a = useA11y();
  return (
    <Sheet title="Ułatwienia" onClose={onClose} wide>
      {onSetup && (
        <button type="button" onClick={onSetup} className="flex min-h-[4.5rem] w-full items-center justify-center gap-3 rounded-2xl bg-brand-soft px-5 text-2xl font-bold text-brand-strong ring-2 ring-brand">
          <Wand size={28} /> Dopasuj ekran krok po kroku
        </button>
      )}
      <DisplayControls value={a} onChange={setA11y} senior={senior} onSay={onSay} />

      {onMagnifier && (
        <button type="button" onClick={onMagnifier} className="flex min-h-[4.5rem] w-full items-center justify-center gap-3 rounded-2xl bg-brand px-5 text-2xl font-bold text-on-accent">
          <Search size={30} /> Otwórz lupę
        </button>
      )}

      <button type="button" onClick={() => setA11y(DEFAULTS)} className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl font-semibold ring-2 ring-line ${senior ? 'text-xl' : ''}`}>
        <RotateCcw size={22} /> Przywróć ustawienia domyślne
      </button>
      {senior && <p className="text-center text-lg text-muted">Można też powiedzieć: „powiększ tekst”, „włącz lupę”, „mów wolniej”.</p>}
    </Sheet>
  );
}

/**
 * The controls themselves, for any settings: this device's (the sheet) or Mom's phone as the
 * family sets it remotely. `senior` makes the labels larger.
 */
export function DisplayControls({
  value: a,
  onChange,
  senior,
  voice = senior,
  onSay,
}: {
  value: A11ySettings;
  onChange: (patch: Partial<A11ySettings>) => void;
  senior: boolean;
  /** The assistant's voice and reading on touch exist only on Mom's phone. */
  voice?: boolean;
  onSay?: (text: string) => void;
}) {
  const big = senior ? 'text-2xl' : 'text-lg';
  const autoHint = useAutoHint();
  return (
    <>
      <Section title="Wielkość tekstu">
        <TextSizeControl scale={a.scale} onChange={(scale) => onChange({ scale })} />
        {senior && <p className="rounded-2xl bg-raised px-4 py-3 leading-snug">Tak będzie wyglądał tekst. Dzień dobry!</p>}
      </Section>

      <Section title="Kolory">
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Kolory">
          {THEMES.map((t) => {
            const on = a.theme === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange({ theme: t.key })}
                className={`rounded-3xl p-2 text-left ring-4 transition ${on ? 'ring-brand' : 'ring-transparent hover:ring-line'}`}
              >
                <ThemeSwatch theme={t.key} />
                <span className={`mt-2 flex items-center gap-2 font-bold ${senior ? 'text-xl' : ''}`}>
                  {on && <Check size={22} className="text-brand" />} {t.label}
                </span>
                <span className="block text-muted">{t.key === 'auto' && autoHint ? `${t.hint}; ${autoHint}` : t.hint}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Czytelność">
        <Switch icon={Bold} label="Pogrubiony tekst" hint="Litery grubsze i wyraźniejsze" on={a.bold} onChange={(bold) => onChange({ bold })} big={big} />
        <Switch icon={Snail} label="Mniej ruchu" hint="Bez animacji i migania" on={a.reducedMotion} onChange={(reducedMotion) => onChange({ reducedMotion })} big={big} />
        <Switch icon={Pointer} label="Ochrona przed drżeniem rąk" hint="Podwójne, przypadkowe dotknięcie liczy się jako jedno" on={a.steadyTouch} onChange={(steadyTouch) => onChange({ steadyTouch })} big={big} />
        <Switch icon={Zap} label="Błysk przy powiadomieniach" hint="Ekran mruga i telefon wibruje — gdy dźwięk trudno usłyszeć" on={a.flashAlerts} onChange={(flashAlerts) => onChange({ flashAlerts })} big={big} />
        {voice && <Switch icon={Hand} label="Czytaj po dotknięciu" hint="Dotknięcie dowolnego tekstu przeczyta go na głos" on={a.tapToRead} onChange={(tapToRead) => onChange({ tapToRead })} big={big} />}
      </Section>

      {voice && (
        <Section title="Głos asystentki">
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tempo mowy">
            {SPEECH_RATES.map((r) => (
              <button
                key={r.rate}
                type="button"
                role="radio"
                aria-checked={a.speechRate === r.rate}
                onClick={() => {
                  onChange({ speechRate: r.rate });
                  onSay?.(`Tak będę mówić: ${r.label.toLowerCase()}.`);
                }}
                className={`min-h-14 rounded-2xl font-bold ring-2 ${senior ? 'min-h-16 text-xl' : ''} ${a.speechRate === r.rate ? 'bg-ink text-on-accent ring-ink' : 'bg-surface ring-line hover:ring-brand'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {onSay && (
            <button type="button" onClick={() => onSay('Dzień dobry. Tak brzmi mój głos. Proszę wybrać tempo, które jest najwygodniejsze.')} className="flex min-h-14 items-center gap-2 text-xl font-semibold text-brand">
              <Volume2 size={24} /> Posłuchaj próbki
            </button>
          )}
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="kicker text-xl text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Switch({ icon: Icon, label, hint, on, onChange, big }: { icon: LucideIcon; label: string; hint: string; on: boolean; onChange: (v: boolean) => void; big: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left shadow-soft">
      <Icon size={26} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <span className={`block font-semibold leading-tight ${big}`}>{label}</span>
        <span className="block leading-snug text-muted">{hint}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className={`font-semibold ${on ? 'text-ok' : 'text-muted'}`}>{on ? 'wł.' : 'wył.'}</span>
        <span className={`relative h-9 w-16 rounded-full transition ${on ? 'bg-ok' : 'bg-line'}`}>
          <span className={`absolute top-1 size-7 rounded-full bg-white shadow ring-2 ring-black/40 transition-all ${on ? 'left-8' : 'left-1'}`} />
        </span>
      </span>
    </button>
  );
}
