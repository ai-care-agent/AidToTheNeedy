import { CircleCheck, OctagonAlert, Phone, Play, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { maxLevel, verdictFromRules } from '../../../shared/callGuardRules';
import type { CallGuardVerdict, Contact, SeniorProfile } from '../../../shared/types';
import { postJson } from '../../lib/api';
import { chime } from '../../lib/media';
import { listenContinuous, speakAsync, stopSpeaking, type ContinuousSession } from '../../lib/speech';

// "Strażnik rozmowy": the phone is on speaker, the app listens and warns out loud.
// Rules react on every phrase. The model gets the whole call when the rules escalate, every
// 8 s while something is suspicious, and every 30 s otherwise (a call is long; tokens add up).

const SAFE: CallGuardVerdict = { level: 'safe', reason: null, warning: null, source: 'rules' };

/** A classic "na policjanta" script, read in a lower voice, for demos without a second phone. */
const DEMO_CALL = [
  'Dzień dobry, nazywam się komisarz Marek Wójcik, dzwonię z komendy policji.',
  'Pani wnuczka spowodowała wypadek samochodowy i została zatrzymana.',
  'Żeby uniknęła aresztu, potrzebna jest kaucja, dwadzieścia tysięcy złotych.',
  'Proszę nikomu o tym nie mówić, to tajna akcja policji.',
  'Nasz kurier przyjedzie do Pani po pieniądze w ciągu godziny.',
];

const BACKGROUND = { safe: 'bg-[#0f3d33]', suspicious: 'bg-[#6b4100]', scam: 'bg-[#7f1d1d]' } as const;

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function CallGuard({ profile, contact, onClose, onCall }: { profile: SeniorProfile; contact: Contact; onClose: () => void; onCall: (c: Contact) => void }) {
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const [verdict, setVerdict] = useState<CallGuardVerdict>(SAFE);
  const [lines, setLines] = useState<string[]>([]);
  const [interim, setInterim] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const transcript = useRef('');
  const current = useRef<CallGuardVerdict>(SAFE);
  const session = useRef<ContinuousSession | null>(null);
  const sentLength = useRef(0);
  const lastCheckAt = useRef(0);
  const alive = useRef(true);
  const demoRunning = useRef(false);
  const utterance = useRef(0);

  useEffect(() => {
    alive.current = true;
    session.current = listenContinuous({
      onFinal: (text) => void hear(text),
      onInterim: setInterim,
      onError: (code) =>
        setProblem(
          code === 'network'
            ? 'Rozpoznawanie mowy nie działa — proszę sprawdzić internet. Można uruchomić przykładową rozmowę.'
            : 'Brak dostępu do mikrofonu. Proszę zezwolić na mikrofon albo uruchomić przykładową rozmowę.',
        ),
    });
    if (!session.current) setProblem('Ta przeglądarka nie rozpoznaje mowy. Można uruchomić przykładową rozmowę.');
    void sayOverCall('Słucham rozmowy. Proszę włączyć głośnik w telefonie. Ostrzegę, jeśli coś będzie nie tak.');
    const timer = window.setInterval(() => {
      const every = current.current.level === 'safe' ? 30_000 : 8_000;
      if (Date.now() - lastCheckAt.current >= every) void askServer();
    }, 2_000);
    return () => {
      alive.current = false;
      session.current?.stop();
      window.clearInterval(timer);
      stopSpeaking();
    };
  }, []);

  /**
   * Speaks with the microphone off, so the app never transcribes its own words. Only the
   * latest utterance turns it back on: an interrupted one must not reopen it mid-sentence.
   */
  async function sayOverCall(text: string) {
    const mine = ++utterance.current;
    session.current?.pause();
    await speakAsync(text);
    if (alive.current && !demoRunning.current && utterance.current === mine) session.current?.resume();
  }

  async function hear(text: string) {
    if (!text || !alive.current) return;
    transcript.current = `${transcript.current} ${text}`.trim();
    setLines((l) => [...l, text].slice(-6));
    setInterim('');
    if (await raise(verdictFromRules(transcript.current, profile.addressAs))) void askServer(true);
  }

  /** Returns true when the level went up (and the warning was spoken). */
  async function raise(v: CallGuardVerdict): Promise<boolean> {
    const previous = current.current;
    const level = maxLevel(previous.level, v.level);
    if (level === previous.level) {
      // Same level: take the model's better explanation, but don't repeat the warning.
      if (v.source === 'model' && v.level === level && level !== 'safe' && previous.source === 'rules') {
        current.current = v;
        setVerdict(v);
      }
      return false;
    }
    current.current = v;
    setVerdict(v);
    if (!alive.current) return true;
    navigator.vibrate?.([300, 150, 300]);
    chime('alert');
    if (v.warning) await sayOverCall(v.warning);
    return true;
  }

  async function askServer(force = false) {
    const text = transcript.current;
    if (!text || (!force && text.length === sentLength.current)) return;
    sentLength.current = text.length;
    lastCheckAt.current = Date.now();
    try {
      const v = await postJson<CallGuardVerdict>('/api/senior/call-guard', { sessionId, transcript: text });
      if (alive.current) await raise(v);
    } catch {
      // The local verdict stays; the next tick retries.
    }
  }

  async function runDemo() {
    if (demoRunning.current) return;
    demoRunning.current = true;
    setDemo(true);
    session.current?.pause();
    for (const line of DEMO_CALL) {
      if (!alive.current) return;
      setInterim(line);
      await speakAsync(line, { pitch: 0.7, rate: 1.05 });
      if (!alive.current) return;
      await hear(line);
      await sleep(400);
    }
    demoRunning.current = false;
    setDemo(false);
    if (alive.current) session.current?.resume();
  }

  return (
    <div className={`fixed inset-0 z-50 overflow-y-auto text-white transition-colors duration-500 ${BACKGROUND[verdict.level]}`} role="dialog" aria-modal="true" aria-label="Strażnik rozmowy">
      <div className="mx-auto flex min-h-full max-w-md flex-col px-5 pb-6 pt-6">
        <div className="flex items-center gap-3">
          <ShieldCheck size={48} strokeWidth={2.25} />
          <div>
            <h2 className="text-3xl font-bold leading-tight">Strażnik rozmowy</h2>
            <p className="text-lg text-white/75">Telefon na głośniku — słucham i ostrzegę.</p>
          </div>
        </div>

        <section className="mt-6 rounded-3xl bg-white/10 p-5" aria-live="assertive">
          {verdict.level === 'safe' && <p className="flex items-center gap-3 text-2xl font-semibold">
              <CircleCheck size={32} className="shrink-0" /> Na razie nic niepokojącego.
            </p>}
          {verdict.level === 'suspicious' && (
            <>
              <p className="flex items-center gap-3 text-3xl font-bold">
                <TriangleAlert size={36} className="shrink-0" /> Uwaga
              </p>
              {verdict.reason && <p className="mt-2 text-2xl">{capitalize(verdict.reason)}.</p>}
              <p className="mt-2 text-xl text-white/85">Proszę nie podawać żadnych danych i nie przekazywać pieniędzy.</p>
            </>
          )}
          {verdict.level === 'scam' && (
            <>
              <p className="flex items-center gap-3 text-3xl font-bold">
                <OctagonAlert size={38} className="shrink-0" /> To wygląda na oszustwo!
              </p>
              {verdict.reason && <p className="mt-2 text-2xl">{capitalize(verdict.reason)}.</p>}
              <p className="mt-3 text-2xl font-bold">Proszę się rozłączyć.</p>
              <p className="mt-1 text-lg text-white/80">Rodzina dostała powiadomienie.</p>
            </>
          )}
        </section>

        <section className="mt-4 flex-1 rounded-3xl bg-black/20 p-4">
          <p className="text-sm font-bold uppercase tracking-wide text-white/60">Słyszę</p>
          <div className="mt-2 space-y-2 text-xl leading-snug text-white/90">
            {lines.map((line, i) => (
              <p key={i}>„{line}”</p>
            ))}
            {interim && <p className="italic text-white/60">{interim}…</p>}
            {!lines.length && !interim && <p className="text-white/50">Czekam na rozmowę…</p>}
          </div>
          <p className="mt-4 text-sm text-white/55">Rozmowa nie jest nigdzie zapisywana.</p>
        </section>

        {problem && <p className="mt-3 rounded-2xl bg-black/30 px-4 py-3 text-lg">{problem}</p>}

        <div className="mt-4 grid gap-3">
          {verdict.level !== 'safe' && (
            <button type="button" onClick={() => onCall(contact)} className="flex min-h-[4.5rem] items-center justify-center gap-3 rounded-2xl bg-white text-2xl font-bold text-ink">
              <Phone size={28} /> Zadzwoń: {contact.name}
            </button>
          )}
          <button type="button" onClick={onClose} className="min-h-16 rounded-2xl bg-white/15 text-2xl font-bold ring-2 ring-white/40">
            Zakończ
          </button>
          <button type="button" onClick={() => void runDemo()} disabled={demo} className="flex min-h-12 items-center justify-center gap-2 text-lg text-white/75 underline underline-offset-4 disabled:no-underline disabled:opacity-60">
            {!demo && <Play size={18} />}
            {demo ? 'Trwa przykładowa rozmowa…' : 'Przykładowa rozmowa „na policjanta” (demo)'}
          </button>
        </div>
      </div>
    </div>
  );
}
