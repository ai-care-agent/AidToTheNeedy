import { addDays, hhmm, startOfDay, withTime } from './time';

// Stand-ins for the B2B2C partners (a local shop, a taxi company). Prices and ETAs are
// plausible fixed values: the POC shows the consent flow, not a real checkout.

export const GROCERY_PARTNER = 'Sklep Osiedlowy (partner demo)';
export const TAXI_PARTNER = 'Taxi Lublin (partner demo)';
export const DELIVERY_FEE = 9.99;

const PRICES: [string, number][] = [
  ['chleb', 4.99],
  ['bułk', 3.6],
  ['mleko', 3.49],
  ['masło', 7.49],
  ['jajka', 11.99],
  ['ser', 8.99],
  ['jogurt', 2.49],
  ['kefir', 3.29],
  ['śmietan', 3.49],
  ['jabłk', 5.99],
  ['banan', 6.49],
  ['pomidor', 9.99],
  ['ziemniak', 6.98],
  ['cebul', 2.99],
  ['marchew', 3.49],
  ['herbat', 8.99],
  ['kaw', 18.99],
  ['cukier', 4.29],
  ['mąk', 3.99],
  ['wod', 11.94],
  ['sok', 5.99],
  ['kurczak', 18.99],
  ['szynk', 7.99],
  ['ryż', 4.99],
  ['makaron', 4.49],
  ['płatki', 7.99],
  ['miód', 19.99],
  ['karma', 14.99],
];

export function groceryPrice(item: string): number {
  const name = item.toLowerCase();
  return PRICES.find(([key]) => name.includes(key))?.[1] ?? 6.99;
}

export interface Quote {
  lines: { name: string; price: number }[];
  total: number;
  /** When the delivery window opens or the taxi comes; the day word is computed when shown. */
  windowStart: Date;
  windowLabel: string;
}

export function groceryQuote(items: string[], now: Date): Quote {
  const lines = [...items.map((name) => ({ name, price: groceryPrice(name) })), { name: 'Dostawa', price: DELIVERY_FEE }];
  const total = Math.round(lines.reduce((sum, l) => sum + l.price, 0) * 100) / 100;
  // Morning orders arrive the same afternoon, later ones the next morning.
  const sameDay = now.getHours() < 11;
  const windowStart = withTime(sameDay ? now : addDays(startOfDay(now), 1), sameDay ? '16:00' : '10:00')!;
  return { lines, total, windowStart, windowLabel: sameDay ? '16:00–18:00' : '10:00–12:00' };
}

export function taxiQuote(pickupAt: Date): Quote {
  return { lines: [{ name: 'Przejazd (szacunkowo)', price: 32 }], total: 32, windowStart: pickupAt, windowLabel: `o ${hhmm(pickupAt)}` };
}

export const PHARMACY_PARTNER = 'Apteka Zdrowie (partner demo)';

/** One pack, delivered with the next grocery-style window; the pharmacist checks prescriptions on delivery. */
export function pharmacyQuote(medicine: { name: string; strength: string | null; packSize: number | null }, now: Date): Quote {
  const window = groceryQuote([], now);
  const name = `${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ''}, ${medicine.packSize ?? 30} szt.`;
  return { ...window, lines: [{ name, price: 24.99 }], total: 24.99 };
}

export function orderReference(kind: 'groceries' | 'taxi' | 'pharmacy'): string {
  return `${{ groceries: 'SO', taxi: 'TX', pharmacy: 'AP' }[kind]}-${Math.floor(10_000 + Math.random() * 90_000)}`;
}
