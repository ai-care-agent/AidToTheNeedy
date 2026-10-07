import { Mic, Send, Square } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { postJson } from '../../lib/api';
import { clipPayload, fmtSeconds, recordingSupported, startRecording, transcribeWhileRecording, type Recording, type VoiceClip } from '../../lib/recorder';
import { listenContinuous, type ContinuousSession } from '../../lib/speech';

const MAX_SECONDS = 60;

/** Text or voice: a recorded message plays in the family member's own voice on Mom's phone. */
export function MessageComposer({ onSent, senior }: { onSent: () => void; senior: string }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<VoiceClip | null>(null);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recording = useRef<Recording | null>(null);
  const listening = useRef<ContinuousSession | null>(null);
  const said = useRef('');

  useEffect(() => {
    if (recordingSince === null) return;
    const timer = window.setInterval(() => {
      const s = (Date.now() - recordingSince) / 1000;
      setElapsed(s);
      if (s >= MAX_SECONDS) void stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [recordingSince]);

  useEffect(
    () => () => {
      listening.current?.stop();
      recording.current?.cancel();
    },
    [],
  );

  useEffect(() => () => {
    if (clip) URL.revokeObjectURL(clip.url);
  }, [clip]);

  async function submitText(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await postJson('/api/family/messages', { text: text.trim() });
      setText('');
      onSent();
    } finally {
      setSending(false);
    }
  }

  async function record() {
    setError(null);
    try {
      recording.current = await startRecording();
    } catch {
      setError('Brak dostępu do mikrofonu.');
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
    setElapsed(0);
    setRecordingSince(Date.now());
  }

  async function stop() {
    listening.current?.stop();
    listening.current = null;
    setRecordingSince(null);
    const r = recording.current;
    recording.current = null;
    if (r) setClip(await r.stop());
  }

  async function sendClip() {
    if (!clip) return;
    setSending(true);
    try {
      await postJson('/api/family/voice', await clipPayload(clip, said.current));
      setClip(null);
      setTranscript('');
      onSent();
    } catch {
      setError('Nie udało się wysłać nagrania.');
    } finally {
      setSending(false);
    }
  }

  if (recordingSince !== null) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-danger-soft px-3 py-2">
        <span className="size-3 animate-pulse rounded-full bg-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold tabular-nums text-danger">Nagrywanie {fmtSeconds(elapsed)}</p>
          {transcript && <p className="truncate text-sm text-muted">{transcript}</p>}
        </div>
        <button type="button" onClick={() => void stop()} className="grid size-11 place-items-center rounded-xl bg-danger text-on-accent" aria-label="Zakończ nagrywanie">
          <Square size={18} fill="currentColor" />
        </button>
      </div>
    );
  }

  if (clip) {
    return (
      <div className="space-y-2 rounded-2xl bg-paper p-3 ring-1 ring-line">
        <audio src={clip.url} controls className="h-10 w-full" />
        {transcript && <p className="text-sm text-muted">„{transcript}”</p>}
        <div className="flex gap-2">
          <button type="button" onClick={() => void sendClip()} disabled={sending} className="min-h-11 flex-1 rounded-xl bg-brand font-semibold text-on-accent disabled:opacity-50">
            {sending ? 'Wysyłam…' : 'Wyślij nagranie'}
          </button>
          <button type="button" onClick={() => setClip(null)} className="min-h-11 rounded-xl px-4 font-semibold text-muted ring-1 ring-line">
            Usuń
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <form onSubmit={submitText} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`${senior} usłyszy ją od asystentki…`}
          className="min-h-12 min-w-0 flex-1 rounded-2xl bg-paper px-3 ring-1 ring-line focus:ring-2 focus:ring-brand"
          aria-label="Treść wiadomości"
        />
        {recordingSupported && !text.trim() ? (
          <button type="button" onClick={() => void record()} className="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand-strong" aria-label="Nagraj wiadomość głosową">
            <Mic size={22} />
          </button>
        ) : (
          <button type="submit" disabled={sending || !text.trim()} className="grid size-12 place-items-center rounded-2xl bg-brand text-on-accent disabled:opacity-50" aria-label="Wyślij">
            <Send size={20} />
          </button>
        )}
      </form>
      {recordingSupported && (
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted">
          <Mic size={14} /> Nagranie głosowe usłyszy Twoim głosem.
        </p>
      )}
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
