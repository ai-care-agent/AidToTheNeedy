import { Monitor, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { DemoPanel } from './DemoPanel';

type View = 'phones' | 'desktop';

const ALLOW = 'microphone; camera; autoplay; geolocation; accelerometer; gyroscope';

// Both apps side by side plus the demo controls — for showing the Senior ↔ AI ↔ Family loop on one screen.
// "Komputer" shows the senior app as it looks on a laptop (the layout switches to two columns).
export function Present() {
  const [view, setView] = useState<View>('phones');
  return (
    <main className="min-h-dvh bg-[#0c1513] text-white">
      <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
        <p className="flex items-center gap-2.5 font-bold">
          <span className="orb size-7" data-phase="idle" aria-hidden />
          AI Care Agent <span className="font-normal text-white/60">· POC · tryb prezentacji</span>
        </p>
        <div className="flex rounded-full bg-white/10 p-1" role="group" aria-label="Widok">
          {(
            [
              ['phones', Smartphone, 'Telefony'],
              ['desktop', Monitor, 'Komputer'],
            ] as const
          ).map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={view === key}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition ${view === key ? 'bg-white text-on-accent' : 'text-white/75 hover:text-white'}`}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
        <nav className="flex gap-4 text-sm text-white/70">
          <a href="/" className="hover:text-white">
            Start
          </a>
          <a href="/senior" target="_blank" rel="noreferrer" className="hover:text-white">
            Seniorka ↗
          </a>
          <a href="/family" target="_blank" rel="noreferrer" className="hover:text-white">
            Rodzina ↗
          </a>
        </nav>
      </header>
      <div className="flex flex-wrap items-start justify-center gap-6 px-4 pb-6">
        {view === 'phones' ? (
          <>
            <Phone caption="Halina, 79 lat — aplikacja seniora" src="/senior" />
            <Phone caption="Anna, córka — aplikacja rodziny" src="/family" />
          </>
        ) : (
          <Laptop caption="Halina — ta sama aplikacja na komputerze" src="/senior" />
        )}
        <aside className="h-[min(820px,calc(100dvh-110px))] w-[360px] overflow-y-auto rounded-3xl bg-family-bg shadow-2xl">
          <DemoPanel compact />
        </aside>
      </div>
    </main>
  );
}

function Phone({ caption, src }: { caption: string; src: string }) {
  return (
    <figure className="flex flex-col items-center gap-2">
      <figcaption className="text-sm text-white/70">{caption}</figcaption>
      <div className="rounded-[3rem] bg-black p-3 shadow-2xl ring-1 ring-white/10">
        <iframe src={src} title={caption} allow={ALLOW} className="h-[min(780px,calc(100dvh-140px))] w-[375px] rounded-[2.3rem] bg-paper" />
      </div>
    </figure>
  );
}

const LAPTOP = { width: 1280, height: 800, scale: 0.7 };

function Laptop({ caption, src }: { caption: string; src: string }) {
  return (
    <figure className="flex flex-col items-center gap-2">
      <figcaption className="text-sm text-white/70">{caption}</figcaption>
      <div className="overflow-hidden rounded-2xl bg-[#1d2624] shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center gap-1.5 px-4 py-2.5" aria-hidden>
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
          <span className="ml-4 rounded-md bg-white/10 px-3 py-0.5 text-xs text-white/60">care.local/senior</span>
        </div>
        <div style={{ width: LAPTOP.width * LAPTOP.scale, height: LAPTOP.height * LAPTOP.scale }} className="overflow-hidden">
          <iframe
            src={src}
            title={caption}
            allow={ALLOW}
            style={{ width: LAPTOP.width, height: LAPTOP.height, transform: `scale(${LAPTOP.scale})`, transformOrigin: 'top left' }}
            className="bg-paper"
          />
        </div>
      </div>
    </figure>
  );
}
