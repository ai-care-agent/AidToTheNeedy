import { Heart } from 'lucide-react';
import type { CSSProperties } from 'react';

/** A heart that beats at her pulse while a band is streaming, and rests otherwise. */
export function Beat({ bpm, size = 24, live }: { bpm: number; size?: number; live: boolean }) {
  return (
    <span className={live ? 'heartbeat' : 'inline-grid'} style={{ '--beat': `${(60 / Math.max(30, bpm)).toFixed(2)}s` } as CSSProperties} aria-hidden>
      <Heart size={size} className="text-danger" fill="currentColor" strokeWidth={0} />
    </span>
  );
}
