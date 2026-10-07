import { Contrast, Flashlight, FlashlightOff, Minus, Pause, Play, Plus, Volume2, X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { encodeImage, type EncodedImage } from '../../lib/media';

// Lupa: the phone's camera as a magnifying glass for leaflets, labels and price tags. Uses the
// camera's own zoom when it has one (sharper), otherwise enlarges the picture. "Zatrzymaj"
// freezes the frame so she can hold the phone away and move around the still picture with a
// finger; "Przeczytaj" sends that frame to the assistant to read aloud.

const FILTERS = [
  { key: 'none', label: 'Zwykły', css: 'none' },
  { key: 'contrast', label: 'Kontrast', css: 'grayscale(1) contrast(1.8) brightness(1.1)' },
  { key: 'invert', label: 'Negatyw', css: 'grayscale(1) invert(1) contrast(1.6)' },
] as const;

const MAX_DIGITAL_ZOOM = 6;

interface ZoomRange {
  min: number;
  max: number;
  step: number;
}

type CameraCaps = MediaTrackCapabilities & { zoom?: ZoomRange; torch?: boolean };

export function Magnifier({ onClose, onRead }: { onClose: () => void; onRead: (image: EncodedImage) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hardwareZoom, setHardwareZoom] = useState<ZoomRange | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(2);
  const [filter, setFilter] = useState(0);
  const [frozen, setFrozen] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; start: { x: number; y: number } } | null>(null);
  const frozenAt = useRef(1);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const t = stream.getVideoTracks()[0];
        track.current = t;
        const caps = (t.getCapabilities?.() ?? {}) as CameraCaps;
        if (caps.zoom && caps.zoom.max > caps.zoom.min) setHardwareZoom(caps.zoom);
        setTorchAvailable(Boolean(caps.torch));
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play().catch(() => {});
        }
      } catch {
        setError('Nie mam dostępu do aparatu. Proszę zezwolić przeglądarce na aparat i spróbować jeszcze raz.');
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // The camera's own zoom, clamped to what it reports; the rest is done on screen.
  const maxZoom = hardwareZoom ? Math.max(hardwareZoom.max, 2) : MAX_DIGITAL_ZOOM;
  useEffect(() => {
    if (!hardwareZoom || !track.current || frozen) return;
    const value = Math.min(hardwareZoom.max, Math.max(hardwareZoom.min, zoom));
    void track.current.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] }).catch(() => setHardwareZoom(null));
  }, [zoom, hardwareZoom, frozen]);

  function toggleTorch() {
    const next = !torch;
    void track.current
      ?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      .then(() => setTorch(next))
      .catch(() => setTorchAvailable(false));
  }

  function freeze() {
    const v = video.current;
    const c = canvas.current;
    if (!v || !c) return;
    if (frozen) {
      setFrozen(false);
      setPan({ x: 0, y: 0 });
      void v.play().catch(() => {});
      return;
    }
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    frozenAt.current = hardwareZoom ? Math.min(hardwareZoom.max, Math.max(hardwareZoom.min, zoom)) : 1;
    v.pause();
    setFrozen(true);
  }

  async function read() {
    const c = canvas.current;
    if (!c) return;
    if (!frozen) freeze();
    const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/jpeg', 0.9));
    if (blob) onRead(await encodeImage(blob));
  }

  // Whatever the camera doesn't zoom itself is done on screen; a still frame already contains
  // the camera zoom it was taken with.
  const cameraZoom = hardwareZoom ? Math.min(hardwareZoom.max, Math.max(hardwareZoom.min, zoom)) : 1;
  const scale = Math.max(1, zoom / (frozen ? frozenAt.current : cameraZoom));
  const style = { transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, filter: FILTERS[filter].css };

  const onPointerDown = (e: PointerEvent) => {
    if (!frozen) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: pan };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    setPan({ x: drag.current.start.x + e.clientX - drag.current.x, y: drag.current.start.y + e.clientY - drag.current.y });
  };
  const endDrag = () => (drag.current = null);

  const bump = (d: number) => setZoom((z) => Math.min(maxZoom, Math.max(1, Math.round((z + d) * 2) / 2)));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label="Lupa">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
        <p className="kicker text-3xl">Lupa</p>
        <p className="num text-3xl" aria-live="polite">
          ×{zoom.toFixed(zoom % 1 ? 1 : 0)}
        </p>
        <button type="button" onClick={onClose} className="grid size-16 place-items-center rounded-full bg-white/15 ring-2 ring-white/40" aria-label="Zamknij lupę">
          <X size={32} />
        </button>
      </div>

      <div
        className="relative flex-1 touch-none overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {error ? (
          <p className="m-6 rounded-3xl bg-white/10 p-5 text-2xl leading-snug">{error}</p>
        ) : (
          <>
            <video ref={video} playsInline muted className={`absolute inset-0 size-full object-cover transition-transform ${frozen ? 'hidden' : ''}`} style={style} />
            <canvas ref={canvas} className={`absolute inset-0 size-full object-cover ${frozen ? '' : 'hidden'}`} style={style} />
            {frozen && <p className="absolute inset-x-0 bottom-3 text-center text-lg font-semibold text-white drop-shadow">Zatrzymane — proszę przesuwać palcem</p>}
          </>
        )}
      </div>

      <div className="space-y-3 bg-black px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-center gap-3">
          <RoundButton label="Mniejsze powiększenie" onClick={() => bump(-0.5)}>
            <Minus size={34} />
          </RoundButton>
          <input
            type="range"
            min={1}
            max={maxZoom}
            step={0.5}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Powiększenie"
            className="h-12 min-w-0 flex-1 accent-[#ffe600]"
          />
          <RoundButton label="Większe powiększenie" onClick={() => bump(0.5)}>
            <Plus size={34} />
          </RoundButton>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <BarButton onClick={freeze}>{frozen ? <><Play size={26} /> Wznów</> : <><Pause size={26} /> Zatrzymaj</>}</BarButton>
          <BarButton onClick={() => setFilter((f) => (f + 1) % FILTERS.length)}>
            <Contrast size={26} /> {FILTERS[filter].label}
          </BarButton>
          {torchAvailable && (
            <BarButton onClick={toggleTorch} pressed={torch}>
              {torch ? <FlashlightOff size={26} /> : <Flashlight size={26} />} Światło
            </BarButton>
          )}
          <BarButton primary wide={!torchAvailable} onClick={() => void read()} disabled={Boolean(error)}>
            <Volume2 size={26} /> Przeczytaj
          </BarButton>
        </div>
      </div>
    </div>
  );
}

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="grid size-16 shrink-0 place-items-center rounded-full bg-white/15 ring-2 ring-white/40 active:scale-95">
      {children}
    </button>
  );
}

function BarButton({ onClick, children, primary = false, wide = false, pressed, disabled = false }: { onClick: () => void; children: ReactNode; primary?: boolean; wide?: boolean; pressed?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      disabled={disabled}
      className={`flex min-h-16 items-center justify-center gap-2 rounded-2xl px-3 text-xl font-bold disabled:opacity-50 ${wide ? 'col-span-2 sm:col-span-1' : ''} ${primary ? 'bg-[#ffe600] text-black' : pressed ? 'bg-white text-black' : 'bg-white/15 ring-2 ring-white/40'}`}
    >
      {children}
    </button>
  );
}
