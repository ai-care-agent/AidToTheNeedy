import {
  Accessibility,
  AudioLines,
  CalendarDays,
  Check,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  FileText,
  ImagePlus,
  Keyboard,
  Lock,
  Mail,
  Mic,
  Phone,
  Pill,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Siren,
  Snail,
  Square,
  Stethoscope,
  Sun,
  Video,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AccessibilityChange, ChatResponse, Contact, SeniorDisplay, HealthView, Order, SeniorState, WeatherNow } from '../../shared/types';
import { Beat } from '../components/health/Beat';
import { DayRings } from '../components/health/DayRings';
import { CallGuard } from '../components/senior/CallGuard';
import { DoctorSheet } from '../components/senior/DoctorSheet';
import { HealthSheet } from '../components/senior/HealthSheet';
import { MedicinesSheet } from '../components/senior/MedicinesSheet';
import { PlanCard } from '../components/senior/PlanCard';
import { OverlayView, overlayAnnouncement, pickOverlay, type Announcement, type OverlayActions } from '../components/senior/overlays';
import { VoiceRecorder } from '../components/senior/VoiceRecorder';
import { Avatar, IconBadge, Sheet, TONE, type Tone } from '../components/ui';
import { AccessibilitySheet } from '../components/AccessibilitySheet';
import { Magnifier } from '../components/senior/Magnifier';
import { SetupWizard } from '../components/senior/SetupWizard';
import { Spotlight } from '../components/senior/Spotlight';
import { guideTarget, type GuideEvent, type GuideTarget } from '../../shared/guide';
import { VideoCallScreen } from '../components/VideoCallScreen';
import { getJson, postJson } from '../lib/api';
import { fmtLongDate, fmtTime, fmtWhen, greeting } from '../lib/format';
import { DEFAULTS, describeChange, getA11y, getSeenRev, isSetupDone, markSetupDone, previewAutoTheme, sameSettings, setSunTimes, setA11y, setSeenRev, stepSpeechRate, stepTextSize, useA11y, withDefaults, type A11ySettings, type Theme } from '../lib/a11y';
import { fmtInt, useLivePulse } from '../lib/health';
import { chime, encodeImage, unlockAudio, type EncodedImage } from '../lib/media';
import { recordingSupported } from '../lib/recorder';
import { currentLocation, requestMotionPermission, watchForFalls } from '../lib/safety';
import { onServerEvent } from '../lib/serverEvents';
import { listen, speak, stopListening, stopSpeaking, sttSupported } from '../lib/speech';
import { useLiveState, useNow } from '../lib/useLiveState';
import { useVideoCall, videoSupported } from '../lib/video';

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

/** Full-screen tools that take over the screen (and the microphone) until closed. */
type Mode = { kind: 'guard' } | { kind: 'record'; contact: Contact } | { kind: 'magnifier' } | { kind: 'setup' } | null;

interface Exchange {
  user: string;
  assistant: string | null;
  error?: boolean;
  image?: string;
}

const DOCUMENT_QUESTION = 'Co jest napisane w tym piśmie? Proszę wyjaśnić prosto, czego dotyczy i co trzeba zrobić.';

const SAMPLE_DOCUMENTS = [
  { src: '/samples/rachunek-woda.png', label: 'Rachunek za wodę' },
  { src: '/samples/wezwanie-do-zaplaty.png', label: 'Wezwanie do zapłaty' },
];

