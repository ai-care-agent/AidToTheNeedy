// Sunrise and sunset for the household, for the "Automatycznie" screen theme (light while it is
// light outside). The standard sunrise equation, accurate to a minute or two at these latitudes;
// no network, no API key.

const RAD = Math.PI / 180;
const J1970 = 2440587.5;
const J2000 = 2451545;
const DAY_MS = 86_400_000;

const toJulian = (d: Date) => d.getTime() / DAY_MS + J1970;
const fromJulian = (j: number) => new Date((j - J1970) * DAY_MS);

/** Null when the sun doesn't rise or set that day (polar day or night). */
export function sunTimes(date: Date, lat: number, lon: number): { sunrise: Date | null; sunset: Date | null } {
  // Days since J2000 at local solar noon of that date.
  const n = Math.round(toJulian(date) - J2000 - 0.0009 + lon / 360);
  const jStar = J2000 + 0.0009 + n - lon / 360;
  const m = (357.5291 + 0.98560028 * (jStar - J2000)) % 360;
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
  const lambda = (m + c + 180 + 102.9372) % 360;
  const transit = jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const decl = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD));
  // −0.833°: refraction plus the sun's radius — the moment the top edge touches the horizon.
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) / (Math.cos(lat * RAD) * Math.cos(decl));
  if (cosW < -1 || cosW > 1) return { sunrise: null, sunset: null };
  const w = Math.acos(cosW) / RAD;
  return { sunrise: fromJulian(transit - w / 360), sunset: fromJulian(transit + w / 360) };
}
