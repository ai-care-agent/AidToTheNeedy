import { household, profile } from './profile';

// Free Open-Meteo forecast and air quality (no API key). Air quality matters in Poland:
// winter smog is a real reason for a senior to skip a walk.

export interface DayForecast {
  date: string;
  min: number;
  max: number;
  description: string;
  rainChance: number | null;
  windMax: number | null;
}

export interface WeatherReport {
  city: string;
  now: { temp: number; description: string } | null;
  today: DayForecast;
  tomorrow: DayForecast | null;
  air: { aqi: number; level: string; pm25: number | null; pm10: number | null } | null;
}

const WMO: [number[], string][] = [
  [[0], 'bezchmurnie'],
  [[1], 'przeważnie słonecznie'],
  [[2], 'częściowe zachmurzenie'],
  [[3], 'pochmurno'],
  [[45, 48], 'mgła'],
  [[51, 53, 55], 'mżawka'],
  [[56, 57, 66, 67], 'marznący deszcz, może być ślisko'],
  [[61], 'słaby deszcz'],
  [[63], 'deszcz'],
  [[65], 'ulewny deszcz'],
  [[71, 77], 'słaby śnieg'],
  [[73], 'śnieg'],
  [[75], 'intensywne opady śniegu'],
  [[80, 81], 'przelotne opady deszczu'],
  [[82], 'gwałtowne ulewy'],
  [[85, 86], 'przelotne opady śniegu'],
  [[95], 'burza'],
  [[96, 99], 'burza z gradem'],
];

export function describeWeatherCode(code: number): string {
  return WMO.find(([codes]) => codes.includes(code))?.[1] ?? 'zmienna pogoda';
}

/** European AQI bands, named like the Polish GIOŚ index. */
export function airLevel(aqi: number): string {
  if (aqi < 20) return 'bardzo dobra';
  if (aqi < 40) return 'dobra';
  if (aqi < 60) return 'umiarkowana';
  if (aqi < 80) return 'dostateczna';
  if (aqi < 100) return 'zła';
  return 'bardzo zła';
}

const CACHE_MS = 30 * 60_000;
let cache: { at: number; report: WeatherReport } | null = null;

export async function getWeather(): Promise<WeatherReport | null> {
  if (process.env.WEATHER === 'off') return null;
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.report;
  const where = `latitude=${household.lat}&longitude=${household.lon}&timezone=Europe%2FWarsaw`;
  try {
    const [forecast, air] = await Promise.all([
      fetchJson(`https://api.open-meteo.com/v1/forecast?${where}&forecast_days=2&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max`),
      fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${where}&current=european_aqi,pm2_5,pm10`).catch(() => null),
    ]);
    const d = forecast.daily;
    const day = (i: number): DayForecast => ({
      date: d.time[i],
      min: Math.round(d.temperature_2m_min[i]),
      max: Math.round(d.temperature_2m_max[i]),
      description: describeWeatherCode(d.weather_code[i]),
      rainChance: d.precipitation_probability_max?.[i] ?? null,
      windMax: d.wind_speed_10m_max?.[i] ?? null,
    });
    const aqi = air?.current?.european_aqi;
    const report: WeatherReport = {
      city: profile.city,
      now: forecast.current ? { temp: Math.round(forecast.current.temperature_2m), description: describeWeatherCode(forecast.current.weather_code) } : null,
      today: day(0),
      tomorrow: d.time.length > 1 ? day(1) : null,
      air: typeof aqi === 'number' ? { aqi, level: airLevel(aqi), pm25: air.current.pm2_5 ?? null, pm10: air.current.pm10 ?? null } : null,
    };
    cache = { at: Date.now(), report };
    return report;
  } catch (err) {
    console.warn('[weather] unavailable:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(4_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** Spoken-style sentence with a practical tip, e.g. "…szansa deszczu 60 procent. Przyda się parasol." */
export function weatherSentence(r: WeatherReport, which: 'today' | 'tomorrow'): string | null {
  const f = which === 'today' ? r.today : r.tomorrow;
  if (!f) return null;
  const when = which === 'today' ? 'Dziś' : 'Jutro';
  const rain = f.rainChance !== null && f.rainChance >= 20 ? `, szansa opadów ${f.rainChance} procent` : '';
  const tips = [
    f.rainChance !== null && f.rainChance >= 50 ? 'Przyda się parasol.' : null,
    f.max <= 5 ? 'Proszę się ciepło ubrać.' : null,
    f.max >= 28 ? 'Proszę pić dużo wody.' : null,
    f.windMax !== null && f.windMax >= 40 ? 'Będzie wietrznie.' : null,
  ].filter(Boolean);
  return `${when} od ${f.min} do ${f.max} stopni, ${f.description}${rain}.${tips.length ? ` ${tips.join(' ')}` : ''}`;
}

export function airSentence(r: WeatherReport): string | null {
  if (!r.air) return null;
  const advice = r.air.aqi >= 80 ? ' Najlepiej zostać w domu i nie wietrzyć długo.' : r.air.aqi >= 60 ? ' Lepiej ograniczyć dłuższy spacer.' : '';
  return `Jakość powietrza: ${r.air.level}.${advice}`;
}
