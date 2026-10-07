import type { Mood, SmsPreset } from '../shared/types';
import type { Care } from './care';
import { config } from './env';
import { GROCERY_PARTNER, groceryQuote } from './partners';
import { addDays, addMinutes, startOfDay, withTime } from './time';

// Messages for the demo panel. Senders use the fictional UK range +44 7700 900xxx
// and the links point nowhere; the app never renders them as clickable.
export const smsPresets: SmsPreset[] = [
  {
    id: 'bank',
    label: '🏦 „Konto zostanie zablokowane”',
    sender: '+44 7700 900418',
    text: 'BANK: Wykryto nietypowe logowanie. Twoje konto zostanie zablokowane dzis o 18:00. Aby temu zapobiec, potwierdz dane: https://weryfikacja-konta-bank.info/login',
    expected: 'scam',
  },
  {
    id: 'parcel',
    label: '📦 Dopłata do paczki 1,99 zł',
    sender: '+44 7700 900726',
    text: 'Twoja paczka czeka w punkcie odbioru. Z powodu niepelnego adresu wymagana doplata 1,99 zl. Oplac w ciagu 24h: https://doplata-paczka24.top/p/88213',
    expected: 'scam',
  },
  {
    id: 'grandchild',
    label: '👦 „Babciu, to mój nowy numer”',
    sender: '+44 7700 900871',
    text: 'Babciu to ja Kuba, zbilem telefon i to moj nowy numer. Mam problem, pilnie potrzebuje 2000 zl, oddam w piatek. Napisz na WhatsApp, nie dzwon bo nie moge rozmawiac',
    expected: 'scam',
  },
  {
    id: 'energy',
    label: '⚡ „Odłączenie prądu dziś o 21:00”',
    sender: 'ENERGIA-INFO',
    text: 'Informujemy o zaleglosci 46,72 zl. Brak wplaty spowoduje odlaczenie energii dzis o 21:00. Szczegoly i platnosc: https://rozliczenie-energia.online/oplata',
    expected: 'scam',
  },
  {
    id: 'clinic',
    label: '✅ Przychodnia: przypomnienie o wizycie',
    sender: 'Przychodnia',
    text: 'Przychodnia Lipowa przypomina o wizycie u kardiologa dr. Nowaka jutro o 10:30. Prosimy zabrac wyniki badan. W razie rezygnacji prosimy o telefon do rejestracji.',
    expected: 'safe',
  },
  {
    id: 'pharmacy',
    label: '✅ Apteka: lek do odbioru',
    sender: 'Apteka',
    text: 'Apteka Zdrowie: zamowiony lek jest gotowy do odbioru. Zapraszamy dzis do 18:00, ul. Lipowa 3.',
    expected: 'safe',
  },
];

const MORNING_DOSE = 'Leki poranne: Amlodypina 5 mg';
const EVENING_DOSE = 'Leki wieczorne: Atorwastatyna 20 mg';

export const demoFamilyMessage = 'Mamo, przyjadę w sobotę z Zosią na obiad. Kupić coś po drodze?';

/** Same pseudo-random history on every reset (mulberry32). */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Two weeks of history with a story the weekly view should surface: evening doses missed
 * twice lately, two so-so days, a quiet yesterday, and one blocked scam.
 */
function seedHistory(care: Care, today: Date): void {
  const rand = random(7);
  const at = (dayOffset: number, time: string, plusMin = 0) => addMinutes(withTime(addDays(today, dayOffset), time)!, plusMin);
  const missedEvening = new Set([-3, -1]);
  const moods: Record<number, Mood> = { [-6]: 'ok', [-2]: 'ok', [-1]: 'ok' };

  for (let d = -13; d <= -1; d++) {
    care.importPastDose(MORNING_DOSE, at(d, '08:00'), at(d, '08:00', 2 + Math.floor(rand() * 14)));
    care.importPastDose(EVENING_DOSE, at(d, '20:00'), missedEvening.has(d) ? null : at(d, '20:00', 1 + Math.floor(rand() * 9)));
    care.importPastCheckin(at(d, config.checkinTime), at(d, config.checkinTime, 3 + Math.floor(rand() * 20)), moods[d] ?? 'good');
    const interactions = d === -1 ? 2 : 4 + Math.floor(rand() * 5);
    for (let i = 0; i < interactions; i++) care.logActivity('chat', at(d, '08:30', Math.floor(rand() * 11 * 60)));
    if (missedEvening.has(d)) {
      const alert = care.addFeed('medication_missed', 'warning', `Leki niepotwierdzone: ${EVENING_DOSE}`, 'Zaplanowane na 20:00 — brak potwierdzenia. Warto zadzwonić.', null, at(d, '20:30'));
      care.ackFeed(alert.id, at(d + 1, '07:40'));
    }
  }

  const scam = care.addFeed('scam_detected', 'warning', 'Wykryto próbę oszustwa (SMS)', 'SMS o „dopłacie do paczki” z linkiem do fałszywej płatności. Mama została ostrzeżona.', 'sms:history', at(-5, '16:42'));
  care.ackFeed(scam.id, at(-5, '18:10'));

  const quote = groceryQuote(['chleb', 'mleko', 'masło', 'jabłka', 'herbata'], at(-4, '10:15'));
  const order = care.createOrder({ kind: 'groceries', title: 'Zakupy z dostawą', ...quote, partner: GROCERY_PARTNER }, at(-4, '10:15'));
  care.confirmOrder(order.id, at(-4, '10:16'));
}

