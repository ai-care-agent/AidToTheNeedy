import { Mic, MicOff, PhoneOff, Video } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { useVideoCall } from '../lib/video';
import { Avatar } from './ui';

type Call = ReturnType<typeof useVideoCall>;

const END_TEXT: Record<string, (peer: string) => string> = {
  missed: (p) => `${p} nie odbiera. Spróbujmy później albo nagrajmy wiadomość.`,
  declined: (p) => `${p} nie może teraz rozmawiać.`,
  cancelled: () => 'Połączenie przerwane.',
  hangup: () => 'Rozmowa zakończona.',
  no_camera: () => 'Brak dostępu do kamery. Proszę zezwolić przeglądarce na kamerę i mikrofon.',
};

/** Full-screen video call UI shared by both apps; the senior variant is larger still. */
export function VideoCallScreen({ call, peer, large = false }: { call: Call; peer: string; large?: boolean }) {
  const remoteRef = useRef<HTMLVideoElement>(null);
  const localRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = call.remote;
  }, [call.remote, call.phase]);
  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = call.local;
  }, [call.local, call.phase]);

  if (call.phase === 'idle') return null;

  const big = large ? 'min-h-24 text-3xl' : 'min-h-16 text-xl';
  const wrap = 'fixed inset-0 z-[60] flex flex-col bg-[#101816] text-white';

  if (call.phase === 'ended') {
    return (
      <div className={`${wrap} items-center justify-center p-6 text-center`} role="status">
        <Avatar name={peer} size={large ? 120 : 88} />
        <p className={`mt-6 font-bold ${large ? 'text-3xl' : 'text-2xl'}`}>{(END_TEXT[call.endReason ?? 'hangup'] ?? END_TEXT.hangup)(peer)}</p>
      </div>
    );
  }

  if (call.phase === 'incoming') {
    return (
      <div className={`${wrap} items-center justify-between px-6 pb-10 pt-16 text-center`} role="alertdialog" aria-label={`${peer} dzwoni`}>
        <div className="flex flex-col items-center">
          <span className="animate-breathe rounded-full ring-8 ring-white/10">
            <Avatar name={peer} size={large ? 160 : 112} />
          </span>
          <p className={`mt-8 font-bold ${large ? 'text-5xl' : 'text-3xl'}`}>{peer}</p>
          <p className={`mt-2 text-white/75 ${large ? 'text-2xl' : 'text-lg'}`}>dzwoni — połączenie wideo</p>
        </div>
        <div className="grid w-full max-w-md gap-4">
          <button type="button" onClick={() => void call.accept()} className={`flex items-center justify-center gap-3 rounded-3xl bg-ok font-bold ${big}`}>
            <Video size={large ? 40 : 28} /> Odbierz
          </button>
          <button type="button" onClick={call.decline} className={`flex items-center justify-center gap-3 rounded-3xl bg-danger font-bold ${big}`}>
            <PhoneOff size={large ? 36 : 26} /> Odrzuć
          </button>
        </div>
      </div>
    );
  }

  const waiting = call.phase === 'outgoing' || !call.remote;
  return (
    <div className={wrap} role="dialog" aria-label={`Rozmowa wideo: ${peer}`}>
      <div className="relative flex-1 overflow-hidden">
        <video ref={remoteRef} autoPlay playsInline className={`absolute inset-0 h-full w-full object-cover ${waiting ? 'opacity-0' : ''}`} />
        {waiting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="animate-breathe rounded-full ring-8 ring-white/10">
              <Avatar name={peer} size={large ? 140 : 100} />
            </span>
            <p className={`mt-6 font-bold ${large ? 'text-4xl' : 'text-2xl'}`}>{call.phase === 'outgoing' ? `Dzwonię do: ${peer}…` : 'Łączę…'}</p>
          </div>
        )}
        {call.local && (
          <video ref={localRef} autoPlay playsInline muted className="absolute bottom-4 right-4 w-[28%] max-w-52 rounded-2xl object-cover shadow-2xl ring-2 ring-white/70 [transform:scaleX(-1)]" />
        )}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-3 bg-black/40 p-4 pb-6">
        <button
          type="button"
          onClick={call.toggleMute}
          aria-pressed={call.muted}
          className={`flex flex-col items-center justify-center rounded-3xl px-5 font-semibold ${large ? 'min-h-24 min-w-28 text-xl' : 'min-h-16 min-w-20 text-base'} ${call.muted ? 'bg-white text-ink' : 'bg-white/15'}`}
        >
          {call.muted ? <MicOff size={large ? 34 : 24} /> : <Mic size={large ? 34 : 24} />}
          {call.muted ? 'Wyciszony' : 'Mikrofon'}
        </button>
        <button type="button" onClick={call.hangUp} className={`flex items-center justify-center gap-3 rounded-3xl bg-danger font-bold ${big}`}>
          <PhoneOff size={large ? 36 : 26} /> {call.phase === 'outgoing' ? 'Anuluj' : 'Zakończ'}
        </button>
      </div>
    </div>
  );
}
