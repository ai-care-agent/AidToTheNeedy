import { Pointer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { onScreenName, type GuideEvent } from '../../../shared/guide';

const SHOW_MS = 30_000;
const PAD = 10;

/**
 * "Pokaż palcem": everything dims except one button, which pulses under a pointing hand, with
 * a caption saying who is pointing. Her tap on the button goes through (and closes this); a
 * tap anywhere else only closes it, so a missed aim never does something else.
 */
export function Spotlight({ guide, onClose }: { guide: GuideEvent; onClose: (tapped: boolean) => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-guide="${guide.target}"]`);
    if (!el) {
      onClose(false);
      return;
    }
    el.scrollIntoView({ behavior: document.documentElement.hasAttribute('data-reduced-motion') ? 'auto' : 'smooth', block: 'center' });
    const update = () => setRect(el.getBoundingClientRect());
    update();
    const settle = window.setTimeout(update, 500);
    const timeout = window.setTimeout(() => onClose(false), SHOW_MS);
    const onTap = (e: MouseEvent) => {
      if (el.contains(e.target as Node)) return onClose(true);
      e.stopPropagation();
      e.preventDefault();
      onClose(false);
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    document.addEventListener('click', onTap, true);
    return () => {
      window.clearTimeout(settle);
      window.clearTimeout(timeout);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      document.removeEventListener('click', onTap, true);
    };
  }, [guide]);

  if (!rect) return null;
  // The caption goes to the half of the screen the button is not in; the hand "taps" the
  // button's lower right corner, so neither covers the other.
  const captionOnTop = rect.top + rect.height / 2 > window.innerHeight / 2;
  const hand = {
    left: Math.min(window.innerWidth - 88, Math.max(8, rect.right - 56)),
    top: Math.min(window.innerHeight - 88, Math.max(8, rect.bottom - 40)),
  };
  const hole = { left: rect.left - PAD, top: rect.top - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD };

  return (
    <div className="pointer-events-none fixed inset-0 z-[45]" aria-live="assertive">
      <div className="spotlight-hole absolute rounded-[2rem]" style={hole} />
      <span
        className="spotlight-hand absolute grid size-20 place-items-center rounded-full bg-brand text-on-accent shadow-lift"
        style={hand}
        aria-hidden
      >
        <Pointer size={44} strokeWidth={2.5} />
      </span>
      <p
        className="absolute inset-x-4 mx-auto max-w-lg rounded-3xl bg-surface p-4 text-center text-2xl font-bold leading-snug shadow-lift ring-2 ring-brand"
        style={captionOnTop ? { top: 16 } : { bottom: 16 }}
      >
        {guide.from ? `${guide.from} pokazuje:` : 'Tutaj:'} <span className="text-brand">{onScreenName(guide.target)}</span>
        <span className="mt-1 block text-lg font-semibold text-muted">Proszę nacisnąć to, co świeci.</span>
      </p>
    </div>
  );
}
