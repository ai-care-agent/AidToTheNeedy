import { Eye, Moon, RotateCcw, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SeniorDisplay } from '../../../shared/types';
import { postJson } from '../../lib/api';
import { DEFAULTS, resolveTheme, sameSettings, TEXT_SIZES, THEME_NAME, useResolvedTheme, withDefaults, type A11ySettings } from '../../lib/a11y';
import { fmtWhen } from '../../lib/format';
import { DisplayControls, PALETTES } from '../AccessibilitySheet';

/** One tap for the common cases; the controls below fine-tune. */
const PRESETS: { label: string; hint: string; icon: LucideIcon; settings: A11ySettings }[] = [
  { label: 'Słaby wzrok', hint: 'największy tekst, kontrast, pogrubienie', icon: Eye, settings: { ...DEFAULTS, scale: 175, theme: 'contrast', bold: true } },
  { label: 'Spokojnie', hint: 'kolory jak pora dnia, bez animacji, wolniejszy głos', icon: Moon, settings: { ...DEFAULTS, scale: 130, theme: 'auto', reducedMotion: true, speechRate: 0.75 } },
  { label: 'Domyślne', hint: 'jak po instalacji', icon: RotateCcw, settings: DEFAULTS },
];

/**
 * "Ekran Mamy": the family sets up her phone from theirs — bigger text, contrast, a slower
 * voice. It reaches her phone at once; she hears who changed what and can undo it there.
 */
export function SeniorScreenCard({ display, senior, now, onChange }: { display: SeniorDisplay; senior: string; now: Date; onChange: () => void }) {
  const [value, setValue] = useState<A11ySettings>(withDefaults(display.settings ?? {}));
  const [failed, setFailed] = useState(false);

  // Her own changes (or an undo) arrive with a new revision.
  useEffect(() => setValue(withDefaults(display.settings ?? {})), [display.rev]);

  async function save(next: A11ySettings) {
    const before = value;
    setValue(next);
    try {
      await postJson('/api/family/senior-display', { settings: next });
      setFailed(false);
      onChange();
    } catch {
      setValue(before);
      setFailed(true);
    }
  }

  const who = display.updatedBy === 'family' ? 'przez Ciebie' : display.updatedBy === 'senior' ? `przez: ${senior}` : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-4">
        <MiniScreen settings={value} />
        <div className="min-w-[min(12rem,100%)] flex-1 space-y-1">
          <p className="font-semibold leading-snug">
            Tekst {TEXT_SIZES.find((t) => t.scale === value.scale)?.name ?? `${value.scale}%`}, kolory: {THEME_NAME[value.theme]}
            {value.bold ? ', pogrubienie' : ''}
          </p>
          <p className="text-sm text-muted">
            {who && display.updatedAt ? `Zmienione ${who} · ${fmtWhen(display.updatedAt, now)}` : `${senior} ma ustawienia domyślne.`}
          </p>
          <p className="text-sm leading-snug text-muted">Zmiana dotrze od razu. {senior} usłyszy, co się zmieniło, i może to cofnąć jednym dotknięciem.</p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {PRESETS.map((p) => {
          const on = sameSettings(value, p.settings);
          return (
            <button
              key={p.label}
              type="button"
              aria-pressed={on}
              onClick={() => void save(p.settings)}
              className={`flex items-start gap-2 rounded-2xl p-3 text-left ring-1 transition ${on ? 'bg-brand-soft ring-2 ring-brand' : 'bg-raised ring-line hover:ring-brand'}`}
            >
              <p.icon size={20} className="mt-0.5 shrink-0 text-brand" />
              <span>
                <span className="block font-semibold">{p.label}</span>
                <span className="block text-xs leading-snug text-muted">{p.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      <details className="group">
        <summary className="cursor-pointer font-semibold text-brand">Wszystkie ustawienia</summary>
        <div className="mt-4 space-y-5">
          <DisplayControls value={value} onChange={(patch) => void save({ ...value, ...patch })} senior={false} voice />
        </div>
      </details>

      {failed && <p className="rounded-2xl bg-danger-soft px-3 py-2 text-danger">Nie udało się zapisać — sprawdź połączenie.</p>}
    </div>
  );
}

/** Her home screen in miniature, in her colours and at her text size. */
function MiniScreen({ settings }: { settings: A11ySettings }) {
  // Re-render at sunset: "Automatycznie" shows what is on her screen right now.
  useResolvedTheme();
  const t = PALETTES[resolveTheme(settings.theme)];
  const k = settings.scale / 100;
  const outline = t.outline ? `inset 0 0 0 1.5px ${t.outline}` : undefined;
  return (
    <div className="w-28 shrink-0 overflow-hidden rounded-[1.25rem] p-2 ring-4 ring-raised" style={{ background: t.bg, color: t.text, fontWeight: settings.bold ? 700 : 400 }} aria-hidden>
      <p className="font-display font-bold leading-none" style={{ fontSize: 22 * k }}>
        12:30
      </p>
      <p className="mt-1.5 rounded-lg p-1.5 leading-tight" style={{ background: t.card, fontSize: 8 * k, boxShadow: outline }}>
        Dzień dobry, Pani Halino!
      </p>
      <p className="mt-1.5 rounded-md py-1 text-center font-bold" style={{ background: t.accent, color: t.onAccent, fontSize: 8 * k }}>
        Zadzwoń
      </p>
      <p className="mt-1.5 rounded-md py-1 text-center font-bold" style={{ background: t.card, fontSize: 7 * k, boxShadow: outline }}>
        Moje leki
      </p>
    </div>
  );
}

