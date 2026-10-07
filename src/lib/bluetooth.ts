// A band or a cuff straight from her phone, with no account and no cloud: Web Bluetooth
// (Chrome and Edge on Android and desktop; not Safari) and the standard GATT services that
// most bands (Polar, Garmin in broadcast mode, Amazfit, Xiaomi with the setting on), many
// cuffs (Omron, Beurer, A&D) and Bluetooth thermometers implement: Heart Rate 0x180D, Blood
// Pressure 0x1810 and Health Thermometer 0x1809.

interface GattCharacteristic extends EventTarget {
  value: DataView | null;
  startNotifications(): Promise<GattCharacteristic>;
}
interface GattService {
  getCharacteristic(name: string): Promise<GattCharacteristic>;
}
interface GattServer {
  connected: boolean;
  connect(): Promise<GattServer>;
  disconnect(): void;
  getPrimaryService(name: string): Promise<GattService>;
}
interface BluetoothDevice extends EventTarget {
  name?: string;
  gatt?: GattServer;
}
interface Bluetooth {
  requestDevice(options: { filters: { services: string[] }[]; optionalServices?: string[] }): Promise<BluetoothDevice>;
}

const bluetooth = typeof navigator !== 'undefined' ? (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth : undefined;

export const bluetoothSupported = Boolean(bluetooth) && typeof window !== 'undefined' && window.isSecureContext;

/** Heart Rate Measurement: flag bit 0 says whether the value is 8 or 16 bits. */
export function parseHeartRate(view: DataView): number {
  return view.getUint8(0) & 0x01 ? view.getUint16(1, true) : view.getUint8(1);
}

/** IEEE-11073 16-bit float: 12-bit signed mantissa, 4-bit signed exponent. */
export function sfloat(raw: number): number {
  if (raw === 0x07ff || raw === 0x0800 || raw === 0x07fe || raw === 0x0802 || raw === 0x0801) return Number.NaN;
  let mantissa = raw & 0x0fff;
  let exponent = raw >> 12;
  if (mantissa >= 0x0800) mantissa -= 0x1000;
  if (exponent >= 0x8) exponent -= 0x10;
  return mantissa * 10 ** exponent;
}

/** Blood Pressure Measurement: systolic, diastolic, mean arterial; then optional time stamp and pulse. */
export function parseBloodPressure(view: DataView): { sys: number; dia: number; pulse: number | null } {
  const flags = view.getUint8(0);
  const kpa = flags & 0x01;
  const toMmHg = (v: number) => Math.round(kpa ? v * 7.50062 : v);
  const sys = toMmHg(sfloat(view.getUint16(1, true)));
  const dia = toMmHg(sfloat(view.getUint16(3, true)));
  let offset = 7;
  if (flags & 0x02) offset += 7;
  const pulse = flags & 0x04 && view.byteLength >= offset + 2 ? Math.round(sfloat(view.getUint16(offset, true))) : null;
  return { sys, dia, pulse: pulse !== null && Number.isFinite(pulse) ? pulse : null };
}

/** IEEE-11073 32-bit FLOAT: 24-bit signed mantissa, 8-bit signed exponent. */
export function float32(view: DataView, offset: number): number {
  const raw = view.getUint32(offset, true);
  let mantissa = raw & 0xffffff;
  if (mantissa === 0x7fffff || mantissa === 0x800000 || mantissa === 0x7ffffe) return Number.NaN;
  if (mantissa >= 0x800000) mantissa -= 0x1000000;
  const exponent = view.getInt8(offset + 3);
  return mantissa * 10 ** exponent;
}

/** Temperature Measurement: flag bit 0 says Fahrenheit; the value follows the flags. Always °C out. */
export function parseTemperature(view: DataView): number {
  const value = float32(view, 1);
  const celsius = view.getUint8(0) & 0x01 ? ((value - 32) * 5) / 9 : value;
  return Math.round(celsius * 10) / 10;
}

export interface BandHandlers {
  onPulse: (bpm: number) => void;
  onPressure: (reading: { sys: number; dia: number; pulse: number | null }) => void;
  onTemperature: (celsius: number) => void;
  onDisconnect: () => void;
}

/** Asks the browser to pick a device (it shows its own list), then subscribes to what it offers. */
export async function connectBand(handlers: BandHandlers): Promise<{ name: string; kinds: ('pulse' | 'pressure' | 'temperature')[]; disconnect: () => void }> {
  if (!bluetooth) throw new Error('Ta przeglądarka nie obsługuje Bluetooth. Proszę użyć Chrome na telefonie z Androidem.');
  const device = await bluetooth.requestDevice({
    filters: [{ services: ['heart_rate'] }, { services: ['blood_pressure'] }, { services: ['health_thermometer'] }],
    optionalServices: ['heart_rate', 'blood_pressure', 'health_thermometer'],
  });
  const server = await device.gatt!.connect();
  const kinds: ('pulse' | 'pressure' | 'temperature')[] = [];
  try {
    const hr = await (await server.getPrimaryService('heart_rate')).getCharacteristic('heart_rate_measurement');
    hr.addEventListener('characteristicvaluechanged', () => hr.value && handlers.onPulse(parseHeartRate(hr.value)));
    await hr.startNotifications();
    kinds.push('pulse');
  } catch {
    // Not a heart-rate device.
  }
  try {
    const bp = await (await server.getPrimaryService('blood_pressure')).getCharacteristic('blood_pressure_measurement');
    bp.addEventListener('characteristicvaluechanged', () => bp.value && handlers.onPressure(parseBloodPressure(bp.value)));
    await bp.startNotifications();
    kinds.push('pressure');
  } catch {
    // Not a cuff.
  }
  try {
    // Thermometers send the reading once, as an indication, when the measurement is done.
    const th = await (await server.getPrimaryService('health_thermometer')).getCharacteristic('temperature_measurement');
    th.addEventListener('characteristicvaluechanged', () => {
      if (!th.value) return;
      const c = parseTemperature(th.value);
      if (Number.isFinite(c)) handlers.onTemperature(c);
    });
    await th.startNotifications();
    kinds.push('temperature');
  } catch {
    // Not a thermometer.
  }
  if (!kinds.length) {
    server.disconnect();
    throw new Error('To urządzenie nie udostępnia tętna, ciśnienia ani temperatury.');
  }
  device.addEventListener('gattserverdisconnected', handlers.onDisconnect);
  return { name: device.name ?? 'Urządzenie Bluetooth', kinds, disconnect: () => server.disconnect() };
}
