import { useEffect, useState, useSyncExternalStore } from 'react';
import type { HealthLatest, HealthLevel, HealthMetric, LivePulse } from '../../shared/types';
import { postJson } from './api';
import { connectBand } from './bluetooth';
import { onServerEvent } from './serverEvents';

// ------------------------------------------------------------------ how readings are written

export const METRIC: Record<HealthMetric, { name: string; unit: string; forFamily: string }> = {
  heart_rate: { name: 'Tętno', unit: 'ud./min', forFamily: 'tętno' },
  blood_pressure: { name: 'Ciśnienie', unit: 'mmHg', forFamily: 'ciśnienie' },
  steps: { name: 'Kroki', unit: 'kroków', forFamily: 'kroki' },
  sleep: { name: 'Sen', unit: '', forFamily: 'sen' },
  spo2: { name: 'Saturacja', unit: '%', forFamily: 'saturację' },
  temperature: { name: 'Temperatura', unit: '°C', forFamily: 'temperaturę' },
};

/** "4 520" — grouped the Polish way, with a no-break space. */
export function fmtInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
}

/** "7 godz. 10 min"; `short` gives "7:10". */
export function fmtSleep(minutes: number, short = false): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (short) return `${h}:${String(m).padStart(2, '0')}`;
  return m ? `${h} godz. ${m} min` : `${h} godz.`;
}

/** "37,8" — one decimal with a Polish comma. */
export function fmtTemp(celsius: number): string {
  return celsius.toFixed(1).replace('.', ',');
}

/** The number alone, as it is printed big: "142/91", "72", "6 240", "7 godz. 10 min", "97". */
export function fmtValue(metric: HealthMetric, value: number, value2: number | null = null): string {
  switch (metric) {
    case 'blood_pressure':
      return `${Math.round(value)}/${Math.round(value2 ?? 0)}`;
    case 'steps':
      return fmtInt(value);
    case 'sleep':
      return fmtSleep(value);
    case 'temperature':
      return fmtTemp(value);
    default:
      return String(Math.round(value));
  }
}

/** For speech: "sto czterdzieści dwa na dziewięćdziesiąt jeden" is what engines read from "142 na 91". */
export function spokenValue(metric: HealthMetric, value: number, value2: number | null = null): string {
  switch (metric) {
    case 'blood_pressure':
      return `${Math.round(value)} na ${Math.round(value2 ?? 0)}`;
    case 'heart_rate':
      return `${Math.round(value)} uderzeń na minutę`;
    case 'spo2':
      return `${Math.round(value)} procent`;
    case 'steps':
      return `${Math.round(value)} kroków`;
    case 'sleep':
      return fmtSleep(value).replace('godz.', 'godzin').replace('min', 'minut');
    case 'temperature': {
      // "trzydzieści siedem i osiem dziesiątych stopnia" — engines read "37,8" digit by digit.
      const [whole, tenth] = value.toFixed(1).split('.');
      return tenth === '0' ? `${whole} stopni` : `${whole} i ${tenth} dziesiątych stopnia`;
    }
  }
}

/** Status is never colour alone: each level has its glyph and words. */
export const LEVEL: Record<HealthLevel, { text: string; pill: string; glyph: string }> = {
  normal: { text: 'w normie', pill: 'bg-ok-soft text-ok', glyph: '✓' },
  watch: { text: 'do obserwacji', pill: 'bg-warn-soft text-warn', glyph: '!' },
  alert: { text: 'wymaga uwagi', pill: 'bg-danger-soft text-danger', glyph: '!!' },
};

/** A pulse pushed by a band counts as "na żywo" for this long. */
const LIVE_MS = 20_000;

/** The pulse right now: live from a band over SSE, or the last stored reading. */
export function useLivePulse(stored: HealthLatest | undefined): { bpm: number | null; live: boolean } {
  const [pulse, setPulse] = useState<LivePulse | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => onServerEvent('pulse', (data) => setPulse(data as LivePulse)), []);
  // Re-render so "live" turns off when the band goes quiet.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 5_000);
    return () => window.clearInterval(id);
  }, []);
  const live = pulse !== null && Date.now() - Date.parse(pulse.at) < LIVE_MS;
  return { bpm: live ? pulse.bpm : (stored?.value ?? null), live };
}

// ------------------------------------------------------------------ Bluetooth band on her phone

export interface BandState {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  name: string | null;
  error: string | null;
  lastBpm: number | null;
}

let band: BandState = { status: 'idle', name: null, error: null, lastBpm: null };
let disconnect: (() => void) | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<BandState>) => {
  band = { ...band, ...patch };
  for (const l of listeners) l();
};

export function useBand(): BandState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => band,
  );
}

/** The pulse is averaged and sent every 10 s; a cuff reading is sent at once. */
export async function pairBand(): Promise<void> {
  set({ status: 'connecting', error: null });
  let samples: number[] = [];
  let timer: number | undefined;
  try {
    const device = await connectBand({
      onPulse: (bpm) => {
        if (bpm <= 0) return;
        samples.push(bpm);
        set({ lastBpm: bpm });
      },
      onPressure: ({ sys, dia, pulse }) => {
        void postJson('/api/senior/health/readings', { source: 'bluetooth', metric: 'blood_pressure', value: sys, value2: dia, device: band.name });
        if (pulse) void postJson('/api/senior/health/readings', { source: 'bluetooth', metric: 'heart_rate', value: pulse, device: band.name });
      },
      onTemperature: (celsius) => {
        void postJson('/api/senior/health/readings', { source: 'bluetooth', metric: 'temperature', value: celsius, device: band.name });
      },
      onDisconnect: () => {
        window.clearInterval(timer);
        set({ status: 'idle', lastBpm: null });
      },
    });
    timer = window.setInterval(() => {
      if (!samples.length) return;
      const bpm = samples.reduce((a, b) => a + b, 0) / samples.length;
      samples = [];
      void postJson('/api/senior/health/live', { bpm, device: device.name }).catch(() => {});
    }, 10_000);
    disconnect = () => {
      window.clearInterval(timer);
      device.disconnect();
    };
    set({ status: 'connected', name: device.name });
  } catch (err) {
    // Closing the browser's picker is not an error worth showing.
    const cancelled = err instanceof DOMException && err.name === 'NotFoundError';
    set({ status: cancelled ? 'idle' : 'error', error: cancelled ? null : (err as Error).message });
  }
}

export function unpairBand(): void {
  disconnect?.();
  disconnect = null;
  set({ status: 'idle', name: null, lastBpm: null });
}
