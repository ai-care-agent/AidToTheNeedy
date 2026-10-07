import { CalendarDays, Check, CupSoda, GlassWater, Minus, NotebookPen, Pencil, Pill, Plus, RotateCcw, ShoppingBasket, Stethoscope, Syringe, Trash2, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { CalendarEvent, Reminder, ReminderCategory, SeniorState, Task } from '../../../shared/types';
import { postJson } from '../../lib/api';
import { fmtTime } from '../../lib/format';
import { IconBadge, Sheet, type Tone } from '../ui';
import { TimeStepper } from './TimeStepper';
import { VisitSheet } from './VisitSheet';

// "Plan na dziś" she can work with: tick an item (and say when it happened), untick a tap by
// mistake, move it, rename it, remove it, add one — and count glasses of water.

const KIND: Record<ReminderCategory, { icon: LucideIcon; tone: Tone; label: string; done: string }> = {
  medication: { icon: Pill, tone: 'teal', label: 'Lek', done: 'wzięte' },
  injection: { icon: Syringe, tone: 'rose', label: 'Zastrzyk', done: 'zrobiony' },
  appointment: { icon: Stethoscope, tone: 'sky', label: 'Wizyta', done: 'zrobione' },
  other: { icon: NotebookPen, tone: 'sand', label: 'Inne', done: 'zrobione' },
};

/** What she can pick when adding; a visit goes through the calendar instead. */
const ADDABLE: ReminderCategory[] = ['medication', 'injection', 'other'];

const SUGGESTIONS: Record<ReminderCategory, string[]> = {
  medication: ['Tabletka przeciwbólowa', 'Witamina D', 'Krople do oczu'],
  injection: ['Insulina', 'Zastrzyk przeciwzakrzepowy'],
  appointment: [],
  other: ['Spacer', 'Gimnastyka', 'Zadzwonić do Ani', 'Zmierzyć ciśnienie'],
};

type Item = { kind: 'reminder'; r: Reminder } | { kind: 'task'; t: Task } | { kind: 'event'; e: CalendarEvent };

const hhmmNow = (tz: string) => fmtTime(new Date(), tz);

function nextFullHour(tz: string): string {
  const [h] = hhmmNow(tz).split(':').map(Number);
  return `${String(Math.min(23, h + 1)).padStart(2, '0')}:00`;
}

export function PlanCard({ state, onSay, onChange }: { state: SeniorState; onSay: (text: string) => void; onChange: () => void }) {
  const [open, setOpen] = useState<Reminder | null>(null);
  const [adding, setAdding] = useState(false);
  const [visit, setVisit] = useState<CalendarEvent | null>(null);
  const tz = state.tz;
  const { reminders, events, tasks } = state.today;

  const items: { at: string; item: Item }[] = [
    ...reminders.filter((r) => !r.eventId && r.status !== 'cancelled').map((r) => ({ at: fmtTime(r.plannedAt, tz), item: { kind: 'reminder', r } as Item })),
    ...events.map((e) => ({ at: fmtTime(e.startsAt, tz), item: { kind: 'event', e } as Item })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  // Open tasks, and those ticked today (so a tap by mistake can be undone).
  const openTasks = tasks;

  async function tick(r: Reminder) {
    await postJson(`/api/senior/reminders/${r.id}/done`);
    onSay(`Zapisane: ${r.title}, o ${hhmmNow(tz)}.`);
    onChange();
  }

  async function toggleTask(t: Task) {
    await postJson(`/api/senior/tasks/${t.id}/${t.status === 'done' ? 'undo' : 'done'}`);
    if (t.status !== 'done') onSay(`Zrobione: ${t.title}.`);
    onChange();
  }

  return (
    <section className="rounded-[2rem] bg-surface p-5 shadow-soft" data-guide="plan">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="kicker text-3xl">Plan na dziś</h2>
        <button type="button" onClick={() => setAdding(true)} className="flex min-h-14 items-center gap-2 rounded-2xl bg-brand px-4 text-xl font-bold text-on-accent">
          <Plus size={24} /> Dodaj
        </button>
      </div>

      <Water water={state.water} onSay={onSay} onChange={onChange} />

      <ul className="mt-4 space-y-2">
        {items.length === 0 && openTasks.length === 0 && <li className="text-xl text-muted">Nic zaplanowanego. Spokojnego dnia!</li>}
        {items.map(({ item }) => {
          if (item.kind === 'event') {
            return (
              <Row key={`e${item.e.id}`} icon={CalendarDays} tone="sky" time={fmtTime(item.e.startsAt, tz)} title={item.e.title} sub={item.e.location} onOpen={() => setVisit(item.e)} />
            );
          }
          if (item.kind !== 'reminder') return null;
          const r = item.r;
          const k = KIND[r.category];
          const done = r.status === 'done';
          return (
            <Row
              key={`r${r.id}`}
              icon={k.icon}
              tone={k.tone}
              time={fmtTime(r.plannedAt, tz)}
              title={r.title}
              done={done}
              now={r.status === 'due'}
              sub={done && r.doneAt ? `${k.done} o ${fmtTime(r.doneAt, tz)}` : r.repeat === 'daily' ? 'codziennie' : null}
              onCheck={() => (done ? setOpen(r) : void tick(r))}
              onOpen={() => setOpen(r)}
            />
          );
        })}
        {openTasks.map((t) => (
          <Row
            key={`t${t.id}`}
            icon={t.kind === 'shopping' ? ShoppingBasket : NotebookPen}
            tone="sand"
            time={null}
            title={t.items.length ? `${t.title}: ${t.items.join(', ')}` : t.title}
            done={t.status === 'done'}
            sub={t.status === 'done' && t.doneAt ? `zrobione o ${fmtTime(t.doneAt, tz)}` : null}
            onCheck={() => void toggleTask(t)}
          />
        ))}
      </ul>
      <p className="mt-3 text-lg text-muted">Kółko po lewej — zrobione. Dotknięcie nazwy — zmiana godziny, przeniesienie wizyty albo usunięcie.</p>

      {open && <ItemSheet r={open} tz={tz} onClose={() => setOpen(null)} onSay={onSay} onChange={onChange} />}
      {visit && <VisitSheet event={visit} tz={tz} clinic={state.careTeam.clinic} onClose={() => setVisit(null)} onSay={onSay} onChange={onChange} />}
      {adding && <AddSheet tz={tz} onClose={() => setAdding(false)} onSay={onSay} onChange={onChange} />}
    </section>
  );
}

function Row({
  icon,
  tone,
  time,
  title,
  sub,
  done = false,
  now = false,
  onCheck,
  onOpen,
}: {
  icon: LucideIcon;
  tone: Tone;
  time: string | null;
  title: string;
  sub?: string | null;
  done?: boolean;
  now?: boolean;
  onCheck?: () => void;
  onOpen?: () => void;
}) {
  return (
    <li className={`flex items-center gap-3 rounded-3xl p-2 ${now ? 'bg-warn-soft' : ''}`}>
      {onCheck ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          onClick={onCheck}
          aria-label={done ? `${title} — zrobione` : `Zaznacz jako zrobione: ${title}`}
          className={`grid size-16 shrink-0 place-items-center rounded-full ring-4 transition active:scale-95 ${done ? 'bg-ok text-on-accent ring-ok' : 'bg-paper ring-line'}`}
        >
          {done ? <Check size={34} strokeWidth={3} className="pop" /> : <IconBadge icon={icon} tone={tone} size={40} />}
        </button>
      ) : (
        <span className="grid size-16 shrink-0 place-items-center">
          <IconBadge icon={icon} tone={tone} size={44} />
        </span>
      )}
      <button type="button" onClick={onOpen} disabled={!onOpen} className="flex min-h-16 min-w-0 flex-1 items-center gap-2 rounded-2xl px-1 text-left disabled:cursor-default">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            {time && <span className="num text-2xl">{time}</span>}
            {now && <span className="rounded-xl bg-warn px-2 text-base font-bold text-on-accent">teraz</span>}
          </span>
          <span className={`block text-xl leading-snug ${done ? 'text-muted' : ''}`}>{title}</span>
          {sub && <span className={`block text-lg ${done ? 'font-semibold text-ok' : 'text-muted'}`}>{sub}</span>}
        </span>
        {onOpen && <Pencil size={22} className="shrink-0 text-muted" aria-hidden />}
      </button>
    </li>
  );
}

function Water({ water, onSay, onChange }: { water: SeniorState['water']; onSay: (text: string) => void; onChange: () => void }) {
  const glasses = Math.round(water.goalMl / water.glassMl);
  const drunk = Math.floor(water.ml / water.glassMl);
  const litres = (ml: number) => (ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1).replace('.', ',');

  async function add() {
    const w = await postJson<SeniorState['water']>('/api/senior/water', { ml: water.glassMl });
    onSay(w.ml >= w.goalMl && water.ml < w.goalMl ? 'Brawo! Cel wody na dziś osiągnięty.' : `Zapisane. Dziś ${litres(w.ml)} litra.`);
    onChange();
  }

  async function undo() {
    await postJson('/api/senior/water/undo');
    onChange();
  }

  return (
    <div className="mt-4 rounded-3xl bg-tint-sky p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xl font-bold">
          <GlassWater size={26} className="text-deep-sky" /> Woda
        </p>
        <p className="text-xl">
          <span className="num text-3xl">{litres(water.ml)}</span> <span className="text-muted">z {litres(water.goalMl)} l</span>
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" aria-hidden>
        {Array.from({ length: Math.max(glasses, drunk) }, (_, i) => (
          <CupSoda key={i} size={30} className={i < drunk ? 'text-deep-sky' : 'text-line'} fill={i < drunk ? 'currentColor' : 'none'} strokeWidth={1.75} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <button type="button" onClick={() => void add()} className="flex min-h-16 flex-wrap items-center justify-center gap-x-2 rounded-2xl bg-deep-sky px-2 text-xl font-bold text-on-accent active:scale-[0.98]">
          <Plus size={26} /> Szklanka wody
        </button>
        <button type="button" onClick={() => void undo()} disabled={water.ml === 0} aria-label="Cofnij ostatnią szklankę" className="grid size-16 place-items-center rounded-2xl bg-surface ring-2 ring-line disabled:opacity-40">
          <Minus size={26} />
        </button>
      </div>
    </div>
  );
}

function ItemSheet({ r, tz, onClose, onSay, onChange }: { r: Reminder; tz: string; onClose: () => void; onSay: (text: string) => void; onChange: () => void }) {
  const k = KIND[r.category];
  const done = r.status === 'done';
  const [stage, setStage] = useState<'main' | 'earlier' | 'move' | 'rename' | 'delete'>('main');
  const [time, setTime] = useState(fmtTime(r.plannedAt, tz));
  const [doneTime, setDoneTime] = useState(() => {
    const planned = fmtTime(r.plannedAt, tz);
    return planned < hhmmNow(tz) ? planned : hhmmNow(tz);
  });
  const [title, setTitle] = useState(r.title);
  const [category, setCategory] = useState(r.category);
  const [error, setError] = useState(false);

  async function act(url: string, body: unknown, said: string) {
    try {
      await postJson(url, body);
      onSay(said);
      onChange();
      onClose();
    } catch {
      setError(true);
    }
  }

  const doneAt = async (t: string) => {
    // Re-timing a ticked item: untick, then tick at the right time.
    if (done) await postJson(`/api/senior/reminders/${r.id}/undo`);
    await act(`/api/senior/reminders/${r.id}/done`, { time: t }, `Zapisane: ${r.title}, o ${t}.`);
  };

  return (
    <Sheet title={r.title} onClose={onClose}>
      <p className="flex items-center gap-2 text-xl text-muted">
        <k.icon size={24} /> {k.label} · w planie na {fmtTime(r.plannedAt, tz)}
        {r.repeat === 'daily' ? ' · codziennie' : ''}
      </p>
      {done && r.doneAt && (
        <p className="flex items-center gap-2 rounded-2xl bg-ok-soft px-4 py-3 text-2xl font-bold text-ok">
          <Check size={28} /> {k.done} o {fmtTime(r.doneAt, tz)}
        </p>
      )}

      {stage === 'main' && (
        <>
          {!done && (
            <Big tone="ok" onClick={() => void act(`/api/senior/reminders/${r.id}/done`, {}, `Zapisane: ${r.title}, o ${hhmmNow(tz)}.`)}>
              <Check size={30} /> Zrobione teraz
            </Big>
          )}
          <Big onClick={() => setStage('earlier')}>{done ? 'Zmień godzinę wykonania' : 'Zrobione wcześniej — o której?'}</Big>
          {done && (
            <Big onClick={() => void act(`/api/senior/reminders/${r.id}/undo`, {}, 'Dobrze, odznaczone. Przypomnę za dziesięć minut.')}>
              <RotateCcw size={26} /> Cofnij — jeszcze nie zrobione
            </Big>
          )}
          {!done && <Big onClick={() => setStage('move')}>Zmień godzinę w planie</Big>}
          <Big onClick={() => setStage('rename')}>Zmień nazwę lub rodzaj</Big>
          {!done && (
            <Big tone="danger" onClick={() => setStage('delete')}>
              <Trash2 size={26} /> Usuń z planu
            </Big>
          )}
        </>
      )}

      {stage === 'earlier' && (
        <>
          <TimeStepper label="O której było zrobione?" value={doneTime} max={hhmmNow(tz)} onChange={setDoneTime} />
          <Big tone="ok" onClick={() => void doneAt(doneTime)}>
            <Check size={30} /> Zapisz: {doneTime}
          </Big>
          <Big onClick={() => setStage('main')}>Wróć</Big>
        </>
      )}

      {stage === 'move' && (
        <>
          <TimeStepper label={r.repeat === 'daily' ? 'Nowa godzina (od dziś, codziennie)' : 'Nowa godzina'} value={time} onChange={setTime} />
          <Big tone="ok" onClick={() => void act(`/api/senior/reminders/${r.id}/edit`, { time }, `Dobrze. ${r.title} o ${time}.`)}>
            <Check size={30} /> Zapisz: {time}
          </Big>
          <Big onClick={() => setStage('main')}>Wróć</Big>
        </>
      )}

      {stage === 'rename' && (
        <>
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Nazwa" className="min-h-16 w-full rounded-2xl bg-surface px-4 text-2xl ring-2 ring-line focus:ring-brand" />
          <KindPicker value={category} onChange={setCategory} />
          <Big tone="ok" onClick={() => void act(`/api/senior/reminders/${r.id}/edit`, { title: title.trim() || r.title, category }, 'Zapisane.')}>
            <Check size={30} /> Zapisz
          </Big>
          <Big onClick={() => setStage('main')}>Wróć</Big>
        </>
      )}

      {stage === 'delete' && (
        <>
          <p className="text-2xl leading-snug">{r.repeat === 'daily' ? 'Usunąć tylko dziś, czy na stałe?' : 'Usunąć z planu?'}</p>
          {r.repeat === 'daily' && (
            <Big onClick={() => void act(`/api/senior/reminders/${r.id}/cancel`, { scope: 'today' }, 'Dobrze, dziś pomijam. Jutro przypomnę jak zwykle.')}>Tylko dziś</Big>
          )}
          <Big tone="danger" onClick={() => void act(`/api/senior/reminders/${r.id}/cancel`, { scope: 'all' }, 'Usunięte z planu.')}>
            <Trash2 size={26} /> {r.repeat === 'daily' ? 'Na stałe — codziennie' : 'Tak, usuń'}
          </Big>
          <Big onClick={() => setStage('main')}>Nie, zostaw</Big>
        </>
      )}

      {error && <p className="rounded-2xl bg-danger-soft px-4 py-2 text-lg text-danger">Nie udało się. Proszę spróbować jeszcze raz.</p>}
    </Sheet>
  );
}

function AddSheet({ tz, onClose, onSay, onChange }: { tz: string; onClose: () => void; onSay: (text: string) => void; onChange: () => void }) {
  const [category, setCategory] = useState<ReminderCategory>('medication');
  const [title, setTitle] = useState('');
  const [already, setAlready] = useState(false);
  const [time, setTime] = useState(nextFullHour(tz));
  const [daily, setDaily] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setMode(done: boolean) {
    setAlready(done);
    setTime(done ? hhmmNow(tz) : nextFullHour(tz));
    if (done) setDaily(false);
  }

  async function save() {
    if (!title.trim()) return setError('Proszę wpisać albo wybrać, co to jest.');
    try {
      await postJson('/api/senior/reminders', { title: title.trim(), category, time, repeat: daily ? 'daily' : 'none', done: already });
      onSay(already ? `Zapisane: ${title.trim()}, o ${time}.` : `Dodane do planu: ${title.trim()}, o ${time}${daily ? ', codziennie' : ''}. Przypomnę.`);
      onChange();
      onClose();
    } catch {
      setError(already ? 'Godzina nie może być w przyszłości.' : 'Ta godzina już minęła — proszę wybrać późniejszą albo „Już zrobione”.');
    }
  }

  return (
    <Sheet title="Dodaj do planu" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Kiedy">
        <Toggle on={!already} onClick={() => setMode(false)}>
          Przypomnij mi
        </Toggle>
        <Toggle on={already} onClick={() => setMode(true)}>
          Już zrobione
        </Toggle>
      </div>
      <KindPicker value={category} onChange={(c) => (setCategory(c), setTitle(''))} />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Co to jest?" aria-label="Co to jest?" className="min-h-16 w-full rounded-2xl bg-surface px-4 text-2xl ring-2 ring-line focus:ring-brand" />
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS[category].map((s) => (
          <button key={s} type="button" onClick={() => setTitle(s)} className={`min-h-12 rounded-2xl px-3 text-lg font-semibold ring-2 ${title === s ? 'bg-brand-soft ring-brand' : 'bg-surface ring-line'}`}>
            {s}
          </button>
        ))}
      </div>
      <TimeStepper label={already ? 'O której?' : 'Kiedy przypomnieć?'} value={time} max={already ? hhmmNow(tz) : undefined} onChange={setTime} />
      {!already && (
        <button type="button" role="switch" aria-checked={daily} onClick={() => setDaily(!daily)} className="flex min-h-16 w-full items-center justify-between rounded-2xl bg-surface px-4 text-xl font-semibold shadow-soft">
          Codziennie o tej porze
          <span className={`relative h-9 w-16 rounded-full transition ${daily ? 'bg-ok' : 'bg-line'}`}>
            <span className={`absolute top-1 size-7 rounded-full bg-white shadow ring-2 ring-black/40 transition-all ${daily ? 'left-8' : 'left-1'}`} />
          </span>
        </button>
      )}
      {error && <p className="rounded-2xl bg-danger-soft px-4 py-2 text-lg text-danger">{error}</p>}
      <Big tone="ok" onClick={() => void save()}>
        <Check size={30} /> {already ? 'Zapisz' : 'Dodaj do planu'}
      </Big>
    </Sheet>
  );
}

function KindPicker({ value, onChange }: { value: ReminderCategory; onChange: (c: ReminderCategory) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Rodzaj">
      {ADDABLE.map((c) => {
        const k = KIND[c];
        return (
          <Toggle key={c} on={value === c} onClick={() => onChange(c)}>
            <k.icon size={26} /> {k.label}
          </Toggle>
        );
      })}
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`flex min-h-16 flex-wrap items-center justify-center gap-2 rounded-2xl px-2 text-xl font-bold ring-2 transition ${on ? 'bg-ink text-on-accent ring-ink' : 'bg-surface ring-line'}`}
    >
      {children}
    </button>
  );
}

function Big({ onClick, children, tone }: { onClick: () => void; children: ReactNode; tone?: 'ok' | 'danger' }) {
  const look = tone === 'ok' ? 'bg-ok text-on-accent' : tone === 'danger' ? 'bg-danger-soft text-danger ring-2 ring-danger/40' : 'bg-surface ring-2 ring-line';
  return (
    <button type="button" onClick={onClick} className={`flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl px-4 text-xl font-bold ${look}`}>
      {children}
    </button>
  );
}
