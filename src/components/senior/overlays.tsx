import {
  AlarmClock,
  Car,
  Check,
  CircleAlert,
  Clock,
  Headphones,
  HeartHandshake,
  HeartPulse,
  Mail,
  MessageCircle,
  Mic,
  Phone,
  Pill,
  RotateCcw,
  ShieldAlert,
  ShoppingCart,
  Siren,
  Smile,
  Stethoscope,
  Sun,
  Syringe,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Checkin, Contact, HealthCheck, FamilyMessage, Medicine, Mood, Order, Reminder, SafetyCheck, SeniorState, Sms } from '../../../shared/types';
import { fmtMoney, fmtTime, spokenMoney, spokenSender } from '../../lib/format';
import { fmtValue, METRIC, spokenValue } from '../../lib/health';
import { fmtSeconds, recordingSupported } from '../../lib/recorder';
import { IconBadge, TONE, type Tone } from '../ui';

// Full-screen cards that interrupt the senior: one at a time, the most important first.

export type Overlay =
  | { kind: 'emergency'; key: string; source: 'agent' | 'sos' }
  | { kind: 'fall'; key: string }
  | { kind: 'sosCountdown'; key: string }
  | { kind: 'call'; key: string; contact: Contact }
  | { kind: 'safety'; key: string; check: SafetyCheck }
  | { kind: 'health'; key: string; check: HealthCheck }
  | { kind: 'scam'; key: string; sms: Sms }
  | { kind: 'order'; key: string; order: Order }
  | { kind: 'refill'; key: string; medicine: Medicine; price: number; eta: string }
  | { kind: 'reminder'; key: string; reminder: Reminder }
  | { kind: 'message'; key: string; message: FamilyMessage; from: Contact }
  | { kind: 'checkin'; key: string; checkin: Checkin }
  | { kind: 'orderUpdate'; key: string; order: Order }
  | { kind: 'sms'; key: string; sms: Sms };

/** What the app does when a card appears: say something, or play a family member's voice. */
export type Announcement = { say: string } | { play: string };

export interface LocalCards {
  emergency: 'agent' | 'sos' | null;
  /** When the fall was detected (ms), or null. */
  fall: number | null;
  sosCountdown: boolean;
  call: Contact | null;
}

export function pickOverlay(state: SeniorState, local: LocalCards): Overlay | null {
  if (local.emergency) return { kind: 'emergency', key: `emergency:${local.emergency}`, source: local.emergency };
  if (local.fall) return { kind: 'fall', key: `fall:${local.fall}` };
  if (local.sosCountdown) return { kind: 'sosCountdown', key: 'sos' };
  if (local.call) return { kind: 'call', key: `call:${local.call.id}`, contact: local.call };
  if (state.safetyCheck) return { kind: 'safety', key: `safety:${state.safetyCheck.id}`, check: state.safetyCheck };
  if (state.healthCheck) return { kind: 'health', key: `health:${state.healthCheck.id}`, check: state.healthCheck };
  const scam = state.smsAlerts[0];
  if (scam) return { kind: 'scam', key: `scam:${scam.id}`, sms: scam };
  const order = state.ordersToConfirm[0];
  if (order) return { kind: 'order', key: `order:${order.id}`, order };
  const reminder = state.dueReminders[0];
  if (reminder) return { kind: 'reminder', key: `reminder:${reminder.id}:${reminder.dueAt}`, reminder };
  const message = state.incomingMessages[0];
  if (message) {
    const from = state.contacts.find((c) => c.id === message.contactId) ?? state.contacts[0];
    return { kind: 'message', key: `message:${message.id}`, message, from };
  }
  if (state.pendingCheckin) return { kind: 'checkin', key: `checkin:${state.pendingCheckin.id}`, checkin: state.pendingCheckin };
  const refill = state.refillSuggestions[0];
  if (refill) return { kind: 'refill', key: `refill:${refill.medicine.id}`, ...refill };
  const update = state.orderUpdates[0];
  if (update) return { kind: 'orderUpdate', key: `orderUpdate:${update.id}`, order: update };
  const sms = state.newSms[0];
  if (sms) return { kind: 'sms', key: `sms:${sms.id}`, sms };
  return null;
}

const decider = (state: SeniorState) => state.contacts[0];
const medLabel = (m: Medicine) => `${m.name}${m.strength ? ` ${m.strength}` : ''}`;