/**
 * Two weeks from the demo band and cuff, with the same story: blood pressure creeping above
 * 140/90 in the last days (the cardiologist is tomorrow), two short nights, and a quiet
 * yesterday with few steps.
 */
function seedHealth(care: Care, today: Date, now: Date): void {
  const rand = random(11);
  const at = (dayOffset: number, time: string, plusMin = 0) => addMinutes(withTime(addDays(today, dayOffset), time)!, plusMin);
  const band = 'Opaska demo';
  const cuff = 'Ciśnieniomierz demo';
  const shortNights = new Set([-1, 0]);
  const highPressure = new Set([-4, -3, -1, 0]);

  for (let d = -13; d <= 0; d++) {
    const quiet = d === -1;
    // Sleep, stamped at waking up: the night before day d.
    const wake = at(d, '06:40', Math.floor(rand() * 30));
    if (wake <= now) {
      const minutes = shortNights.has(d) ? 305 + Math.floor(rand() * 30) : 400 + Math.floor(rand() * 50);
      care.health.importReading('demo', { metric: 'sleep', value: minutes, measuredAt: wake, device: band });
      care.health.importReading('demo', { metric: 'spo2', value: 95 + Math.floor(rand() * 3), measuredAt: at(d, '03:30'), device: band });
      care.health.importReading('demo', { metric: 'heart_rate', value: 57 + Math.floor(rand() * 6), measuredAt: at(d, '03:00'), device: band });
    }
    // A thermometer in the morning every other day, always in range. Deterministic on purpose:
    // an extra rand() here would shift every value seeded after it.
    const tempAt = at(d, '07:15');
    if (d % 2 === 0 && tempAt <= now) {
      care.health.importReading('demo', { metric: 'temperature', value: 36.4 + (((d % 4) + 4) % 4) * 0.1, measuredAt: tempAt, device: 'Termometr demo' });
    }
    // Morning blood pressure with the cuff.
    const bpAt = at(d, '07:30', Math.floor(rand() * 20));
    if (bpAt <= now) {
      const high = highPressure.has(d);
      care.health.importReading('demo', {
        metric: 'blood_pressure',
        value: high ? 142 + Math.floor(rand() * 10) : 124 + Math.floor(rand() * 12),
        value2: high ? 88 + Math.floor(rand() * 6) : 78 + Math.floor(rand() * 8),
        measuredAt: bpAt,
        device: cuff,
      });
    }
    // Pulse every hour and steps per hour during the day; an afternoon walk on most days.
    const walkHour = quiet ? -1 : 15 + Math.floor(rand() * 2);
    for (let h = 8; h <= 21; h++) {
      const time = `${String(h).padStart(2, '0')}:00`;
      const hourEnd = at(d, time, 50);
      if (hourEnd > now) break;
      const walking = h === walkHour;
      care.health.importReading('demo', { metric: 'heart_rate', value: (walking ? 88 : 66) + Math.floor(rand() * 10), measuredAt: at(d, time, 20), device: band });
      if (h < 21) {
        const steps = quiet ? 40 + Math.floor(rand() * 110) : walking ? 1800 + Math.floor(rand() * 900) : 150 + Math.floor(rand() * 260);
        care.health.importReading('demo', { metric: 'steps', value: steps, measuredAt: hourEnd, device: band });
      }
    }
  }
  care.health.markSource('demo', { status: 'connected', detail: `${band} · ${cuff}`, lastSyncAt: now });
}

