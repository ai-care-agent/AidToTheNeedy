import { AudioLines, CalendarDays, CircleCheck, FileText, HeartPulse, LoaderCircle, Mail, Mic, Phone, Pill, Search, ShieldCheck, Siren, Stethoscope, Type, Video, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { GUIDE_TARGETS, guideTarget, type GuideTarget } from '../../../shared/guide';
import { postJson } from '../../lib/api';
import { onServerEvent } from '../../lib/serverEvents';

const ICON: Record<GuideTarget, LucideIcon> = {
  mic: Mic,
  call: Phone,
  video: Video,
  medicines: Pill,
  health: HeartPulse,
  document: FileText,
  messages: Mail,
  doctor: Stethoscope,
  magnifier: Search,
  guard: ShieldCheck,
  record: AudioLines,
  sos: Siren,
  a11y: Type,
  plan: CalendarDays,
};

/** If she hasn't tapped by then, the light on her screen has gone out. */
const WAIT_MS = 30_000;

type Status = { target: GuideTarget; state: 'showing' | 'done' | 'expired' } | null;

/**
 * "Pokaż palcem": instead of "the green one, no, the other green one" over the phone, the
 * daughter taps the button here and it lights up on Mom's screen under a pointing hand.
 */
export function GuideCard({ senior, seniorGenitive, female }: { senior: string; seniorGenitive: string; female: boolean }) {
  const pressed = female ? 'nacisnęła' : 'nacisnął';
  const [status, setStatus] = useState<Status>(null);

  useEffect(
    () =>
      onServerEvent('guide_done', (data) => {
        const { target } = data as { target: GuideTarget };
        setStatus((s) => (s?.target === target ? { target, state: 'done' } : s));
      }),
    [],
  );

  useEffect(() => {
    if (status?.state !== 'showing') return;
    const t = window.setTimeout(() => setStatus((s) => (s?.state === 'showing' ? { ...s, state: 'expired' } : s)), WAIT_MS);
    return () => window.clearTimeout(t);
  }, [status]);

  async function point(target: GuideTarget) {
    setStatus({ target, state: 'showing' });
    await postJson('/api/family/guide', { target }).catch(() => setStatus(null));
  }

  return (
    <div>
      <p className="leading-snug text-muted">{senior} nie może czegoś znaleźć? Dotknij przycisku — zaświeci się na {female ? 'jej' : 'jego'} ekranie, a asystentka powie, gdzie nacisnąć.</p>

      <div className="@container mt-4">
        <div className="grid gap-2 @min-[19rem]:grid-cols-2 @min-[32rem]:grid-cols-3">
          {GUIDE_TARGETS.map((t) => {
            const Icon = ICON[t.key];
            const active = status?.target === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => void point(t.key)}
                className={`flex min-h-14 items-center gap-2 rounded-2xl px-3 py-2 text-left font-semibold leading-tight ring-1 transition ${
                  active && status?.state === 'done' ? 'bg-ok-soft text-ok ring-ok' : active ? 'bg-brand-soft ring-2 ring-brand' : t.key === 'sos' ? 'bg-danger-soft ring-danger/40 hover:ring-danger' : 'bg-raised ring-line hover:ring-brand'
                }`}
              >
                <Icon size={20} className="shrink-0" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-3 flex min-h-8 items-center gap-2 font-semibold" aria-live="polite">
        {status?.state === 'showing' && (
          <>
            <LoaderCircle size={20} className="animate-spin text-brand" /> Świeci u {seniorGenitive}: {guideTarget(status.target).label} — czekam, aż naciśnie…
          </>
        )}
        {status?.state === 'done' && (
          <span className="pop inline-flex items-center gap-2 text-ok">
            <CircleCheck size={22} /> {senior} {pressed}: {guideTarget(status.target).label}
          </span>
        )}
        {status?.state === 'expired' && <span className="text-muted">Jeszcze nie {pressed} — może zadzwonić i powiedzieć, co świeci?</span>}
      </p>
    </div>
  );
}
