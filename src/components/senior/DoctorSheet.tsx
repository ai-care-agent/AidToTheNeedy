import { CalendarDays, Clock, MapPin, Phone, Stethoscope } from 'lucide-react';
import { useState } from 'react';
import type { CalendarEvent, CareTeam } from '../../../shared/types';
import { fmtWhen } from '../../lib/format';
import { IconBadge, Sheet } from '../ui';
import { VisitSheet } from './VisitSheet';

const tel = (phone: string) => `tel:${phone.replace(/[\s()-]/g, '')}`;
const mapLink = (address: string) => `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;

/** "Mój lekarz": who treats her and one big button to call each of them. */
export function DoctorSheet({
  team,
  visits,
  tz,
  onClose,
  onSay,
  onChange,
}: {
  team: CareTeam;
  visits: CalendarEvent[];
  tz: string;
  onClose: () => void;
  onSay: (text: string) => void;
  onChange: () => void;
}) {
  const { clinic, doctors } = team;
  const [visit, setVisit] = useState<CalendarEvent | null>(null);

  if (visit) return <VisitSheet event={visit} tz={tz} clinic={clinic} onClose={() => setVisit(null)} onSay={onSay} onChange={onChange} />;

  return (
    <Sheet title="Mój lekarz" onClose={onClose} wide>
      {visits.length > 0 && (
        <section className="rounded-3xl bg-surface p-4 shadow-soft">
          <p className="kicker text-lg text-muted">Moje wizyty</p>
          <ul className="mt-2 space-y-2">
            {visits.map((v) => (
              <li key={v.id}>
                <button type="button" onClick={() => setVisit(v)} className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-raised p-3 text-left">
                  <CalendarDays size={28} className="shrink-0 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xl font-bold leading-tight">{v.title}</span>
                    <span className="block text-lg text-muted">{fmtWhen(v.startsAt, new Date(), tz)}{v.location ? ` · ${v.location}` : ''}</span>
                  </span>
                  <span className="shrink-0 rounded-xl bg-surface px-3 py-2 text-lg font-semibold text-brand">Zmień</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!clinic && doctors.length === 0 && <p className="text-xl leading-snug text-muted">Nie ma jeszcze danych lekarza. Rodzina może je dodać w swojej aplikacji.</p>}

      {doctors.map((d) => (
        <section key={d.id} className="rounded-3xl bg-surface p-4 shadow-soft">
          <button type="button" onClick={() => onSay(`${d.name}, ${d.specialty}.${d.place ? ` ${d.place}.` : ''}`)} className="flex w-full items-start gap-4 text-left">
            <IconBadge icon={Stethoscope} tone="sky" size={56} />
            <span className="min-w-0">
              <span className="block text-2xl font-bold leading-tight">{d.name}</span>
              <span className="block text-xl text-muted first-letter:uppercase">{d.specialty}</span>
              {d.place && <span className="mt-1 block text-lg text-muted">{d.place}</span>}
            </span>
          </button>
          {d.phone && (
            <a href={tel(d.phone)} className="mt-3 flex min-h-16 items-center justify-center gap-3 rounded-2xl bg-ok px-4 text-xl font-bold text-on-accent">
              <Phone size={26} /> Zadzwoń
            </a>
          )}
        </section>
      ))}

      {clinic && (
        <section className="rounded-3xl bg-surface p-4 shadow-soft">
          <p className="kicker text-lg text-muted">Przychodnia</p>
          <p className="text-2xl font-bold leading-tight">{clinic.name}</p>
          {clinic.address && (
            <a href={mapLink(clinic.address)} target="_blank" rel="noreferrer" className="mt-2 flex min-h-12 items-center gap-2 text-xl font-semibold text-brand">
              <MapPin size={24} className="shrink-0" /> {clinic.address}
            </a>
          )}
          {clinic.hours && (
            <p className="mt-1 flex items-center gap-2 text-xl text-muted">
              <Clock size={24} className="shrink-0" /> {clinic.hours}
            </p>
          )}
          {clinic.phone && (
            <a href={tel(clinic.phone)} className="mt-3 flex min-h-16 items-center justify-center gap-3 rounded-2xl bg-ok px-4 text-xl font-bold text-on-accent">
              <Phone size={26} /> Zadzwoń do rejestracji
            </a>
          )}
        </section>
      )}

      <p className="text-lg leading-snug text-muted">W nagłej sytuacji — numer alarmowy 112. Gdy przychodnia jest zamknięta, gdzie szukać nocnej i świątecznej pomocy, powie Telefoniczna Informacja Pacjenta NFZ: 800 190 590.</p>
    </Sheet>
  );
}