/** Rebuilds a believable day for the demo household relative to "now". */
export function seedDemo(care: Care, now = new Date()): void {
  care.reset();
  const today = startOfDay(now);
  const at = (dayOffset: number, time: string) => withTime(addDays(today, dayOffset), time)!;
  seedHistory(care, today);
  seedHealth(care, today, now);

  for (const fact of [
    'Córka Anna mieszka w Warszawie i pracuje na pełen etat; zwykle dzwoni wieczorem.',
    'Syn Tomek mieszka w Krakowie.',
    'Wnuczka Zosia (córka Anny) ma 8 lat. Innych wnucząt nie ma.',
    'Lekarz rodzinny: dr Wiśniewska, Przychodnia Lipowa, ul. Lipowa 12.',
    'Kardiolog: dr Nowak.',
    'Lubi rano słuchać radia i rozwiązywać krzyżówki.',
    'Ma kota o imieniu Mruczek.',
  ]) {
    care.remember(fact, addDays(now, -7));
  }

  care.setCareTeam(
    {
      clinic: { name: 'Przychodnia Lipowa', address: 'ul. Lipowa 12, Lublin', phone: '+48 000 000 100', hours: 'pn–pt 8:00–18:00' },
      doctors: [
        { id: 'poz', name: 'dr Ewa Wiśniewska', specialty: 'lekarz rodzinny', phone: '+48 000 000 101', place: null },
        { id: 'kardio', name: 'dr Piotr Nowak', specialty: 'kardiolog', phone: '+48 000 000 102', place: 'Przychodnia Lipowa, gabinet 14' },
      ],
    },
    addDays(now, -7),
  );

  // Daily medication set up by the daughter.
  // The daughter set up the apteczka: two daily medicines, each with its own reminder.
  const bloodPressure = care.importMedicine(
    { name: 'Amlodypina', strength: '5 mg', form: 'tabletki', instructions: '1 tabletka rano', times: ['08:00'], stock: 24, packSize: 30, createdBy: 'family' },
    addDays(now, -20),
  );
  const cholesterol = care.importMedicine(
    { name: 'Atorwastatyna', strength: '20 mg', form: 'tabletki', instructions: '1 tabletka wieczorem', times: ['20:00'], stock: 9, packSize: 30, createdBy: 'family' },
    addDays(now, -20),
  );
  const morning = care.createReminder({ title: MORNING_DOSE, category: 'medication', at: at(0, '08:00'), repeat: 'daily', createdBy: 'family', medicineId: bloodPressure, announce: false }, addDays(now, -3));
  if (now > at(0, '08:05')) {
    care.fireReminder(morning.id, at(0, '08:00'));
    care.completeReminder(morning.id, 'senior', at(0, '08:04'));
  }
  const evening = care.createReminder({ title: EVENING_DOSE, category: 'medication', at: at(0, '20:00'), repeat: 'daily', createdBy: 'family', medicineId: cholesterol, announce: false }, addDays(now, -3));
  if (now > at(0, '20:10')) {
    care.fireReminder(evening.id, at(0, '20:00'));
    care.completeReminder(evening.id, 'senior', at(0, '20:03'));
  }

  const call = care.createReminder({ title: 'Zadzwonić do sąsiadki, pani Basi', category: 'other', at: at(0, '11:00'), createdBy: 'senior', announce: false }, addDays(now, -1));
  if (now > at(0, '11:10')) {
    care.fireReminder(call.id, at(0, '11:00'));
    care.completeReminder(call.id, 'senior', at(0, '11:06'));
  }

  care.createEvent(
    { title: 'Wizyta u kardiologa (dr Nowak)', startsAt: at(1, '10:30'), location: 'Przychodnia Lipowa, ul. Lipowa 12', notes: 'Zabrać wyniki badań.', createdBy: 'family', remindBeforeMin: 60, announce: false },
    addDays(now, -2),
  );
  care.createEvent(
    { title: 'Odwiedziny Anny i Zosi — obiad', startsAt: at(5, '13:00'), createdBy: 'family', announce: false },
    addDays(now, -2),
  );

  care.createTask({ title: 'Zakupy', kind: 'shopping', items: ['chleb', 'mleko', 'jabłka', 'herbata'], dueDate: null, createdBy: 'senior', announce: false }, addDays(now, -1));

  const clinic = care.addSms('Przychodnia', 'Przychodnia Lipowa: wyniki badan krwi sa do odbioru w rejestracji od poniedzialku do piatku w godz. 8-18.', addDays(now, -1));
  care.setSmsAssessment(clinic.id, { verdict: 'safe', category: null, reasons: ['Informacja bez linków i bez prośby o płatność.'], advice: 'To zwykła informacja z przychodni.', summaryForFamily: '', analyzedBy: 'heuristic' });
  care.markSmsRead([clinic.id], addDays(now, -1));

  // Family feed history for the day (timestamps in the past, so it reads like a real morning).
  const checkinAt = withTime(now, config.checkinTime)!;
  if (now > addMinutes(checkinAt, 12)) {
    const checkin = care.createCheckin(checkinAt);
    care.answerCheckin(checkin.id, 'good', null, addMinutes(checkinAt, 12));
  }
  care.addFeed('family_action', 'info', 'Anna dodała wizytę do kalendarza', 'Wizyta u kardiologa (dr Nowak) — jutro o 10:30', null, addDays(now, -2));

  care.touchActivity(addMinutes(now, -25));
}
