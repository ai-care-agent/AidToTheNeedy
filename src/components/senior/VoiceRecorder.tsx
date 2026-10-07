import { AudioLines, Check, Mic, RotateCcw, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Contact } from '../../../shared/types';
import { postJson } from '../../lib/api';
import { clipPayload, fmtSeconds, startRecording, transcribeWhileRecording, type Recording, type VoiceClip } from '../../lib/recorder';
import { listenContinuous, speak, stopSpeaking, type ContinuousSession } from '../../lib/speech';

const MAX_SECONDS = 60;

type Stage = 'idle' | 'recording' | 'recorded' | 'sending' | 'sent' | 'error';

/** Her own voice to the family — tap, speak, tap, send. A live transcript rides along when available. */
export function VoiceRecorder({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const [stage, setStage] = useState<Stage>('idle');
  const [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState<VoiceClip | null>(null);
  const [transcript, setTranscript] = useState('');
  const recording = useRef<Recording | null>(null);
  const listening = useRef<ContinuousSession | null>(null);
  const said = useRef('');
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearInterval(timer.current);
      listening.current?.stop();
      recording.current?.cancel();
    },
    [],
  );

  useEffect(() => () => {
    if (clip) URL.revokeObjectURL(clip.url);
  }, [clip]);

  async function start() {
    stopSpeaking();
    try {
      recording.current = await startRecording();
    } catch {
      setStage('error');
      return;
    }
    said.current = '';
    setTranscript('');
    listening.current = !transcribeWhileRecording ? null : listenContinuous({
      onFinal: (t) => {
        said.current = `${said.current} ${t}`.trim();
        setTranscript(said.current);
      },
      onInterim: (t) => setTranscript(`${said.current} ${t}`.trim()),
      onError: () => {},
    });
    const began = Date.now();
    setSeconds(0);
    setStage('recording');
    timer.current = window.setInterval(() => {
      const s = (Date.now() - began) / 1000;
      setSeconds(s);
      if (s >= MAX_SECONDS) void stop();
    }, 250);
  }

  async function stop() {
    window.clearInterval(timer.current);
    listening.current?.stop();
    listening.current = null;
    const r = recording.current;
    recording.current = null;
    if (!r) return;
    setClip(await r.stop());
    setStage('recorded');
  }

  async function send() {
    if (!clip) return;
    setStage('sending');
    try {
      await postJson('/api/senior/voice', { ...(await clipPayload(clip, said.current)), contactId: contact.id });
      setStage('sent');
      speak('Wysłane.');
      window.setTimeout(onClose, 1_500);
    } catch {
      setStage('error');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-[2px] sm:items-center" role="dialog" aria-modal="true" aria-label="Nagraj wiadomość">
      <div className="animate-rise w-full max-w-md rounded-[2rem] bg-paper p-6 shadow-lift">
        <span className="grid size-16 place-items-center rounded-full bg-deep-rose text-on-accent" aria-hidden>
          <AudioLines size={34} />
        </span>
        <h2 className="mt-3 text-3xl font-bold leading-tight">Wiadomość dla: {contact.name}</h2>

        {(stage === 'idle' || stage === 'recording') && (
          <div className="mt-6 flex flex-col items-center">
            <button
              type="button"
              onClick={() => void (stage === 'idle' ? start() : stop())}
              aria-label={stage === 'idle' ? 'Zacznij nagrywać' : 'Zakończ nagrywanie'}
              className={`grid size-36 place-items-center rounded-full bg-danger text-on-accent shadow-xl active:scale-95 ${stage === 'recording' ? 'animate-pulse-ring' : ''}`}
            >
              {stage === 'idle' ? <Mic size={68} strokeWidth={2.25} /> : <Square size={52} fill="currentColor" />}
            </button>
            <p className="mt-4 text-2xl font-semibold">{stage === 'idle' ? 'Naciśnij i powiedz wiadomość' : `Nagrywam… ${fmtSeconds(seconds)}`}</p>
            {stage === 'recording' && <p className="mt-1 text-lg text-muted">Naciśnij jeszcze raz, gdy skończysz.</p>}
            {transcript && <p className="mt-3 text-center text-xl text-muted">„{transcript}”</p>}
          </div>
        )}

        {stage === 'recorded' && clip && (
          <div className="mt-5 space-y-3">
            <audio src={clip.url} controls className="w-full" />
            {transcript && <p className="text-xl text-muted">„{transcript}”</p>}
            <button type="button" onClick={() => void send()} className="flex min-h-[4.5rem] w-full items-center justify-center gap-3 rounded-2xl bg-ok text-2xl font-bold text-on-accent">
              <Check size={30} /> Wyślij
            </button>
            <button type="button" onClick={() => void start()} className="flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-surface text-xl font-semibold ring-2 ring-line">
              <RotateCcw size={24} /> Nagraj jeszcze raz
            </button>
          </div>
        )}

        {stage === 'sending' && <p className="mt-6 text-2xl">Wysyłam…</p>}
        {stage === 'sent' && (
          <p className="mt-6 flex items-center gap-2 text-2xl font-bold text-ok">
            <Check size={30} /> Wysłane
          </p>
        )}
        {stage === 'error' && <p className="mt-6 rounded-2xl bg-danger-soft p-4 text-xl text-danger">Nie udało się nagrać. Proszę zezwolić przeglądarce na mikrofon.</p>}

        {stage !== 'sent' && (
          <button type="button" onClick={onClose} className="mt-4 min-h-14 w-full rounded-2xl text-xl font-semibold text-muted hover:bg-surface">
            Anuluj
          </button>
        )}
      </div>
    </div>
  );
}
