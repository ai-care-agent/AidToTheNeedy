// Thin wrappers over the browser's Web Speech API (free, no extra vendor for the POC).
// Recognition works in Chrome/Edge (desktop and Android) and Safari; Firefox falls back to typing.

import { getA11y } from './a11y';

const LANG = 'pl-PL';

const Recognition = typeof window === 'undefined' ? undefined : (window.SpeechRecognition ?? window.webkitSpeechRecognition);

export const sttSupported = Boolean(Recognition);
export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

// ---------------------------------------------------------------- speech synthesis

let voice: SpeechSynthesisVoice | null = null;

function pickVoice(): void {
  if (!ttsSupported) return;
  const polish = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('pl'));
  const preferred = ['google', 'natural', 'zosia', 'paulina', 'agnieszka', 'ewa', 'marek'];
  voice = [...polish].sort((a, b) => rank(a) - rank(b))[0] ?? null;

  function rank(v: SpeechSynthesisVoice) {
    const i = preferred.findIndex((p) => v.name.toLowerCase().includes(p));
    return i === -1 ? preferred.length : i;
  }
}

if (ttsSupported) {
  pickVoice();
  window.speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

export function hasPolishVoice(): boolean {
  return voice !== null;
}

let speechRun = 0;

/**
 * Speaks sentence by sentence: Chrome silently stops long utterances after ~15 s.
 * `onEnd` fires once when this text has been spoken; it does not fire when a newer
 * speak() or stopSpeaking() call interrupted it.
 */
export function speak(text: string, onEnd?: () => void, voiceOptions: { pitch?: number; rate?: number } = {}): void {
  const run = ++speechRun;
  const done = () => {
    if (run === speechRun) onEnd?.();
  };
  if (!ttsSupported || !text.trim()) {
    done();
    return;
  }
  const synth = window.speechSynthesis;
  const busy = synth.speaking || synth.pending;
  synth.cancel();

  const sentences = text.match(/[^.!?…]+[.!?…]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(watchdog);
    done();
  };
  // Some engines never fire onend; allow ~90 ms per character plus slack.
  const watchdog = window.setTimeout(finish, 4_000 + text.length * 90);

  const enqueue = () => {
    if (run !== speechRun) return;
    sentences.forEach((sentence, i) => {
      const u = new SpeechSynthesisUtterance(sentence);
      u.lang = LANG;
      if (voice) u.voice = voice;
      u.rate = voiceOptions.rate ?? getA11y().speechRate;
      u.pitch = voiceOptions.pitch ?? 1;
      if (i === sentences.length - 1) u.onend = finish;
      u.onerror = finish;
      synth.speak(u);
    });
  };
  // Chrome drops utterances queued in the same tick as cancel().
  if (busy) window.setTimeout(enqueue, 80);
  else enqueue();
}

export function stopSpeaking(): void {
  speechRun++;
  if (ttsSupported) window.speechSynthesis.cancel();
}

/** Resolves when the text was spoken or interrupted (never rejects). */
export function speakAsync(text: string, voiceOptions?: { pitch?: number; rate?: number }): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let check: number | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearInterval(check);
      resolve();
    };
    const run = speechRun + 1;
    speak(text, finish, voiceOptions);
    if (!settled) check = window.setInterval(() => speechRun !== run && finish(), 200);
  });
}

// ---------------------------------------------------------------- speech recognition

export interface ListenHandlers {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd: () => void;
  onError: (code: string) => void;
}

let active: SpeechRecognition | null = null;

/** Starts one utterance of recognition; the browser stops by itself after a pause. */
export function listen(handlers: ListenHandlers): void {
  if (!Recognition) {
    handlers.onError('not-supported');
    handlers.onEnd();
    return;
  }
  active?.abort();
  const rec = new Recognition();
  active = rec;
  rec.lang = LANG;
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = '';
  // A recognizer replaced by a newer listen() call must not report into the new session.
  rec.onresult = (event) => {
    if (active !== rec) return;
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    handlers.onPartial((finalText + ' ' + interim).trim());
  };
  rec.onerror = (event) => {
    if (active === rec && event.error !== 'aborted') handlers.onError(event.error);
  };
  rec.onend = () => {
    if (active !== rec) return;
    active = null;
    const text = finalText.trim();
    if (text) handlers.onFinal(text);
    handlers.onEnd();
  };
  try {
    rec.start();
  } catch {
    active = null;
    handlers.onError('start-failed');
    handlers.onEnd();
  }
}

export function stopListening(): void {
  active?.stop();
}

// ---------------------------------------------------------------- continuous listening (call guard, recorder)

export interface ContinuousSession {
  stop: () => void;
  /** Stops hearing while the app itself speaks, so it doesn't transcribe its own warning. */
  pause: () => void;
  resume: () => void;
}

/**
 * Keeps recognising until stopped. Chrome ends continuous sessions on its own every so
 * often, so the recognizer is restarted; repeated instant failures give up with an error.
 */
export function listenContinuous(handlers: { onFinal: (text: string) => void; onInterim: (text: string) => void; onError: (code: string) => void }): ContinuousSession | null {
  if (!Recognition) return null;
  const Ctor = Recognition;
  let running = true;
  let paused = false;
  let current: SpeechRecognition | null = null;
  let quickFailures = 0;

  const start = () => {
    if (!running || paused) return;
    const rec = new Ctor();
    current = rec;
    const startedAt = Date.now();
    rec.lang = LANG;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      if (current !== rec) return;
      quickFailures = 0;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) handlers.onFinal(result[0].transcript.trim());
        else interim += result[0].transcript;
      }
      handlers.onInterim(interim.trim());
    };
    rec.onerror = (event) => {
      if (current !== rec) return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        running = false;
        handlers.onError(event.error);
      }
    };
    rec.onend = () => {
      if (current !== rec) return;
      current = null;
      quickFailures = Date.now() - startedAt < 1_000 ? quickFailures + 1 : 0;
      if (quickFailures >= 5) {
        running = false;
        handlers.onError('network');
        return;
      }
      window.setTimeout(start, 250);
    };
    try {
      rec.start();
    } catch {
      current = null;
    }
  };

  start();
  const halt = () => {
    const rec = current;
    current = null;
    rec?.abort();
  };
  return {
    stop: () => {
      running = false;
      halt();
    },
    pause: () => {
      paused = true;
      halt();
    },
    resume: () => {
      if (!running || !paused) return;
      paused = false;
      start();
    },
  };
}
