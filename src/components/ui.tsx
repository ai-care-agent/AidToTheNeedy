import { X as XIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { TEXT_SIZES } from '../lib/a11y';

export type Tone = 'teal' | 'sun' | 'sky' | 'rose' | 'lilac' | 'sand' | 'brand' | 'ok' | 'warn' | 'danger';

/** Tint for the tile or card; the icon circle uses the deep colour of the same family. */
export const TONE: Record<Tone, { tint: string; deep: string; onDeep: string }> = {
  teal: { tint: 'bg-tint-teal', deep: 'bg-deep-teal', onDeep: 'text-on-accent' },
  sun: { tint: 'bg-tint-sun', deep: 'bg-deep-sun', onDeep: 'text-on-accent' },
  sky: { tint: 'bg-tint-sky', deep: 'bg-deep-sky', onDeep: 'text-on-accent' },
  rose: { tint: 'bg-tint-rose', deep: 'bg-deep-rose', onDeep: 'text-on-accent' },
  lilac: { tint: 'bg-tint-lilac', deep: 'bg-deep-lilac', onDeep: 'text-on-accent' },
  sand: { tint: 'bg-tint-sand', deep: 'bg-deep-sand', onDeep: 'text-on-accent' },
  brand: { tint: 'bg-brand-soft', deep: 'bg-brand', onDeep: 'text-on-accent' },
  ok: { tint: 'bg-ok-soft', deep: 'bg-ok', onDeep: 'text-on-accent' },
  warn: { tint: 'bg-warn-soft', deep: 'bg-warn', onDeep: 'text-on-accent' },
  danger: { tint: 'bg-danger-soft', deep: 'bg-danger', onDeep: 'text-on-accent' },
};

export function IconBadge({ icon: Icon, tone, size = 48, className = '' }: { icon: LucideIcon; tone: Tone; size?: number; className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full ${TONE[tone].deep} ${TONE[tone].onDeep} ${className}`} style={{ width: size, height: size }} aria-hidden>
      <Icon size={Math.round(size * 0.52)} strokeWidth={2.25} />
    </span>
  );
}

const AVATAR_TONES: Tone[] = ['rose', 'sky', 'lilac', 'sun', 'teal'];

/** Initials on a warm colour; stable per person. */
export function Avatar({ name, size = 56, ring }: { name: string; size?: number; ring?: string }) {
  const tone = AVATAR_TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-bold ${TONE[tone].deep} text-on-accent ${ring ?? ''}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {name.charAt(0)}
    </span>
  );
}

/** The text size buttons: the letter grows with the size, so the choice reads at a glance. */
export function TextSizeControl({ scale, onChange }: { scale: number; onChange: (scale: number) => void }) {
  const current = TEXT_SIZES.find((s) => s.scale === scale) ?? TEXT_SIZES[0];
  return (
    <div>
      <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Wielkość tekstu">
        {TEXT_SIZES.map((s, i) => (
          <button
            key={s.scale}
            type="button"
            role="radio"
            onClick={() => onChange(s.scale)}
            aria-checked={scale === s.scale}
            aria-label={`Tekst ${s.name}`}
            className={`grid min-h-16 place-items-center rounded-2xl font-bold leading-none ring-2 transition ${scale === s.scale ? 'bg-ink text-on-accent ring-ink' : 'bg-surface text-ink ring-line hover:ring-brand'}`}
          >
            {/* Fixed pixel sizes: the buttons must not grow with the setting they control. */}
            <span style={{ fontSize: 16 + i * 6 }}>A</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-muted">Teraz: {current.name}</p>
    </div>
  );
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Sheet({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/70 p-3 backdrop-blur-[2px] sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`animate-rise max-h-[94dvh] w-full overflow-y-auto rounded-[2rem] bg-paper p-5 shadow-lift sm:p-6 ${wide ? 'max-w-2xl' : 'max-w-lg'}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-3xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="grid size-14 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-sm ring-1 ring-line hover:ring-brand" aria-label="Zamknij">
            <XIcon size={28} />
          </button>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
}
