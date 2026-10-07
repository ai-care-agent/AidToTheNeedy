import { ArrowLeft, ArrowRight, Check, Volume2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { DEFAULTS, describeChange, setA11y, SPEECH_RATES, TEXT_SIZES, useA11y } from '../../lib/a11y';
import { ThemeSwatch, THEMES, useAutoHint } from '../AccessibilitySheet';

// "Dopasuj ekran": five questions instead of a settings page, the way an optician asks
// "which line can you read?". Every answer applies at once, so she judges the real screen.

type Step = 'text' | 'colors' | 'voice' | 'hands' | 'hearing' | 'done';
const STEPS: Step[] = ['text', 'colors', 'voice', 'hands', 'hearing', 'done'];

const QUESTION: Record<Step, string> = {
  text: 'Który napis czyta Pani bez wysiłku? Proszę wybrać najmniejszy, który jest wygodny.',
  colors: 'Który ekran widać najlepiej?',
  voice: 'Jak szybko mam mówić? Proszę posłuchać i wybrać.',
  hands: 'Czy zdarza się, że ręka drży i przycisk naciska się dwa razy?',
  hearing: 'Czy dźwięk powiadomień bywa za cichy albo trudno go usłyszeć?',
  done: 'Gotowe. Tak będzie wyglądał Pani ekran.',
};

export function SetupWizard({ onDone, onSay }: { onDone: () => void; onSay: (text: string, rate?: number) => void }) {
  const a = useA11y();
  const autoHint = useAutoHint();
  const [i, setI] = useState(0);
  const step = STEPS[i];

  useEffect(() => {
    onSay(QUESTION[step]);
  }, [step]);

  const next = () => (i === STEPS.length - 1 ? onDone() : setI(i + 1));
  const changes = describeChange(DEFAULTS, a);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-paper" role="dialog" aria-modal="true" aria-label="Dopasuj ekran">
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pb-6 pt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="kicker text-2xl text-muted">
            Dopasuj ekran · {Math.min(i + 1, 5)}/5
          </p>
          {step !== 'done' && (
            <button type="button" onClick={onDone} className="min-h-14 rounded-2xl px-4 text-xl font-semibold text-muted ring-2 ring-line">
              Pomiń
            </button>
          )}
        </div>
        <div className="mt-3 flex gap-1.5" aria-hidden>
          {STEPS.slice(0, 5).map((s, k) => (
            <span key={s} className={`h-2 flex-1 rounded-full ${k <= i ? 'bg-brand' : 'bg-line'}`} />
          ))}
        </div>

        <h2 className="mt-5 text-2xl font-bold leading-tight">{QUESTION[step]}</h2>

        <div className="mt-6 flex-1 space-y-3">
          {step === 'text' &&
            TEXT_SIZES.map((t, k) => (
              <Choice key={t.scale} on={a.scale === t.scale} onClick={() => setA11y({ scale: t.scale })}>
                {/* Pixel sizes: the samples must not grow with the size they offer. */}
                <span className="font-semibold" style={{ fontSize: 18 + k * 5, lineHeight: 1.2 }}>
                  Dzień dobry, jak się Pani czuje?
                </span>
              </Choice>
            ))}

          {step === 'colors' &&
            THEMES.map((t) => (
              <Choice key={t.key} on={a.theme === t.key} onClick={() => setA11y({ theme: t.key })}>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className={`block shrink-0 ${t.key === 'auto' ? 'w-52' : 'w-28'}`}>
                    <ThemeSwatch theme={t.key} />
                  </span>
                  <span>
                    <span className="block text-2xl font-bold">{t.label}</span>
                    <span className="block text-lg text-muted">{t.key === 'auto' && autoHint ? `${t.hint}; ${autoHint}` : t.hint}</span>
                  </span>
                </span>
              </Choice>
            ))}

          {step === 'voice' &&
            SPEECH_RATES.map((r) => (
              <Choice
                key={r.rate}
                on={a.speechRate === r.rate}
                onClick={() => {
                  setA11y({ speechRate: r.rate });
                  onSay('Dzień dobry. Tak będę do Pani mówić.', r.rate);
                }}
              >
                <span className="flex items-center gap-3 text-2xl font-bold">
                  <Volume2 size={28} className="shrink-0 text-brand" /> {r.label}
                </span>
              </Choice>
            ))}

          {step === 'hands' && (
            <YesNo
              yes={a.steadyTouch}
              onYes={() => setA11y({ steadyTouch: true })}
              onNo={() => setA11y({ steadyTouch: false })}
              yesNote="Włączę ochronę: podwójne dotknięcie policzę jako jedno."
            />
          )}

          {step === 'hearing' && (
            <YesNo
              yes={a.flashAlerts}
              onYes={() => setA11y({ flashAlerts: true })}
              onNo={() => setA11y({ flashAlerts: false })}
              yesNote="Przy każdym powiadomieniu ekran mrugnie, a telefon zawibruje."
            />
          )}

          {step === 'done' && (
            <div className="space-y-3 rounded-3xl bg-surface p-5 text-xl leading-snug shadow-soft">
              {changes.length ? (
                <ul className="space-y-2">
                  {changes.map((c) => (
                    <li key={c} className="flex items-start gap-2">
                      <Check size={24} className="mt-0.5 shrink-0 text-ok" /> {c}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Zostają ustawienia standardowe.</p>
              )}
              <p className="text-muted">Zmienić można zawsze: okrągły przycisk „Aa” na górze ekranu. Rodzina też może pomóc to ustawić.</p>
            </div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-[auto_1fr] gap-3">
          <button
            type="button"
            onClick={() => setI(Math.max(0, i - 1))}
            disabled={i === 0}
            aria-label="Wstecz"
            className="grid min-h-[4.5rem] min-w-[4.5rem] place-items-center rounded-2xl bg-surface ring-2 ring-line disabled:opacity-30"
          >
            <ArrowLeft size={30} />
          </button>
          <button type="button" onClick={next} className="flex min-h-[4.5rem] items-center justify-center gap-3 rounded-2xl bg-brand text-2xl font-bold text-on-accent">
            {step === 'done' ? (
              <>
                <Check size={30} /> Zaczynamy
              </>
            ) : (
              <>
                Dalej <ArrowRight size={30} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={(e) => {
        const el = e.currentTarget;
        onClick();
        // A bigger text size moves everything: keep her choice on screen.
        window.setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
      }}
      className={`flex w-full items-center justify-between gap-3 rounded-3xl p-4 text-left shadow-soft ring-4 transition ${on ? 'bg-brand-soft ring-brand' : 'bg-surface ring-transparent'}`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <span className={`grid size-10 shrink-0 place-items-center rounded-full ${on ? 'bg-brand text-on-accent' : 'ring-2 ring-line'}`} aria-hidden>
        {on && <Check size={26} strokeWidth={3} />}
      </span>
    </button>
  );
}

function YesNo({ yes, onYes, onNo, yesNote }: { yes: boolean; onYes: () => void; onNo: () => void; yesNote: string }) {
  return (
    <>
      <Choice on={yes} onClick={onYes}>
        <span className="block text-2xl font-bold">Tak</span>
        <span className="block text-lg text-muted">{yesNote}</span>
      </Choice>
      <Choice on={!yes} onClick={onNo}>
        <span className="block text-2xl font-bold">Nie</span>
      </Choice>
    </>
  );
}
