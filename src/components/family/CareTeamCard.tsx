import { Clock, MapPin, Pencil, Phone, Plus, Trash2, X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { CareTeam, Clinic, Doctor } from '../../../shared/types';
import { postJson } from '../../lib/api';

const tel = (phone: string) => `tel:${phone.replace(/[\s()-]/g, '')}`;
const input = 'min-h-12 w-full rounded-2xl bg-paper px-3 ring-1 ring-line focus:ring-2 focus:ring-brand';
const EMPTY_CLINIC: Clinic = { name: '', address: null, phone: null, hours: null };

/** "Lekarz i przychodnia": the family keeps it current; Mom sees it under "Mój lekarz". */
export function CareTeamCard({ team, senior, onChange }: { team: CareTeam; senior: string; onChange: () => void }) {
  const [editing, setEditing] = useState(false);

  if (editing) return <CareTeamForm team={team} onDone={() => (setEditing(false), onChange())} onCancel={() => setEditing(false)} />;

  return (
    <div className="space-y-3">
      {team.doctors.map((d) => (
        <div key={d.id} className="flex items-center gap-3 rounded-2xl bg-raised p-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-snug">{d.name}</p>
            <p className="text-sm text-muted first-letter:uppercase">
              {d.specialty}
              {d.place ? ` · ${d.place}` : ''}
            </p>
          </div>
          {d.phone && <CallLink phone={d.phone} />}
        </div>
      ))}
      {team.clinic && (
        <div className="flex items-start gap-3 rounded-2xl bg-raised p-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="font-semibold leading-snug">{team.clinic.name}</p>
            {team.clinic.address && (
              <p className="flex items-center gap-1.5 text-sm text-muted">
                <MapPin size={14} className="shrink-0" /> {team.clinic.address}
              </p>
            )}
            {team.clinic.hours && (
              <p className="flex items-center gap-1.5 text-sm text-muted">
                <Clock size={14} className="shrink-0" /> {team.clinic.hours}
              </p>
            )}
          </div>
          {team.clinic.phone && <CallLink phone={team.clinic.phone} />}
        </div>
      )}
      {!team.clinic && !team.doctors.length && <p className="text-muted">Dodaj lekarza i przychodnię — {senior} zobaczy je z dużym przyciskiem „Zadzwoń”, a asystentka będzie wiedziała, gdzie dzwonić.</p>}
      <button type="button" onClick={() => setEditing(true)} className="flex min-h-11 items-center gap-1.5 rounded-2xl px-4 font-semibold ring-1 ring-line hover:ring-brand">
        <Pencil size={16} /> {team.clinic || team.doctors.length ? 'Edytuj' : 'Dodaj'}
      </button>
    </div>
  );
}

function CallLink({ phone }: { phone: string }) {
  return (
    <a href={tel(phone)} className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-ok px-3 text-sm font-semibold text-on-accent" aria-label={`Zadzwoń: ${phone}`}>
      <Phone size={16} /> {phone}
    </a>
  );
}

function CareTeamForm({ team, onDone, onCancel }: { team: CareTeam; onDone: () => void; onCancel: () => void }) {
  const [clinic, setClinic] = useState<Clinic>(team.clinic ?? EMPTY_CLINIC);
  const [doctors, setDoctors] = useState<Doctor[]>(team.doctors.length ? team.doctors : [{ id: 'd1', name: '', specialty: 'lekarz rodzinny', phone: null, place: null }]);
  const [error, setError] = useState(false);

  const setDoctor = (i: number, patch: Partial<Doctor>) => setDoctors(doctors.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await postJson('/api/family/care-team', {
        clinic: clinic.name.trim() ? clinic : null,
        doctors: doctors.filter((d) => d.name.trim()),
      });
      onDone();
    } catch {
      setError(true);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {doctors.map((d, i) => (
        <fieldset key={d.id} className="space-y-2 rounded-2xl bg-raised p-3">
          <div className="flex items-center justify-between">
            <legend className="font-semibold text-muted">Lekarz {i + 1}</legend>
            <button type="button" onClick={() => setDoctors(doctors.filter((_, j) => j !== i))} className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface" aria-label={`Usuń lekarza ${i + 1}`}>
              <Trash2 size={18} />
            </button>
          </div>
          <Field label="Imię i nazwisko">
            <input required value={d.name} onChange={(e) => setDoctor(i, { name: e.target.value })} placeholder="dr Ewa Wiśniewska" className={input} />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Specjalizacja">
              <input required value={d.specialty} onChange={(e) => setDoctor(i, { specialty: e.target.value })} placeholder="lekarz rodzinny" className={input} />
            </Field>
            <Field label="Telefon">
              <input type="tel" value={d.phone ?? ''} onChange={(e) => setDoctor(i, { phone: e.target.value || null })} placeholder="+48 …" className={input} />
            </Field>
          </div>
          <Field label="Gdzie przyjmuje (opcjonalnie)">
            <input value={d.place ?? ''} onChange={(e) => setDoctor(i, { place: e.target.value || null })} placeholder="np. gabinet 14" className={input} />
          </Field>
        </fieldset>
      ))}
      {doctors.length < 8 && (
        <button type="button" onClick={() => setDoctors([...doctors, { id: `d${Date.now()}`, name: '', specialty: '', phone: null, place: null }])} className="flex min-h-11 items-center gap-1.5 rounded-2xl px-4 font-semibold text-brand ring-1 ring-line">
          <Plus size={18} /> Lekarz
        </button>
      )}

      <fieldset className="space-y-2 rounded-2xl bg-raised p-3">
        <legend className="font-semibold text-muted">Przychodnia</legend>
        <Field label="Nazwa">
          <input value={clinic.name} onChange={(e) => setClinic({ ...clinic, name: e.target.value })} placeholder="Przychodnia Lipowa" className={input} />
        </Field>
        <Field label="Adres">
          <input value={clinic.address ?? ''} onChange={(e) => setClinic({ ...clinic, address: e.target.value || null })} placeholder="ul. Lipowa 12, Lublin" className={input} />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Telefon do rejestracji">
            <input type="tel" value={clinic.phone ?? ''} onChange={(e) => setClinic({ ...clinic, phone: e.target.value || null })} placeholder="+48 …" className={input} />
          </Field>
          <Field label="Godziny">
            <input value={clinic.hours ?? ''} onChange={(e) => setClinic({ ...clinic, hours: e.target.value || null })} placeholder="pn–pt 8:00–18:00" className={input} />
          </Field>
        </div>
      </fieldset>

      {error && <p className="rounded-2xl bg-danger-soft px-3 py-2 text-danger">Nie udało się zapisać. Sprawdź numery telefonów (tylko cyfry, spacje, +).</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="submit" className="min-h-12 rounded-2xl bg-brand font-semibold text-on-accent">
          Zapisz
        </button>
        <button type="button" onClick={onCancel} className="flex min-h-12 items-center justify-center gap-1.5 rounded-2xl font-semibold ring-1 ring-line">
          <X size={18} /> Anuluj
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-muted">
      {label}
      <div className="mt-1 text-base font-normal text-ink">{children}</div>
    </label>
  );
}
