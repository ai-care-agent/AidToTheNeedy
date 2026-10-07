import { CalendarDays, Check, ChevronLeft, ChevronRight, MapPin, Phone, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { CalendarEvent, Clinic } from '../../../shared/types';
import { postJson } from '../../lib/api';
import { dayKey, fmtLongDate, fmtTime } from '../../lib/format';
import { Sheet } from '../ui';
import { TimeStepper } from './TimeStepper';

/** How far ahead a visit can be moved from here; further than that is a new visit. */
const MAX_DAYS = 60;

const tel = (phone: string) => `tel:${phone.replace(/[\s()-]/g, '')}`;

/** YYYY-MM-DD plus n days, as calendar dates (no time zone games). */
function addDaysKey(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayName(key: string, today: string): string {
  const diff = Math.round((Date.parse(`${key}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  const long = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));
  return diff === 0 ? `dziś, ${long}` : diff === 1 ? `jutro, ${long}` : diff === 2 ? `pojutrze, ${long}` : long;
}

/** A visit she can move or cancel — always with the clinic's number at hand, since the clinic has to agree. */
export function VisitSheet({ event, tz, clinic, onClose, onSay, onChange }: { event: CalendarEvent; tz: string; clinic: Clinic | null; onClose: () => void; onSay: (text: string) => void; onChange: () => void }) {
  const today = dayKey(new Date(), tz);
  const [stage, setStage] = useState<'main' | 'move' | 'cancel'>('main');
  const [date, setDate] = useState(dayKey(event.startsAt, tz));
  const [time, setTime] = useState(fmtTime(event.startsAt, tz));
  const [error, setError] = useState<string | null>(null);

  async function move() {
    try {
      await postJson(`/api/senior/events/${event.id}/move`, { date, time });
      onSay(`Przełożone: ${event.title}, ${dayName(date, today)}, o ${time}. Proszę pamiętać, żeby potwierdzić nowy termin w przychodni.`);
      onChange();
      onClose();
    } catch {
      setError('Ten termin już minął — proszę wybrać późniejszy.');
    }
  }

  async function cancel() {
    await postJson(`/api/senior/events/${event.id}/cancel`);
    onSay(`Odwołane: ${event.title}. Proszę dać znać przychodni.`);
    onChange();
    onClose();
  }

  const callClinic = clinic?.phone && (
    <a href={tel(clinic.phone)} className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-surface px-4 text-xl font-bold ring-2 ring-ok">
      <Phone size={26} className="text-ok" /> Zadzwoń do przychodni
    </a>
  );

  return (
    <Sheet title={event.title} onClose={onClose}>
      <p className="flex items-center gap-2 text-2xl font-semibold">
        <CalendarDays size={28} className="shrink-0 text-brand" />
        <span className="first-letter:uppercase">
          {fmtLongDate(event.startsAt, tz)}, {fmtTime(event.startsAt, tz)}
        </span>
      </p>
      {event.location && (
        <p className="flex items-center gap-2 text-xl text-muted">
          <MapPin size={24} className="shrink-0" /> {event.location}
        </p>
      )}

      {stage === 'main' && (
        <>
          <Big tone="ok" onClick={() => setStage('move')}>
            <CalendarDays size={28} /> Przenieś na inny dzień lub godzinę
          </Big>
          <Big tone="danger" onClick={() => setStage('cancel')}>
            <X size={28} /> Odwołaj wizytę
          </Big>
          {callClinic}
        </>
      )}

      {stage === 'move' && (
        <>
          <div className="rounded-3xl bg-surface p-3 shadow-soft" role="group" aria-label="Dzień">
            <p className="text-lg font-semibold text-muted">Dzień</p>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={() => setDate(addDaysKey(date, -1))} disabled={date <= today} aria-label="Dzień wcześniej" className="grid size-16 shrink-0 place-items-center rounded-2xl bg-paper ring-2 ring-line disabled:opacity-30">
                <ChevronLeft size={32} />
              </button>
              <p className="min-w-0 flex-1 text-center text-2xl font-bold leading-tight first-letter:uppercase" aria-live="polite">
                {dayName(date, today)}
              </p>
              <button type="button" onClick={() => setDate(addDaysKey(date, 1))} disabled={date >= addDaysKey(today, MAX_DAYS)} aria-label="Dzień później" className="grid size-16 shrink-0 place-items-center rounded-2xl bg-paper ring-2 ring-line disabled:opacity-30">
                <ChevronRight size={32} />
              </button>
            </div>
          </div>
          <TimeStepper label="Godzina" value={time} onChange={setTime} />
          <p className="rounded-2xl bg-warn-soft px-4 py-3 text-lg leading-snug text-warn">Aplikacja nie zmienia terminu w przychodni. Nowy termin trzeba uzgodnić z rejestracją — najlepiej przed zapisaniem.</p>
          {callClinic}
          {error && <p className="rounded-2xl bg-danger-soft px-4 py-2 text-lg text-danger">{error}</p>}
          <Big tone="ok" onClick={() => void move()}>
            <Check size={30} /> Zapisz: {time}
          </Big>
          <Big onClick={() => setStage('main')}>Wróć</Big>
        </>
      )}

      {stage === 'cancel' && (
        <>
          <p className="text-2xl leading-snug">Odwołać tę wizytę? Przypomnienie o niej też zniknie.</p>
          <Big tone="danger" onClick={() => void cancel()}>
            <X size={28} /> Tak, odwołaj
          </Big>
          <Big onClick={() => setStage('main')}>Nie, zostaw</Big>
          {callClinic}
        </>
      )}
    </Sheet>
  );
}

function Big({ onClick, children, tone }: { onClick: () => void; children: ReactNode; tone?: 'ok' | 'danger' }) {
  const look = tone === 'ok' ? 'bg-ok text-on-accent' : tone === 'danger' ? 'bg-danger-soft text-danger ring-2 ring-danger/40' : 'bg-surface ring-2 ring-line';
  return (
    <button type="button" onClick={onClick} className={`flex min-h-16 w-full flex-wrap items-center justify-center gap-x-3 rounded-2xl px-4 text-xl font-bold ${look}`}>
      {children}
    </button>
  );
}
