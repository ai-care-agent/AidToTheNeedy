import { useCallback, useEffect, useRef, useState } from 'react';
import { getJson } from './api';
import { onConnectionChange, onServerEvent } from './serverEvents';

/**
 * Fetches a state snapshot and refetches it whenever the server pushes a "change" event.
 * A slow poll covers dropped connections.
 */
export function useLiveState<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [offline, setOffline] = useState(false);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latest.current;
    try {
      const next = await getJson<T>(url);
      if (request === latest.current) {
        setData(next);
        setOffline(false);
      }
    } catch {
      if (request === latest.current) setOffline(true);
    }
  }, [url]);

  useEffect(() => {
    void refresh();
    const offChange = onServerEvent('change', () => void refresh());
    const offOpen = onServerEvent('open', () => void refresh());
    const offStatus = onConnectionChange((online) => !online && setOffline(true));
    const poll = window.setInterval(() => void refresh(), 30_000);
    return () => {
      offChange();
      offOpen();
      offStatus();
      window.clearInterval(poll);
    };
  }, [refresh]);

  return { data, offline, refresh };
}

/** Re-renders every `intervalMs` so clocks and "5 min temu" labels stay current. */
export function useNow(intervalMs = 15_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
