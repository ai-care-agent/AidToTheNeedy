import type { GeoPoint } from '../../shared/types';

// Fall detection with the phone's accelerometer, while the app is open: a hard impact
// followed by stillness. It is a heads-up, not a medical device — she can always cancel.

const IMPACT_G = 2.6;
const STILL_WINDOW_MS = 1_500;
const COOLDOWN_MS = 60_000;

export const motionSupported = typeof window !== 'undefined' && 'DeviceMotionEvent' in window;

/** iOS asks for permission, and only inside a tap. */
export async function requestMotionPermission(): Promise<void> {
  const ctor = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
  try {
    await ctor?.requestPermission?.();
  } catch {
    // Declined: detection simply stays off.
  }
}

export function watchForFalls(onFall: () => void): () => void {
  if (!motionSupported) return () => {};
  let impactAt = 0;
  let stillSince = 0;
  let lastAlarm = 0;
  const handler = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const g = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) / 9.81;
    const now = Date.now();
    if (g > IMPACT_G) {
      impactAt = now;
      stillSince = 0;
      return;
    }
    if (!impactAt || now - impactAt > 6_000) return;
    if (Math.abs(g - 1) < 0.2) {
      stillSince ||= now;
      if (now - stillSince >= STILL_WINDOW_MS && now - lastAlarm > COOLDOWN_MS) {
        lastAlarm = now;
        impactAt = 0;
        onFall();
      }
    } else {
      stillSince = 0;
    }
  };
  window.addEventListener('devicemotion', handler);
  return () => window.removeEventListener('devicemotion', handler);
}

/** Best effort within a few seconds; null when denied, unavailable or too slow. */
export function currentLocation(timeoutMs = 5_000): Promise<GeoPoint | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        window.clearTimeout(timer);
        resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) });
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

export function mapLink(geo: GeoPoint): string {
  return `https://www.openstreetmap.org/?mlat=${geo.lat.toFixed(5)}&mlon=${geo.lon.toFixed(5)}#map=17/${geo.lat.toFixed(5)}/${geo.lon.toFixed(5)}`;
}