/** What happens when the card appears (null = the card is self-explanatory). */
export function overlayAnnouncement(o: Overlay, state: SeniorState): Announcement | null {
  const { addressAs } = state.profile;
  switch (o.kind) {
    case 'fall':
      return { say: `${addressAs}, czy Pani upadła? Jeśli nic się nie stało, proszę nacisnąć zielony przycisk. Jeśli nie będzie odpowiedzi, powiadomię rodzinę.` };
    case 'safety':
      return { say: `${addressAs}, czy wszystko w porządku? Proszę nacisnąć jeden z przycisków.` };
    case 'health': {
      const r = o.check.reading;
      return { say: `${addressAs}, ${healthTitle(o.check).toLowerCase()}: ${spokenValue(r.metric, r.value, r.value2)}. Proszę usiąść, odpocząć kilka minut i zmierzyć jeszcze raz. Jak się Pani czuje?` };
    }
    case 'scam':
      return { say: `Uwaga. Nowa wiadomość od ${spokenSender(o.sms.sender)} może być próbą oszustwa. ${o.sms.advice ?? 'Proszę nie klikać w link i nie odpisywać.'}` };
    case 'order': {
      const what = o.order.kind === 'taxi' ? `taksówkę na ${o.order.eta}` : o.order.kind === 'pharmacy' ? 'lek z apteki' : 'zakupy';
      const when = o.order.kind === 'taxi' ? '' : ` Dostawa ${o.order.eta}.`;
      const family = o.order.needsFamilyApproval ? ` To większa kwota, więc ${decider(state).name} dostanie jeszcze prośbę o zgodę.` : '';
      return { say: `Czy zamówić ${what} za ${spokenMoney(o.order.total)}?${when}${family}` };
    }
    case 'refill':
      return { say: `${addressAs}, kończy się lek ${medLabel(o.medicine)}. Zostało na ${o.medicine.daysLeft} dni. Czy zamówić nowe opakowanie w aptece za ${spokenMoney(o.price)}?` };
    case 'reminder':
      return {
        say:
          o.reminder.category === 'injection'
            ? `${addressAs}, czas na zastrzyk: ${o.reminder.title}. Proszę nacisnąć „Zrobione”, kiedy będzie po wszystkim.`
            : o.reminder.category === 'medication'
            ? `${addressAs}, czas na leki: ${o.reminder.title}. Proszę nacisnąć „Leki wzięte”, kiedy będzie po wszystkim.`
            : `${addressAs}, przypomnienie: ${o.reminder.title}.`,
      };
    case 'message':
      return o.message.audioUrl ? { play: o.message.audioUrl } : { say: `Wiadomość od ${o.from.name}: ${o.message.text}` };
    case 'checkin':
      return { say: `${o.checkin.briefing ? `${o.checkin.briefing} ` : ''}${addressAs}, jak się Pani dziś czuje?` };
    case 'orderUpdate':
      return { say: orderUpdateText(o.order, state) };
    case 'sms':
      return { say: `Nowy SMS od ${spokenSender(o.sms.sender)}. Czy mam go przeczytać?` };
    default:
      return null;
  }
}

function healthTitle(check: HealthCheck): string {
  const { metric, reading } = check;
  if (metric === 'blood_pressure') return reading.label === 'niskie' ? 'Ciśnienie jest niskie' : 'Ciśnienie jest wysokie';
  if (metric === 'heart_rate') return reading.label === 'bardzo wolny' ? 'Tętno jest wolne' : 'Tętno jest szybkie';
  return 'Saturacja jest niska';
}

function orderUpdateText(order: Order, state: SeniorState): string {
  const who = decider(state);
  const verb = who.gender === 'f' ? 'zatwierdziła' : 'zatwierdził';
  if (order.status === 'declined') return `${who.name} nie ${verb} zamówienia za ${spokenMoney(order.total)}. Najlepiej porozmawiać o tym przez telefon.`;
  return `${who.name} ${verb} zamówienie. ${order.kind === 'taxi' ? `Taksówka przyjedzie ${order.eta}.` : `Dostawa ${order.eta}.`}`;
}

