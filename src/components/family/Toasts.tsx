import { X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FeedItem } from '../../../shared/types';
import { IconBadge, type Tone } from '../ui';

const SHOW_MS = 6_000;
const MAX = 3;

interface Toast {
  item: FeedItem;
  until: number;
}

/**
 * What just happened, as it happens: each new feed item slides in at the top for a few
 * seconds. The first snapshot only sets the baseline, so opening the app shows nothing.
 */
export function Toasts({ feed, look, onOpen }: { feed: FeedItem[]; look: (item: FeedItem) => { icon: LucideIcon; tone: Tone }; onOpen: (item: FeedItem) => void }) {
  const seen = useRef<Set<number> | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(feed.map((f) => f.id));
      return;
    }
    const fresh = feed.filter((f) => !seen.current!.has(f.id));
    if (!fresh.length) return;
    for (const f of fresh) seen.current.add(f.id);
    const until = Date.now() + SHOW_MS;
    setToasts((t) => [...fresh.map((item) => ({ item, until })), ...t].slice(0, MAX));
  }, [feed]);

  useEffect(() => {
    if (!toasts.length) return;
    const next = Math.min(...toasts.map((t) => t.until));
    const timer = window.setTimeout(() => setToasts((t) => t.filter((x) => x.until > Date.now())), Math.max(50, next - Date.now()));
    return () => window.clearTimeout(timer);
  }, [toasts]);

  const close = (id: number) => setToasts((t) => t.filter((x) => x.item.id !== id));

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-40 flex flex-col items-center gap-2 px-3 sm:items-end sm:px-6" aria-live="polite">
      {toasts.map(({ item }) => {
        const { icon, tone } = look(item);
        return (
          <div key={item.id} className="toast-in pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl bg-surface p-3 shadow-lift ring-1 ring-white/10">
            <button type="button" onClick={() => (onOpen(item), close(item.id))} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <IconBadge icon={icon} tone={tone} size={36} />
              <span className="min-w-0">
                <span className="block font-semibold leading-snug">{item.title}</span>
                {item.detail && <span className="block truncate text-sm text-muted">{item.detail}</span>}
              </span>
            </button>
            <button type="button" onClick={() => close(item.id)} aria-label="Zamknij" className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-paper">
              <X size={18} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