export function SeniorApp() {
  const { data: state, offline, refresh } = useLiveState<SeniorState>('/api/senior/state');
  const now = useNow(10_000);
  const a11y = useA11y();
  const [guide, setGuide] = useState<GuideEvent | null>(null);
  const [remoteChange, setRemoteChange] = useState<{ previous: A11ySettings; text: string } | null>(null);
  const [started, setStarted] = useState(false);
  const [phase, setPhaseState] = useState<Phase>('idle');
  // Mirrors `phase` synchronously, for timers and callbacks that outlive a render.
  const phaseRef = useRef<Phase>('idle');
  const [partial, setPartial] = useState('');
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typing, setTyping] = useState(!sttSupported);
  const [draft, setDraft] = useState('');
  const [sheet, setSheet] = useState<'document' | 'privacy' | 'medicines' | 'health' | 'a11y' | 'doctor' | null>(null);
  const [call, setCall] = useState<Contact | null>(null);
  const [emergency, setEmergency] = useState<'agent' | 'sos' | null>(null);
  // When a fall was detected: each one is a new card, announced and counted down afresh.
  const [fall, setFall] = useState<number | null>(null);
  const [sosCountdown, setSosCountdown] = useState(false);
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [mode, setModeState] = useState<Mode>(null);
  const modeRef = useRef<Mode>(null);
  const playing = useRef<HTMLAudioElement | null>(null);
  const announced = useRef(new Set<string>());
  const pendingAnnouncement = useRef<{ key: string; what: Announcement } | null>(null);
  const shownKey = useRef<string | null>(null);
  const answeredCheckins = useRef(new Set<number>());
  const replyTo = useRef<Contact | null>(null);
  const asking = useRef(false);
  const video = useVideoCall('senior');
  const videoBusy = useRef(false);
  videoBusy.current = video.phase !== 'idle';

  useEffect(() => {
    if (state?.lastExchange && !exchange) setExchange({ user: state.lastExchange.user, assistant: state.lastExchange.assistant });
  }, [state, exchange]);

  useEffect(() => {
    if (state?.video) video.adopt(state.video);
  }, [state?.video?.id]);

  // "Pokaż palcem": the family points at a button. Whatever covers the home screen steps aside
  // (a sheet, the magnifier), then the button lights up and the assistant says where to tap.
  useEffect(
    () =>
      onServerEvent('guide', (data) => {
        const e = data as GuideEvent;
        if (videoBusy.current) return;
        setSheet(null);
        setMode(null);
        setGuide(e);
        say(`${e.from ?? 'Asystentka'} pokazuje: proszę nacisnąć ${guideTarget(e.target).spoken}.`);
      }),
    [],
  );

  // "Automatycznie" follows the sun at her home; the demo can preview the evening at noon.
  useEffect(() => {
    if (state?.sun) setSunTimes(state.sun);
  }, [state?.sun.sunrise, state?.sun.sunset]);
  useEffect(() => onServerEvent('theme_preview', (data) => previewAutoTheme((data as { theme: 'light' | 'dark' | null }).theme)), []);

  // The demo panel can open "Dopasuj ekran" on her phone.
  useEffect(
    () =>
      onServerEvent('screen_setup', () => {
        setSheet(null);
        setMode({ kind: 'setup' });
      }),
    [],
  );

  // The demo panel can simulate what the accelerometer would report.
  useEffect(() => onServerEvent('safety', (e) => (e as { type?: string }).type === 'fall' && setFall(Date.now())), []);

  useEffect(() => {
    if (!started) return;
    const load = () =>
      void getJson<WeatherNow | null>('/api/senior/weather')
        .then(setWeather)
        .catch(() => {});
    load();
    const timer = window.setInterval(load, 30 * 60_000);
    const stopFalls = watchForFalls(() => setFall(Date.now()));
    return () => {
      window.clearInterval(timer);
      stopFalls();
    };
  }, [started]);

  // The family changed her screen from their app: apply it, say who and what, offer "Cofnij".
  useEffect(() => {
    const d = state?.display;
    if (!d || d.rev === getSeenRev()) return;
    setSeenRev(d.rev);
    const local = getA11y();
    if (!d.settings || sameSettings(local, d.settings)) return;
    const incoming = withDefaults(d.settings);
    setA11y(incoming);
    if (d.updatedBy !== 'family') return;
    const who = state!.contacts[0];
    const changes = describeChange(local, incoming);
    const text = `${who.name} ${who.gender === 'f' ? 'zmieniła' : 'zmienił'} wygląd ekranu: ${changes.join(', ')}.`;
    setRemoteChange({ previous: local, text });
    if (started) say(`${text} Jeśli tak nie jest wygodnie, proszę nacisnąć „Cofnij”.`);
  }, [state?.display.rev]);

  // Her own changes go back to the server, so the family sees what she has. Debounced: a few
  // taps on the size buttons are one change, and a remote change applied above settles first.
  useEffect(() => {
    if (!state) return;
    const server = state.display.settings;
    if (server ? sameSettings(server, a11y) : sameSettings(a11y, DEFAULTS)) return;
    const timer = window.setTimeout(() => {
      void postJson<SeniorDisplay>('/api/senior/display', { settings: a11y }).then((d) => {
        setSeenRev(d.rev);
        void refresh();
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [a11y, state?.display.rev]);

  function undoRemoteChange() {
    if (!remoteChange) return;
    setA11y(remoteChange.previous);
    void postJson<SeniorDisplay>('/api/senior/display', { settings: remoteChange.previous, undo: true }).then((d) => {
      setSeenRev(d.rev);
      void refresh();
    });
    setRemoteChange(null);
    say('Dobrze, wróciłam do poprzedniego wyglądu.');
  }

  // "Czytaj po dotknięciu": a tap on any text (not on a button or a field) reads it aloud.
  useEffect(() => {
    if (!a11y.tapToRead || !started) return;
    const onTap = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('button, a, input, textarea, select, label, [role="switch"], [role="dialog"] video')) return;
      const block = el.closest('p, h1, h2, h3, li, td, dd, dt') as HTMLElement | null;
      // textContent, not innerText: headings are uppercased by CSS, and speech engines spell capitals out.
      const text = block?.textContent?.replace(/\s+/g, ' ').trim();
      if (!block || !text) return;
      block.classList.add('reading');
      window.setTimeout(() => block.classList.remove('reading'), 1_500);
      hush();
      say(text);
    };
    document.addEventListener('click', onTap);
    return () => document.removeEventListener('click', onTap);
  }, [a11y.tapToRead, started]);

  // A video call takes the screen and the microphone.
  useEffect(() => {
    if (video.phase === 'idle') return;
    stopListening();
    hush();
  }, [video.phase]);

  const overlay = state && started ? pickOverlay(state, { emergency, fall, sosCountdown, call }) : null;

  // Announce each card once (a snoozed reminder gets a new key when it comes back), but
  // never over her own words, over an answer on its way, or over the assistant speaking.
  useEffect(() => {
    shownKey.current = overlay?.key ?? null;
    if (!overlay || !state) return;
    if (!announced.current.has(overlay.key)) {
      announced.current.add(overlay.key);
      const what = overlayAnnouncement(overlay, state);
      if (what) {
        chime(overlay.kind === 'scam' || overlay.kind === 'fall' ? 'alert' : 'gentle');
        pendingAnnouncement.current = { key: overlay.key, what };
      }
    }
    if (!pendingAnnouncement.current) return;
    const timer = window.setTimeout(flushAnnouncement, 700);
    return () => window.clearTimeout(timer);
  }, [overlay?.key]);

  useEffect(() => {
    if (phase === 'idle' && !mode && video.phase === 'idle') flushAnnouncement();
  }, [phase, mode, video.phase]);

  function flushAnnouncement() {
    const pending = pendingAnnouncement.current;
    if (!pending) return;
    if (pending.key !== shownKey.current) {
      pendingAnnouncement.current = null;
      return;
    }
    if (phaseRef.current !== 'idle' || modeRef.current || videoBusy.current) return;
    pendingAnnouncement.current = null;
    if ('play' in pending.what) play(pending.what.play);
    else say(pending.what.say);
  }

  function setMode(next: Mode) {
    if (next) {
      stopListening();
      hush();
    }
    modeRef.current = next;
    setModeState(next);
  }

  /** A family member's own voice, through the same queue as the assistant's speech. */
  function play(url: string) {
    hush();
    const audio = new Audio(url);
    playing.current = audio;
    setPhase('speaking');
    const done = () => {
      if (playing.current === audio) playing.current = null;
      setPhase((p) => (p === 'speaking' ? 'idle' : p));
    };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  }

  function setPhase(next: Phase | ((current: Phase) => Phase)) {
    const value = typeof next === 'function' ? next(phaseRef.current) : next;
    phaseRef.current = value;
    setPhaseState(value);
  }

  function say(text: string, rate?: number) {
    setPhase('speaking');
    speak(text, () => setPhase((p) => (p === 'speaking' ? 'idle' : p)), rate ? { rate } : {});
  }

  /** Stops speech and playback without saying anything else (speak()'s onEnd does not fire then). */
  function hush() {
    stopSpeaking();
    playing.current?.pause();
    playing.current = null;
    setPhase((p) => (p === 'speaking' ? 'idle' : p));
  }

  async function ask(text: string, options: { display?: string; image?: EncodedImage } = {}) {
    // Tiles stay tappable while the agent thinks; one question at a time.
    if (asking.current) return;
    asking.current = true;
    stopListening();
    hush();
    setNotice(null);
    setPhase('thinking');
    const shown: Exchange = { user: options.display ?? text, assistant: null, image: options.image?.previewUrl };
    setExchange(shown);
    try {
      const res = await postJson<ChatResponse>('/api/senior/chat', { text, image: options.image && { mediaType: options.image.mediaType, data: options.image.data } });
      setExchange({ ...shown, assistant: res.reply, error: Boolean(res.error) });
      say(res.reply);
      for (const action of res.actions) {
        if (action.type === 'call') setCall(action.contact);
        if (action.type === 'emergency') setEmergency('agent');
        // Let the short reply ("włączam strażnika…") finish before the tool takes the screen.
        if (action.type === 'call_guard') window.setTimeout(() => setMode({ kind: 'guard' }), 2_500);
        if (action.type === 'record_message') window.setTimeout(() => setMode({ kind: 'record', contact: action.contact }), 2_000);
        if (action.type === 'video_call') window.setTimeout(() => void video.start(), 1_800);
        if (action.type === 'accessibility') applyAccessibility(action.change);
        if (action.type === 'guide') window.setTimeout(() => setGuide({ target: action.target, from: null }), 1_200);
      }
    } catch {
      const reply = 'Przepraszam, nie mogę teraz połączyć się z asystentką. Proszę spróbować za chwilę.';
      setExchange({ ...shown, assistant: reply, error: true });
      say(reply);
    } finally {
      asking.current = false;
    }
    void refresh();
  }

  /** "Powiększ tekst", "włącz lupę", "mów wolniej" — the agent asks, the device does it. */
  function applyAccessibility(change: AccessibilityChange) {
    switch (change) {
      case 'text_bigger':
      case 'text_smaller':
        stepTextSize(change === 'text_bigger' ? 1 : -1);
        break;
      case 'speak_slower':
      case 'speak_faster':
        stepSpeechRate(change === 'speak_slower' ? -1 : 1);
        break;
      case 'theme_dark':
      case 'theme_light':
      case 'theme_contrast':
        setA11y({ theme: change.slice(6) as Theme });
        break;
      case 'magnifier':
        window.setTimeout(() => setMode({ kind: 'magnifier' }), 1_500);
        break;
      case 'settings':
        setSheet('a11y');
        break;
    }
  }

  function startListening(target: Contact | null = null) {
    unlockAudio();
    hush();
    replyTo.current = target;
    setNotice(null);
    setPartial('');
    setPhase('listening');
    listen({
      onPartial: setPartial,
      onFinal: (text) => {
        const to = replyTo.current;
        replyTo.current = null;
        void ask(to ? `Odpowiedź do: ${to.name}. Treść: ${text}` : text, { display: text });
      },
      onEnd: () => {
        setPartial('');
        setPhase((p) => (p === 'listening' ? 'idle' : p));
      },
      onError: (code) => {
        if (code === 'not-allowed' || code === 'service-not-allowed') setNotice('Brak dostępu do mikrofonu. Proszę zezwolić na mikrofon w przeglądarce albo pisać.');
        else if (code === 'no-speech') setNotice('Nic nie usłyszałam. Proszę nacisnąć przycisk i mówić jeszcze raz.');
        else if (code === 'network') setNotice('Rozpoznawanie mowy potrzebuje internetu.');
        else if (code === 'not-supported') setTyping(true);
      },
    });
  }

  function onMic() {
    if (phase === 'listening') return stopListening();
    if (phase === 'thinking') return;
    startListening();
  }

  function onType(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || phase === 'thinking') return;
    setDraft('');
    void ask(text);
  }

  function start() {
    unlockAudio();
    void requestMotionPermission();
    setStarted(true);
    void postJson('/api/senior/hello');
    // First time on this phone and nobody has set the screen up yet: ask five questions first.
    if (!isSetupDone() && !state!.display.settings) {
      setMode({ kind: 'setup' });
      return;
    }
    // A pending card (reminder, warning…) speaks for itself; don't talk over it.
    if (!pickOverlay(state!, { emergency: null, fall: null, sosCountdown: false, call: null })) {
      say(`${greeting(now, state!.tz)}, ${state!.profile.addressAs}! Tu ${state!.profile.assistantName}. Proszę nacisnąć duży przycisk i powiedzieć, w czym mogę pomóc.`);
    }
  }

  async function useDocument(image: EncodedImage) {
    setSheet(null);
    await ask(DOCUMENT_QUESTION, { display: 'Co jest napisane w tym piśmie?', image });
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    try {
      await useDocument(await encodeImage(file));
    } catch {
      setNotice('Nie udało się odczytać zdjęcia. Proszę spróbować jeszcze raz.');
    }
  }

  async function onSample(src: string) {
    const blob = await (await fetch(src)).blob();
    await useDocument(await encodeImage(blob));
  }

  function openCall(contact: Contact) {
    setCall(contact);
    void postJson('/api/senior/call', { contactId: contact.id });
  }

  async function raiseSos(reason: 'button' | 'fall' | 'fall_help') {
    setEmergency('sos');
    say(`Wysyłam alarm do rodziny. ${reason === 'button' ? '' : 'Proszę się nie ruszać, jeśli boli. '}W nagłej sytuacji proszę zadzwonić pod numer sto dwanaście.`);
    const geo = await currentLocation();
    void postJson('/api/senior/sos', { reason, geo }).then(refresh);
  }

  const actions: OverlayActions = {
    confirmReminder: (r) => {
      void postJson(`/api/senior/reminders/${r.id}/done`).then(refresh);
      say(r.category === 'medication' ? 'Dziękuję, zapisałam, że leki są wzięte.' : 'Dziękuję, zapisane.');
    },
    snoozeReminder: (r) => {
      void postJson(`/api/senior/reminders/${r.id}/snooze`, { minutes: 10 }).then(refresh);
      say('Dobrze, przypomnę za dziesięć minut.');
    },
    dismissScam: (sms) => {
      void postJson(`/api/senior/sms/${sms.id}/seen`).then(refresh);
      say('Bardzo dobrze. Ta wiadomość nie zrobi już nic złego.');
    },
    checkScam: (sms) => {
      void postJson(`/api/senior/sms/${sms.id}/seen`).then(() => ask('Czy ten SMS jest prawdziwy? Co mam zrobić?'));
    },
    callFamily: (contact, sms) => {
      hush();
      if (sms) void postJson(`/api/senior/sms/${sms.id}/seen`).then(refresh);
      openCall(contact);
    },
    replyToMessage: (m, from) => {
      void postJson(`/api/senior/messages/${m.id}/read`).then(refresh);
      if (recordingSupported) setMode({ kind: 'record', contact: from });
      else startListening(from);
    },
    playMessage: (m) => {
      if (m.audioUrl) play(m.audioUrl);
    },
    confirmOrder: (o) => {
      void postJson(`/api/senior/orders/${o.id}/confirm`).then(refresh);
      say(o.needsFamilyApproval ? `Dobrze. Wysłałam prośbę o zgodę do: ${state!.contacts[0].name}.` : o.kind === 'taxi' ? `Zamówione. Taksówka przyjedzie ${o.eta}.` : `Zamówione. Dostawa ${o.eta}.`);
    },
    declineOrder: (o) => {
      void postJson(`/api/senior/orders/${o.id}/decline`).then(refresh);
      say('Dobrze, nic nie zamawiam.');
    },
    closeOrderUpdate: (o) => {
      hush();
      void postJson(`/api/senior/orders/${o.id}/seen`).then(refresh);
    },
    closeMessage: (m) => {
      hush();
      void postJson(`/api/senior/messages/${m.id}/read`).then(refresh);
    },
    repeat: say,
    answerCheckin: (c, mood) => {
      if (answeredCheckins.current.has(c.id)) return;
      answeredCheckins.current.add(c.id);
      void postJson(`/api/senior/checkins/${c.id}`, { mood }).then(refresh);
      if (mood === 'good') say('Bardzo się cieszę! Życzę miłego dnia.');
      else
        void ask(`(Samopoczucie jest już zapisane w aplikacji.) Czuję się dziś ${mood === 'bad' ? 'źle' : 'tak sobie'}.`, {
          display: mood === 'bad' ? 'Czuję się dziś źle.' : 'Czuję się dziś tak sobie.',
        });
    },
    readSms: (sms) => {
      void postJson(`/api/senior/sms/${sms.id}/read`).then(refresh);
      say(`SMS od ${sms.sender}. ${sms.text}`);
    },
    closeSms: (sms) => {
      hush();
      void postJson(`/api/senior/sms/${sms.id}/seen`).then(refresh);
    },
    closeCall: () => setCall(null),
    closeEmergency: () => {
      hush();
      setEmergency(null);
    },
    answerSafety: (c, answer) => {
      if (answer === 'help') {
        setEmergency('sos');
        void currentLocation().then((geo) => postJson(`/api/senior/safety/${c.id}`, { answer, geo }).then(refresh));
        say('Wysyłam alarm do rodziny. W nagłej sytuacji proszę zadzwonić pod numer sto dwanaście.');
      } else {
        void postJson(`/api/senior/safety/${c.id}`, { answer }).then(refresh);
        say('To dobrze. Gdyby coś się działo, jestem tutaj.');
      }
    },
    fallOk: () => {
      setFall(null);
      void postJson('/api/senior/fall-ok');
      say('Całe szczęście. Proszę wstawać powoli.');
    },
    fallHelp: () => {
      setFall(null);
      void raiseSos('fall_help');
    },
    fallNoAnswer: () => {
      setFall(null);
      void raiseSos('fall');
    },
    sosCancel: () => {
      setSosCountdown(false);
      hush();
    },
    sosSend: () => {
      setSosCountdown(false);
      void raiseSos('button');
    },
    refillYes: (m) => {
      void postJson<Order>(`/api/senior/medicines/${m.id}/refill`).then((order) => {
        say(order.status === 'awaiting_family' ? `Wysłałam prośbę o zgodę do: ${state!.contacts[0].name}.` : `Zamówione. Dostawa ${order.eta}.`);
        void refresh();
      });
    },
    answerHealth: (c, answer) => {
      void postJson(`/api/senior/health/checks/${c.id}`, { answer }).then(refresh);
      if (answer === 'unwell') {
        setEmergency('agent');
        say('Powiadomiłam rodzinę. Jeśli jest bardzo źle, proszę od razu zadzwonić pod numer sto dwanaście.');
      } else if (answer === 'remeasure') say('Dobrze. Przypomnę za pięć minut. Proszę teraz spokojnie posiedzieć.');
      else say('To dobrze. Gdyby coś się zmieniło, proszę mi powiedzieć.');
    },
    refillLater: (m) => {
      void postJson(`/api/senior/medicines/${m.id}/snooze-refill`).then(refresh);
      say('Dobrze, przypomnę jutro.');
    },
  };

  if (!state) {
    return (
      <Shell>
        <p className="mt-24 text-center text-2xl text-muted">{offline ? 'Brak połączenia z serwerem…' : 'Wczytywanie…'}</p>
      </Shell>
    );
  }

  const { profile } = state;
  const primary = state.contacts[0];

  if (!started) {
    return (
      <Shell>
        <div className="mx-auto flex min-h-[86vh] max-w-lg flex-col items-center justify-center text-center">
          <span className="orb size-40" data-phase="idle">
            <AudioLines size={64} strokeWidth={2.25} />
          </span>
          <h1 className="mt-10 text-4xl font-bold leading-tight sm:text-5xl">
            {greeting(now, state.tz)}, {profile.addressAs}!
          </h1>
          <p className="mt-4 text-2xl text-muted">Tu {profile.assistantName}, Pani asystentka.</p>
          <button type="button" onClick={start} className="mt-10 min-h-[5.5rem] w-full rounded-3xl bg-brand px-8 text-3xl font-bold text-on-accent shadow-lift hover:bg-brand-strong">
            Zaczynamy
          </button>
          <p className="mt-4 text-lg text-muted">Dotknięcie włącza dźwięk i głos asystentki.</p>
        </div>
      </Shell>
    );
  }

  const nextItem = upcoming(state);
  const lowMedicine = state.medicines.find((m) => m.lowStock);
  const unread = state.incomingMessages.length + state.newSms.length;

  return (
    <Shell>
      {!state.ai.configured && <Banner tone="warn">Tryb bez AI: dodaj ANTHROPIC_API_KEY w pliku .env, aby asystentka odpowiadała.</Banner>}
      {offline && <Banner tone="danger">Brak połączenia z serwerem — ponawiam…</Banner>}

      <div className="lg:grid lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:items-start lg:gap-10">
        {/* ------------------------------------------------ left: the assistant */}
        <div className="lg:sticky lg:top-6">
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div>
              <p className="num" style={{ fontSize: 'min(6rem, 25vw)' }}>
                <span className="sr-only">Godzina </span>
                {fmtTime(now, state.tz)}
              </p>
              <p className="mt-2 text-2xl font-semibold first-letter:uppercase">{fmtLongDate(now, state.tz)}</p>
            </div>
            <div className="flex items-center gap-3">
              {weather && <WeatherChip weather={weather} />}
              <button
                type="button"
                data-guide="a11y"
                onClick={() => setSheet('a11y')}
                aria-label="Ułatwienia: wielkość tekstu, kolory, lupa"
                className="grid size-16 shrink-0 place-items-center rounded-full bg-surface font-display text-3xl font-bold shadow-soft ring-2 ring-line hover:ring-brand"
              >
                Aa
              </button>
            </div>
          </header>

          <section className="mt-6 rounded-[2rem] bg-surface p-5 shadow-soft" aria-live="polite">
            {exchange?.user && (
              <div className="mb-4 flex items-start gap-3">
                {exchange.image && <img src={exchange.image} alt="Zdjęcie pisma" className="h-16 w-12 rounded-lg object-cover ring-1 ring-line" />}
                <p className="rounded-2xl rounded-tl-md bg-paper px-4 py-2 text-lg text-muted">„{exchange.user}”</p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="orb size-8" data-phase={phase} aria-hidden />
              <p className="text-base font-bold uppercase tracking-wide text-brand">{profile.assistantName}</p>
            </div>
            <p className={`mt-2 text-2xl leading-snug ${exchange?.error ? 'text-warn' : ''}`}>
              {phase === 'thinking' ? 'Chwileczkę, już sprawdzam…' : (exchange?.assistant ?? `${greeting(now, state.tz)}, ${profile.addressAs}! W czym mogę pomóc?`)}
            </p>
            {exchange?.assistant && phase !== 'thinking' && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => say(exchange.assistant!)}
                  className="inline-flex min-h-14 items-center gap-2 rounded-2xl px-4 text-lg font-semibold text-brand ring-2 ring-brand-soft hover:bg-brand-soft"
                >
                  <RotateCcw size={22} /> Powtórz
                </button>
                {/* Not caught the first time: the same words, noticeably slower. */}
                <button
                  type="button"
                  onClick={() => say(exchange.assistant!, Math.max(0.6, a11y.speechRate - 0.25))}
                  className="inline-flex min-h-14 items-center gap-2 rounded-2xl px-4 text-lg font-semibold text-brand ring-2 ring-brand-soft hover:bg-brand-soft"
                >
                  <Snail size={22} /> Powtórz wolniej
                </button>
              </div>
            )}
          </section>

          <section className="mt-8 flex flex-col items-center">
            <VoiceOrb phase={phase} disabled={phase === 'thinking' || !sttSupported} onPress={onMic} />
            {partial && <p className="mt-3 text-center text-xl text-muted">„{partial}”</p>}
            {notice && <p className="mt-3 rounded-2xl bg-warn-soft px-4 py-2 text-center text-lg text-warn">{notice}</p>}
          </section>

          <section className="mt-6">
            {typing ? (
              <form onSubmit={onType} className="flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Napisz, w czym pomóc…"
                  className="min-h-16 min-w-0 flex-1 rounded-2xl bg-surface px-4 text-xl shadow-sm ring-2 ring-line focus:ring-brand"
                  aria-label="Wiadomość do asystentki"
                />
                <button type="submit" disabled={phase === 'thinking'} className="grid size-16 place-items-center rounded-2xl bg-brand text-on-accent disabled:opacity-60" aria-label="Wyślij">
                  <Send size={26} />
                </button>
              </form>
            ) : (
              <button type="button" onClick={() => setTyping(true)} className="flex min-h-12 items-center gap-2 text-lg text-muted underline-offset-4 hover:underline">
                <Keyboard size={22} /> Wolę napisać
              </button>
            )}
          </section>
        </div>

        {/* ------------------------------------------------ right: family, tools, the day */}
        <div className="mt-10 space-y-8 lg:mt-0">
          <section className="rounded-[2rem] bg-surface p-4 shadow-soft" aria-label="Mój dzień w liczbach">
            <DayRings days={state.health.days} doses={state.week} thresholds={state.health.thresholds} large onRing={(r) => say(`${r.spoken}.`)} />
            <p className="mt-2 text-center text-lg text-muted">Dotknięcie koła przeczyta wynik.</p>
          </section>

          <section>
            <h2 className="kicker mb-3 text-3xl">Twoi bliscy</h2>
            <div className="grid gap-3">
              {state.contacts.map((c) => {
                const canVideo = videoSupported && c.id === primary.id;
                // One row when the card is wide enough for the name and both labelled buttons.
                return (
                  <div key={c.id} className="@container rounded-[1.75rem] bg-surface p-4 shadow-soft">
                    <div className="flex flex-col gap-3 @min-[27rem]:flex-row @min-[27rem]:items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar name={c.name} size={56} />
                        <div className="min-w-0">
                          <p className="truncate text-2xl font-bold leading-tight">{c.name}</p>
                          <p className="text-lg text-muted">{c.relation}</p>
                        </div>
                      </div>
                      <div className={`grid shrink-0 gap-2 ${canVideo ? '@min-[19rem]:grid-cols-2' : ''}`}>
                        <button
                          type="button"
                          data-guide={c.id === primary.id ? 'call' : undefined}
                          onClick={() => openCall(c)}
                          className="flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-ok px-4 text-xl font-bold text-on-accent shadow-sm hover:brightness-110"
                          aria-label={`Zadzwoń: ${c.name}`}
                        >
                          <Phone size={24} className="shrink-0" /> Zadzwoń
                        </button>
                        {canVideo && (
                          <button
                            type="button"
                            data-guide="video"
                            onClick={() => void video.start()}
                            className="flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-xl font-bold text-on-accent shadow-sm hover:bg-brand-strong"
                            aria-label={`Wideo: ${c.name}`}
                          >
                            <Video size={26} className="shrink-0" /> Wideo
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Two tiles per row only while they are wide enough for the words (the text-size switch counts). */}
          <section className="@container">
            <div className="grid gap-3 @min-[21rem]:grid-cols-2">
              <Tile wide icon={CalendarDays} tone="sun" label="Mój dzień" hint={nextItem ?? 'Nic więcej na dziś'} onClick={() => void ask('Co mam dzisiaj do zrobienia?')} />
              <Tile
                icon={Pill}
                tone="teal"
                label="Moje leki"
                hint={lowMedicine ? `Kończy się: ${lowMedicine.name}` : `${state.medicines.length} w apteczce`}
                alert={Boolean(lowMedicine)}
                onClick={() => setSheet('medicines')}
                guide="medicines"
              />
              <HealthTile health={state.health} onClick={() => setSheet('health')} />
              <Tile guide="document" icon={FileText} tone="sky" label="Przeczytaj pismo" hint="Zdjęcie listu lub rachunku" onClick={() => setSheet('document')} />
              <Tile
                icon={Mail}
                tone="lilac"
                label="Wiadomości"
                hint={unread ? `Nowe: ${unread}` : 'SMS-y i od rodziny'}
                alert={unread > 0}
                onClick={() => void ask('Przeczytaj moje nowe wiadomości.')}
                guide="messages"
              />
              <Tile
                guide="doctor"
                icon={Stethoscope}
                tone="ok"
                label="Mój lekarz"
                hint={state.upcomingEvents[0] ? `Wizyta: ${fmtWhen(state.upcomingEvents[0].startsAt, now, state.tz)}` : (state.careTeam.doctors[0]?.name ?? 'Telefon do przychodni')}
                onClick={() => setSheet('doctor')}
              />
              <Tile guide="magnifier" icon={Search} tone="brand" label="Lupa" hint="Powiększ drobny druk" onClick={() => setMode({ kind: 'magnifier' })} />
              <Tile guide="guard" wide={!recordingSupported} icon={ShieldCheck} tone="sand" label="Strażnik rozmowy" hint="Gdy dzwoni ktoś obcy" onClick={() => setMode({ kind: 'guard' })} />
              {recordingSupported && <Tile guide="record" icon={AudioLines} tone="rose" label="Nagraj wiadomość" hint={`Dla: ${primary.name}`} onClick={() => setMode({ kind: 'record', contact: primary })} />}
            </div>
          </section>

          <button
            type="button"
            data-guide="sos"
            onClick={() => setSosCountdown(true)}
            className="flex min-h-[5rem] w-full items-center justify-center gap-4 rounded-[1.75rem] bg-danger px-5 text-2xl font-bold text-on-accent shadow-lift hover:brightness-110"
          >
            <Siren size={34} /> SOS — wezwij pomoc
          </button>

          <PlanCard state={state} onSay={say} onChange={() => void refresh()} />

          <footer className="flex flex-wrap items-center justify-between gap-4 pb-4">
            <button type="button" onClick={() => setSheet('a11y')} className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl py-2 bg-surface px-5 text-xl font-bold shadow-soft ring-2 ring-line hover:ring-brand">
              <Accessibility size={28} /> Ułatwienia
              <span className="text-lg font-semibold text-muted">tekst, kolory, lupa</span>
            </button>
            <button type="button" onClick={() => setSheet('privacy')} className="flex min-h-12 items-center gap-2 text-lg text-muted underline-offset-4 hover:underline">
              <Lock size={22} /> Co widzi rodzina?
            </button>
          </footer>
        </div>
      </div>

      {sheet === 'document' && (
        <Sheet title="Przeczytaj pismo" onClose={() => setSheet(null)}>
          <label className="flex min-h-[4.5rem] cursor-pointer items-center justify-center gap-3 rounded-2xl bg-brand px-5 text-2xl font-bold text-on-accent hover:bg-brand-strong">
            <FileText size={28} /> Zrób zdjęcie pisma
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </label>
          <label className="flex min-h-16 cursor-pointer items-center justify-center gap-3 rounded-2xl bg-surface px-5 text-xl font-semibold ring-2 ring-line hover:ring-brand">
            <ImagePlus size={24} /> Wybierz zdjęcie z galerii
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </label>
          <p className="pt-2 text-base font-semibold text-muted">Przykładowe pisma (demo):</p>
          <div className="grid grid-cols-2 gap-3">
            {SAMPLE_DOCUMENTS.map((doc) => (
              <button key={doc.src} type="button" onClick={() => void onSample(doc.src)} className="rounded-2xl bg-surface p-2 text-left shadow-sm ring-2 ring-line hover:ring-brand">
                <img src={doc.src} alt="" className="h-32 w-full rounded-lg object-cover object-top" />
                <span className="mt-2 block text-lg font-semibold leading-tight">{doc.label}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {sheet === 'health' && <HealthSheet health={state.health} tz={state.tz} onClose={() => setSheet(null)} onSay={say} onAsk={(q) => void ask(q)} onSaved={() => void refresh()} />}

      {sheet === 'a11y' && (
        <AccessibilitySheet
          onClose={() => setSheet(null)}
          onSay={say}
          onSetup={() => {
            setSheet(null);
            setMode({ kind: 'setup' });
          }}
          onMagnifier={() => {
            setSheet(null);
            setMode({ kind: 'magnifier' });
          }}
        />
      )}

      {sheet === 'doctor' && <DoctorSheet team={state.careTeam} visits={state.upcomingEvents} tz={state.tz} onClose={() => setSheet(null)} onSay={say} onChange={() => void refresh()} />}

      {sheet === 'medicines' && <MedicinesSheet medicines={state.medicines} onClose={() => setSheet(null)} onSay={say} />}

      {sheet === 'privacy' && (
        <Sheet title="Co widzi rodzina?" onClose={() => setSheet(null)}>
          <div className="rounded-2xl bg-ok-soft p-4 text-xl leading-relaxed">
            <p className="flex items-center gap-2 font-bold text-ok">
              <Check size={22} /> Rodzina widzi:
            </p>
            <p>plan dnia, potwierdzenia leków i wizyt, apteczkę, zamówienia, ostrzeżenia o oszustwach, alarmy SOS, wiadomości, które Pani wyśle, i te pomiary zdrowia, które Pani udostępni.</p>
          </div>
          <div className="rounded-2xl bg-surface p-4 text-xl leading-relaxed ring-1 ring-line">
            <p className="flex items-center gap-2 font-bold">
              <Lock size={22} /> Rodzina nie widzi:
            </p>
            <p>treści rozmów z asystentką, zdjęć pism, rozmów telefonicznych przy strażniku ani prywatnych przypomnień. Wystarczy powiedzieć „to prywatne”.</p>
          </div>
        </Sheet>
      )}

      {mode?.kind === 'guard' && (
        <CallGuard
          profile={profile}
          contact={primary}
          onClose={() => setMode(null)}
          onCall={(c) => {
            setMode(null);
            openCall(c);
          }}
        />
      )}
      {guide && !overlay && !mode && video.phase === 'idle' && (
        <Spotlight
          key={`${guide.target}:${guide.from}`}
          guide={guide}
          onClose={(tapped) => {
            if (tapped && guide.from) void postJson('/api/senior/guide/done', { target: guide.target });
            if (!tapped) hush();
            setGuide(null);
          }}
        />
      )}

      {remoteChange && !overlay && !mode && (
        <div className="animate-rise fixed inset-x-3 bottom-3 z-30 mx-auto max-w-lg rounded-[1.75rem] bg-surface p-4 shadow-lift ring-2 ring-brand" role="status">
          <p className="flex items-start gap-3 text-xl leading-snug">
            <Accessibility size={28} className="mt-0.5 shrink-0 text-brand" /> {remoteChange.text}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setRemoteChange(null)} className="min-h-16 rounded-2xl bg-ok text-xl font-bold text-on-accent">
              Zostaw
            </button>
            <button type="button" onClick={undoRemoteChange} className="flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-surface text-xl font-bold ring-2 ring-line">
              <RotateCcw size={24} /> Cofnij
            </button>
          </div>
        </div>
      )}

      {mode?.kind === 'setup' && (
        <SetupWizard
          onSay={say}
          onDone={() => {
            markSetupDone();
            setMode(null);
            say(`Dziękuję! ${greeting(now, state.tz)}, ${profile.addressAs}. Proszę nacisnąć duży przycisk i powiedzieć, w czym mogę pomóc.`);
          }}
        />
      )}

      {mode?.kind === 'magnifier' && (
        <Magnifier
          onClose={() => setMode(null)}
          onRead={(image) => {
            setMode(null);
            void ask('Przeczytaj na głos, co jest napisane na tym zdjęciu. Jeśli to ulotka lub opakowanie leku, przeczytaj najważniejsze: nazwę, dawkowanie i ostrzeżenia.', { display: 'Przeczytaj, co tu jest napisane.', image });
          }}
        />
      )}
      {mode?.kind === 'record' && <VoiceRecorder contact={mode.contact} onClose={() => setMode(null)} />}
      {overlay && !mode && video.phase === 'idle' && <OverlayView key={overlay.key} overlay={overlay} state={state} actions={actions} />}
      <VideoCallScreen call={video} peer={primary.name} large />
    </Shell>
  );
}

/** "Następne: 20:00 Leki wieczorne" — the next thing today, for the "Mój dzień" tile. */
function upcoming(state: SeniorState): string | null {
  const now = Date.parse(state.now);
  const items = [
    ...state.today.reminders.filter((r) => r.status === 'scheduled' || r.status === 'due').map((r) => ({ at: r.plannedAt, title: r.title })),
    ...state.today.events.map((e) => ({ at: e.startsAt, title: e.title })),
  ]
    .filter((x) => Date.parse(x.at) >= now - 30 * 60_000)
    .sort((a, b) => a.at.localeCompare(b.at));
  return items[0] ? `Następne: ${fmtTime(items[0].at, state.tz)} ${items[0].title}` : null;
}

function weatherIcon(description: string): LucideIcon {
  const d = description.toLowerCase();
  if (d.includes('burz')) return CloudLightning;
  if (d.includes('śnieg')) return CloudSnow;
  if (d.includes('deszcz') || d.includes('mżawk') || d.includes('ulew')) return CloudRain;
  if (d.includes('mgła')) return CloudFog;
  if (d.includes('bezchmurn') || d.includes('słonecz')) return Sun;
  if (d.includes('pochmurn')) return Cloud;
  return CloudSun;
}

function WeatherChip({ weather }: { weather: WeatherNow }) {
  const Icon = weatherIcon(weather.description);
  const badAir = weather.air && weather.airLevel && weather.airLevel !== 'good';
  return (
    <div className="flex items-center gap-3 rounded-3xl bg-surface px-4 py-2.5 shadow-soft">
      <Icon size={36} className="shrink-0 text-deep-sun" aria-hidden />
      <div className="leading-tight">
        {weather.temp !== null && <p className="text-2xl font-bold">{weather.temp}°</p>}
        <p className="text-base text-muted first-letter:uppercase">{weather.description}</p>
        {badAir && (
          <p className="flex items-center gap-1 text-base font-semibold text-warn">
            <Wind size={16} aria-hidden /> {weather.air}
          </p>
        )}
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-paper">
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-5 sm:px-6 lg:px-10 lg:pt-8">{children}</div>
    </main>
  );
}

function Banner({ tone, children }: { tone: 'warn' | 'danger'; children: ReactNode }) {
  return <p className={`mb-4 rounded-2xl px-4 py-2 text-base ${tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-danger-soft text-danger'}`}>{children}</p>;
}

function VoiceOrb({ phase, disabled, onPress }: { phase: Phase; disabled: boolean; onPress: () => void }) {
  const label = { idle: 'Naciśnij i mów', listening: 'Słucham… naciśnij, gdy skończysz', thinking: 'Chwileczkę…', speaking: 'Naciśnij, żeby przerwać i mówić' }[phase];
  return (
    <>
      <button type="button" onClick={onPress} disabled={disabled} aria-label={label} data-phase={phase} data-guide="mic" className="orb size-44 disabled:opacity-60 sm:size-48">
        {phase === 'listening' ? (
          <Square size={56} fill="currentColor" />
        ) : phase === 'speaking' ? (
          <span className="bars" aria-hidden>
            <span />
            <span />
            <span />
            <span />
          </span>
        ) : phase === 'thinking' ? null : (
          <Mic size={72} strokeWidth={2.25} />
        )}
      </button>
      <p className="mt-5 text-center text-2xl font-bold">{sttSupported ? label : 'Ta przeglądarka nie rozpoznaje mowy — proszę pisać.'}</p>
    </>
  );
}

function Tile({
  icon,
  tone,
  label,
  hint,
  onClick,
  guide,
  wide = false,
  alert = false,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  hint?: string;
  onClick: () => void;
  guide?: GuideTarget;
  wide?: boolean;
  alert?: boolean;
}) {
  return (
    <button
      type="button"
      data-guide={guide}
      onClick={onClick}
      className={`group relative flex min-h-36 flex-col justify-between gap-3 rounded-[1.75rem] p-4 text-left shadow-soft ring-1 ring-white/5 transition hover:-translate-y-0.5 hover:shadow-lift active:scale-[0.98] ${TONE[tone].tint} ${wide ? '@min-[21rem]:col-span-2' : ''}`}
    >
      <IconBadge icon={icon} tone={tone} size={56} />
      <span className="min-w-0 break-words">
        <span className="block text-2xl font-bold leading-tight">{label}</span>
        {hint && <span className={`mt-1 block text-lg leading-snug ${alert ? 'font-semibold text-deep-rose' : 'text-muted'}`}>{hint}</span>}
      </span>
      {alert && <span className="absolute right-4 top-4 size-4 rounded-full bg-danger ring-4 ring-surface" aria-hidden />}
    </button>
  );
}

/** "Moje zdrowie": the heart beats at her pulse while the band streams it. */
function HealthTile({ health, onClick }: { health: HealthView; onClick: () => void }) {
  const pulse = useLivePulse(health.latest.heart_rate);
  const check = (['blood_pressure', 'heart_rate', 'spo2', 'temperature'] as const).some((m) => health.latest[m]?.level === 'alert');
  const parts = [pulse.bpm !== null ? `Tętno ${Math.round(pulse.bpm)}` : null, health.today.steps !== null ? `${fmtInt(health.today.steps)}\u00a0kroków` : null].filter(Boolean);
  return (
    <button
      type="button"
      data-guide="health"
      onClick={onClick}
      className={`group relative flex min-h-36 flex-col justify-between gap-3 rounded-[1.75rem] p-4 text-left shadow-soft ring-1 ring-white/5 transition hover:-translate-y-0.5 hover:shadow-lift active:scale-[0.98] ${TONE.rose.tint}`}
    >
      <span className="grid size-14 place-items-center rounded-full bg-surface">
        <Beat bpm={pulse.bpm ?? 70} size={32} live={pulse.live} />
      </span>
      <span className="min-w-0 break-words">
        <span className="block text-2xl font-bold leading-tight">Moje zdrowie</span>
        <span className={`mt-1 block text-lg leading-snug ${check ? 'font-semibold text-deep-rose' : 'text-muted'}`}>{parts.length ? parts.join(' · ') : 'Tętno, ciśnienie, kroki'}</span>
      </span>
      {pulse.live && <span className="absolute right-4 top-4 rounded-full bg-surface px-2 text-sm font-bold text-danger">na żywo</span>}
    </button>
  );
}