export interface OverlayActions {
  confirmReminder: (r: Reminder) => void;
  snoozeReminder: (r: Reminder) => void;
  dismissScam: (sms: Sms) => void;
  checkScam: (sms: Sms) => void;
  callFamily: (contact: Contact, sms?: Sms) => void;
  replyToMessage: (m: FamilyMessage, from: Contact) => void;
  closeMessage: (m: FamilyMessage) => void;
  playMessage: (m: FamilyMessage) => void;
  repeat: (text: string) => void;
  confirmOrder: (o: Order) => void;
  declineOrder: (o: Order) => void;
  closeOrderUpdate: (o: Order) => void;
  answerCheckin: (c: Checkin, mood: Mood) => void;
  readSms: (sms: Sms) => void;
  closeSms: (sms: Sms) => void;
  closeCall: () => void;
  closeEmergency: () => void;
  answerSafety: (c: SafetyCheck, answer: 'ok' | 'help') => void;
  fallOk: () => void;
  fallHelp: () => void;
  fallNoAnswer: () => void;
  sosCancel: () => void;
  sosSend: () => void;
  refillYes: (m: Medicine) => void;
  refillLater: (m: Medicine) => void;
  answerHealth: (c: HealthCheck, answer: 'ok' | 'remeasure' | 'unwell') => void;
}

