import { AsyncLocalStorage } from 'node:async_hooks';
import Anthropic from '@anthropic-ai/sdk';

// Everything the eval pins so that a case means the same thing on every run: the clock,
// the weather and the record of each API call. Cases run concurrently in one process,
// so the record is kept per case with AsyncLocalStorage.

/** Tuesday morning: the morning dose is taken, the cardiologist is tomorrow at 10:30. */
export const DEFAULT_NOW = '2026-10-13T10:15';

export interface ApiExchange {
  request: Record<string, any> | null;
  /** Parsed JSON body; null for a non-JSON body. */
  response: Record<string, any> | null;
  status: number;
  ms: number;
}

export const recorder = new AsyncLocalStorage<ApiExchange[]>();

const realFetch = globalThis.fetch;

/** The app's client for the eval: same retries as production, every attempt recorded. */
export function recordingClient(): Anthropic {
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const started = Date.now();
    const res = await realFetch(input, init);
    const log = recorder.getStore();
    if (log) {
      let response: Record<string, any> | null = null;
      try {
        response = (await res.clone().json()) as Record<string, any>;
      } catch {
        response = null;
      }
      log.push({ request: typeof init?.body === 'string' ? JSON.parse(init.body) : null, response, status: res.status, ms: Date.now() - started });
    }
    return res;
  };
  return new Anthropic({ fetch });
}

/** A client that answers every request with "Dobrze." and no tool call: the null baseline. */
export function nullClient(model: string): Anthropic {
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    const body = {
      id: `msg_null_${Math.random().toString(36).slice(2)}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: 'Dobrze.' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    };
    recorder.getStore()?.push({ request: typeof init?.body === 'string' ? JSON.parse(init.body) : null, response: body, status: 200, ms: 0 });
    return Response.json(body);
  };
  return new Anthropic({ apiKey: 'null-baseline', fetch, maxRetries: 0 });
}

// Open-Meteo answers for the household: cloudy today, rain likely tomorrow, good air.
const forecast = {
  current: { temperature_2m: 11.4, weather_code: 3 },
  daily: {
    time: ['2026-10-13', '2026-10-14'],
    weather_code: [3, 61],
    temperature_2m_max: [13.2, 10.1],
    temperature_2m_min: [6.1, 5.2],
    precipitation_probability_max: [15, 75],
    wind_speed_10m_max: [14, 22],
  },
};
const air = { current: { european_aqi: 38, pm2_5: 9.1, pm10: 15.2 } };

/** Serves the weather from the fixture above; every other request goes to the network. */
export function pinWeather(): void {
  process.env.WEATHER = 'on';
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('https://api.open-meteo.com/')) return Response.json(forecast);
    if (url.startsWith('https://air-quality-api.open-meteo.com/')) return Response.json(air);
    return realFetch(input, init);
  };
}