function Card({ tone, icon, title, children, urgent = false }: { tone: Tone; icon: LucideIcon; title: string; children: ReactNode; urgent?: boolean }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-3 backdrop-blur-[2px] sm:items-center" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className={`animate-rise max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-[2rem] p-6 shadow-lift ${TONE[tone].tint} ${urgent ? 'ring-4 ring-danger' : 'ring-1 ring-white/5'}`}>
        <div className="flex items-center gap-4">
          <IconBadge icon={icon} tone={tone} size={64} />
          <h2 className="text-3xl font-bold leading-tight">{title}</h2>
        </div>
        <div className="mt-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function BigButton({ onClick, children, variant = 'primary', href }: { onClick?: () => void; children: ReactNode; variant?: 'primary' | 'secondary' | 'danger' | 'ok'; href?: string }) {
  const styles = {
    primary: 'bg-brand text-on-accent hover:bg-brand-strong',
    secondary: 'bg-surface text-ink ring-2 ring-line hover:ring-brand',
    danger: 'bg-danger text-on-accent hover:brightness-110',
    ok: 'bg-ok text-on-accent hover:brightness-110',
  };
  const className = `flex min-h-[4.5rem] w-full items-center justify-center gap-3 rounded-2xl px-5 text-2xl font-bold shadow-sm transition active:scale-[0.99] ${styles[variant]}`;
  if (href) {
    return (
      <a className={className} href={href} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  );
}

/** Links in suspicious messages are shown as plain text with the scheme broken, so they cannot be tapped. */
function defang(text: string): string {
  return text.replace(/https?:\/\//gi, '').replace(/\./g, (m, i: number, s: string) => (/\w/.test(s[i - 1] ?? '') && /\w/.test(s[i + 1] ?? '') ? '[.]' : m));
}

function Countdown({ seconds, onDone, note }: { seconds: number; onDone: () => void; note: string }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) {
      onDone();
      return;
    }
    const t = window.setTimeout(() => setLeft((s) => s - 1), 1_000);
    return () => window.clearTimeout(t);
  }, [left]);
  const share = left / seconds;
  return (
    <div className="flex items-center gap-4">
      <span className="relative grid size-24 shrink-0 place-items-center text-danger" aria-live="polite" aria-label={`Zostało ${left} sekund`}>
        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
          <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="3" />
          <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${share * 100.5} 100.5`} />
        </svg>
        <span className="text-4xl font-bold tabular-nums text-ink">{left}</span>
      </span>
      <p className="text-xl leading-snug">{note}</p>
    </div>
  );
}

export function OverlayView({ overlay, state, actions }: { overlay: Overlay; state: SeniorState; actions: OverlayActions }) {
  const primary = state.contacts[0];
  switch (overlay.kind) {
    case 'emergency':
      return (
        <Card tone="danger" icon={Siren} title="Proszę zadzwonić pod 112" urgent>
          <p className="text-2xl leading-snug">{overlay.source === 'sos' ? 'Rodzina dostała alarm z Pani lokalizacją.' : 'Rodzina została powiadomiona.'} W nagłej sytuacji proszę od razu dzwonić po pomoc.</p>
          <BigButton variant="danger" href="tel:112">
            <Phone size={30} /> Zadzwoń 112
          </BigButton>
          <BigButton variant="secondary" href={`tel:${primary.phone.replace(/\s/g, '')}`}>
            <Phone size={26} /> Zadzwoń: {primary.name}
          </BigButton>
          <BigButton variant="secondary" onClick={actions.closeEmergency}>
            Zamknij
          </BigButton>
        </Card>
      );

    case 'fall':
      return (
        <Card tone="danger" icon={CircleAlert} title="Czy Pani upadła?" urgent>
          <Countdown seconds={30} onDone={actions.fallNoAnswer} note="Bez odpowiedzi powiadomię rodzinę i pokażę numer alarmowy." />
          <BigButton variant="ok" onClick={actions.fallOk}>
            <Check size={32} /> Nic mi nie jest
          </BigButton>
          <BigButton variant="danger" onClick={actions.fallHelp}>
            <Siren size={28} /> Potrzebuję pomocy
          </BigButton>
        </Card>
      );

    case 'sosCountdown':
      return (
        <Card tone="danger" icon={Siren} title="Wzywam pomoc" urgent>
          <Countdown seconds={5} onDone={actions.sosSend} note="Za chwilę rodzina dostanie alarm z Pani lokalizacją." />
          <BigButton variant="danger" onClick={actions.sosSend}>
            <Siren size={28} /> Wyślij teraz
          </BigButton>
          <BigButton variant="secondary" onClick={actions.sosCancel}>
            Anuluj
          </BigButton>
        </Card>
      );

    case 'call':
      return (
        <Card tone="ok" icon={Phone} title={`Połączenie: ${overlay.contact.name}`}>
          <p className="text-2xl leading-snug">
            {overlay.contact.name} ({overlay.contact.relation}) {overlay.contact.gender === 'f' ? 'dostała' : 'dostał'} informację, że chce Pani porozmawiać.
          </p>
          <BigButton variant="ok" href={`tel:${overlay.contact.phone.replace(/\s/g, '')}`}>
            <Phone size={30} /> Zadzwoń teraz
          </BigButton>
          <p className="text-center text-lg text-muted">{overlay.contact.phone}</p>
          <BigButton variant="secondary" onClick={actions.closeCall}>
            Nie teraz
          </BigButton>
        </Card>
      );

    case 'safety':
      return (
        <Card tone="sun" icon={HeartHandshake} title="Czy wszystko w porządku?">
          <p className="text-2xl leading-snug">{overlay.check.reason === 'inactivity' ? 'Dawno się nie słyszałyśmy — chcę się tylko upewnić.' : 'Chcę się tylko upewnić.'}</p>
          <BigButton variant="ok" onClick={() => actions.answerSafety(overlay.check, 'ok')}>
            <Check size={32} /> Tak, wszystko dobrze
          </BigButton>
          <BigButton variant="danger" onClick={() => actions.answerSafety(overlay.check, 'help')}>
            <Siren size={28} /> Potrzebuję pomocy
          </BigButton>
        </Card>
      );

    case 'health': {
      const r = overlay.check.reading;
      return (
        <Card tone="rose" icon={HeartPulse} title={healthTitle(overlay.check)}>
          <p className="rounded-2xl bg-surface p-4 text-center shadow-sm">
            <span className="num block text-7xl">{fmtValue(r.metric, r.value, r.value2)}</span>
            <span className="text-xl text-muted">
              {METRIC[r.metric].unit} · o {fmtTime(r.measuredAt, state.tz)}
            </span>
          </p>
          <p className="text-2xl leading-snug">Proszę usiąść, odpocząć kilka minut i zmierzyć jeszcze raz. Jak się Pani czuje?</p>
          <BigButton variant="ok" onClick={() => actions.answerHealth(overlay.check, 'ok')}>
            <Check size={32} /> Czuję się dobrze
          </BigButton>
          <BigButton variant="secondary" onClick={() => actions.answerHealth(overlay.check, 'remeasure')}>
            <AlarmClock size={26} /> Zmierzę za 5 minut
          </BigButton>
          <BigButton variant="danger" onClick={() => actions.answerHealth(overlay.check, 'unwell')}>
            <Siren size={28} /> Źle się czuję
          </BigButton>
        </Card>
      );
    }

    case 'scam':
      return (
        <Card tone="danger" icon={ShieldAlert} title="Uwaga! Ta wiadomość może być oszustwem" urgent>
          <div className="rounded-2xl bg-surface/85 p-4 text-lg">
            <p className="font-bold">SMS od: {overlay.sms.sender}</p>
            <p className="mt-1 break-words text-muted">„{defang(overlay.sms.text)}”</p>
          </div>
          <p className="text-2xl font-semibold leading-snug">{overlay.sms.advice ?? 'Proszę nie klikać w link i nie odpisywać.'}</p>
          <BigButton variant="danger" onClick={() => actions.dismissScam(overlay.sms)}>
            <Check size={30} /> Rozumiem, nie klikam
          </BigButton>
          <div className="grid grid-cols-2 gap-3">
            <BigButton variant="secondary" onClick={() => actions.checkScam(overlay.sms)}>
              <Mic size={26} /> Zapytaj
            </BigButton>
            <BigButton variant="secondary" onClick={() => actions.callFamily(primary, overlay.sms)}>
              <Phone size={26} /> {primary.name}
            </BigButton>
          </div>
        </Card>
      );

    case 'order': {
      const o = overlay.order;
      const items = o.lines.filter((l) => l.name !== 'Dostawa');
      const icon = o.kind === 'taxi' ? Car : o.kind === 'pharmacy' ? Pill : ShoppingCart;
      const title = o.kind === 'taxi' ? 'Zamówić taksówkę?' : o.kind === 'pharmacy' ? 'Zamówić lek z apteki?' : 'Zamówić zakupy?';
      return (
        <Card tone="teal" icon={icon} title={title}>
          <div className="rounded-2xl bg-surface p-4 shadow-sm">
            {o.kind === 'taxi' ? (
              <p className="text-xl leading-snug">
                {o.eta} → {o.destination}
              </p>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-y-auto text-xl">
                {items.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>{l.name}</span>
                    <span className="shrink-0 tabular-nums text-muted">{fmtMoney(l.price)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 flex justify-between border-t border-line pt-3 text-2xl font-bold">
              <span>Razem</span>
              <span>{fmtMoney(o.total)}</span>
            </p>
            <p className="mt-1 text-lg text-muted">
              {o.kind !== 'taxi' ? `Dostawa ${o.eta} · ` : ''}
              {o.partner}
            </p>
          </div>
          {o.needsFamilyApproval && <p className="rounded-2xl bg-warn-soft p-3 text-lg text-warn">To większa kwota — {state.contacts[0].name} dostanie jeszcze prośbę o zgodę.</p>}
          <BigButton variant="ok" onClick={() => actions.confirmOrder(o)}>
            <Check size={30} /> Tak, zamów
          </BigButton>
          <BigButton variant="secondary" onClick={() => actions.declineOrder(o)}>
            Nie, dziękuję
          </BigButton>
        </Card>
      );
    }

    case 'refill':
      return (
        <Card tone="teal" icon={Pill} title="Kończy się lek">
          <div className="rounded-2xl bg-surface p-4 shadow-sm">
            <p className="text-2xl font-bold">{medLabel(overlay.medicine)}</p>
            <p className="mt-1 text-xl text-muted">
              Zostało na {overlay.medicine.daysLeft} dni ({overlay.medicine.stock} szt.)
            </p>
            <p className="mt-3 flex justify-between gap-3 border-t border-line pt-3 text-xl">
              <span>Nowe opakowanie z apteki</span>
              <span className="shrink-0 font-bold">{fmtMoney(overlay.price)}</span>
            </p>
            <p className="text-lg text-muted">Dostawa {overlay.eta}</p>
          </div>
          <BigButton variant="ok" onClick={() => actions.refillYes(overlay.medicine)}>
            <Check size={30} /> Tak, zamów
          </BigButton>
          <BigButton variant="secondary" onClick={() => actions.refillLater(overlay.medicine)}>
            Przypomnij jutro
          </BigButton>
        </Card>
      );

    case 'reminder': {
      const r = overlay.reminder;
      const isMed = r.category === 'medication';
      const isShot = r.category === 'injection';
      return (
        <Card
          tone={isMed ? 'teal' : isShot ? 'rose' : 'sky'}
          icon={isMed ? Pill : isShot ? Syringe : r.category === 'appointment' ? Stethoscope : AlarmClock}
          title={isMed ? 'Czas na leki' : isShot ? 'Czas na zastrzyk' : 'Przypomnienie'}
        >
          <p className="text-3xl font-semibold leading-snug">{r.title}</p>
          <p className="flex items-center gap-2 text-xl text-muted">
            <Clock size={22} /> Zaplanowane na {fmtTime(r.plannedAt, state.tz)}
          </p>
          <BigButton variant="ok" onClick={() => actions.confirmReminder(r)}>
            <Check size={32} /> {isMed ? 'Leki wzięte' : 'Zrobione'}
          </BigButton>
          <BigButton variant="secondary" onClick={() => actions.snoozeReminder(r)}>
            <AlarmClock size={26} /> Przypomnij za 10 minut
          </BigButton>
        </Card>
      );
    }

    case 'message': {
      const m = overlay.message;
      return (
        <Card tone="lilac" icon={m.audioUrl ? Headphones : Mail} title={`${m.audioUrl ? 'Wiadomość głosowa' : 'Wiadomość'} od: ${overlay.from.name}`}>
          {m.audioUrl ? (
            <div className="rounded-2xl bg-surface p-4 shadow-sm">
              <p className="text-xl font-semibold">Nagranie {m.audioSeconds ? fmtSeconds(m.audioSeconds) : ''}</p>
              {m.text && <p className="mt-2 text-xl leading-snug text-muted">„{m.text}”</p>}
            </div>
          ) : (
            <p className="rounded-2xl bg-surface p-4 text-2xl leading-snug shadow-sm">{m.text}</p>
          )}
          <BigButton onClick={() => actions.replyToMessage(m, overlay.from)}>
            <Mic size={30} /> {recordingSupported ? 'Nagraj odpowiedź' : 'Odpowiedz głosem'}
          </BigButton>
          <div className="grid grid-cols-2 gap-3">
            <BigButton variant="secondary" onClick={() => (m.audioUrl ? actions.playMessage(m) : actions.repeat(`Wiadomość od ${overlay.from.name}: ${m.text}`))}>
              <RotateCcw size={26} /> {m.audioUrl ? 'Odtwórz' : 'Powtórz'}
            </BigButton>
            <BigButton variant="secondary" onClick={() => actions.closeMessage(m)}>
              OK
            </BigButton>
          </div>
        </Card>
      );
    }

    case 'checkin':
      return (
        <Card tone="sun" icon={Sun} title={overlay.checkin.briefing ? 'Dzień dobry!' : 'Jak się Pani dziś czuje?'}>
          {overlay.checkin.briefing && (
            <>
              <p className="rounded-2xl bg-surface p-4 text-xl leading-snug shadow-sm">{overlay.checkin.briefing}</p>
              <p className="text-2xl font-bold">Jak się Pani dziś czuje?</p>
            </>
          )}
          <div className="grid gap-3">
            <BigButton variant="ok" onClick={() => actions.answerCheckin(overlay.checkin, 'good')}>
              <Smile size={32} /> Dobrze
            </BigButton>
            <BigButton variant="secondary" onClick={() => actions.answerCheckin(overlay.checkin, 'ok')}>
              Tak sobie
            </BigButton>
            <BigButton variant="secondary" onClick={() => actions.answerCheckin(overlay.checkin, 'bad')}>
              Źle
            </BigButton>
          </div>
        </Card>
      );

    case 'orderUpdate': {
      const placed = overlay.order.status === 'placed';
      return (
        <Card tone={placed ? 'ok' : 'sand'} icon={placed ? Check : MessageCircle} title={placed ? 'Zamówienie zatwierdzone' : 'Zamówienie niezatwierdzone'}>
          <p className="text-2xl leading-snug">{orderUpdateText(overlay.order, state)}</p>
          <BigButton onClick={() => actions.closeOrderUpdate(overlay.order)}>OK</BigButton>
        </Card>
      );
    }

    case 'sms':
      return (
        <Card tone="sky" icon={Mail} title={`Nowy SMS od: ${overlay.sms.sender}`}>
          <p className="text-xl text-muted">Scam Shield: wiadomość wygląda na bezpieczną.</p>
          <BigButton onClick={() => actions.readSms(overlay.sms)}>Przeczytaj na głos</BigButton>
          <BigButton variant="secondary" onClick={() => actions.closeSms(overlay.sms)}>
            Później
          </BigButton>
        </Card>
      );
  }
}
