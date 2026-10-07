import { describe, expect, it } from 'vitest';
import { float32, parseBloodPressure, parseHeartRate, parseTemperature, sfloat } from '../bluetooth';

const view = (...bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);
/** SFLOAT with exponent 0, little-endian. */
const sf = (n: number) => [n & 0xff, (n >> 8) & 0x0f];

describe('Bluetooth GATT frames', () => {
  it('reads 8- and 16-bit heart rate', () => {
    expect(parseHeartRate(view(0x00, 72))).toBe(72);
    expect(parseHeartRate(view(0x01, 0x2c, 0x01))).toBe(300);
  });

  it('decodes SFLOAT, including negative exponents and NaN', () => {
    expect(sfloat(0x0078)).toBe(120);
    expect(sfloat(0xf4d2)).toBeCloseTo(123.4); // mantissa 1234, exponent -1
    expect(sfloat(0x07ff)).toBeNaN();
  });

  it('reads a cuff measurement in mmHg with the optional pulse after a time stamp', () => {
    const flags = 0x02 | 0x04; // time stamp present, pulse present, mmHg
    const frame = view(flags, ...sf(142), ...sf(91), ...sf(108), 0xea, 0x07, 9, 29, 7, 30, 0, ...sf(76));
    expect(parseBloodPressure(frame)).toEqual({ sys: 142, dia: 91, pulse: 76 });
  });

  it('converts kPa and copes with a frame without pulse', () => {
    expect(parseBloodPressure(view(0x01, ...sf(19), ...sf(12), ...sf(15)))).toEqual({ sys: 143, dia: 90, pulse: null });
  });
});

describe('Bluetooth thermometer', () => {
  it('reads °C and converts °F', () => {
    // 378 × 10^-1 = 37.8 °C: mantissa 0x00017A, exponent 0xFF (−1).
    expect(parseTemperature(view(0x00, 0x7a, 0x01, 0x00, 0xff))).toBe(37.8);
    // 1004 × 10^-1 = 100.4 °F = 38.0 °C.
    expect(parseTemperature(view(0x01, 0xec, 0x03, 0x00, 0xff))).toBe(38);
    expect(Number.isNaN(float32(view(0x00, 0xff, 0xff, 0x7f, 0x00), 1))).toBe(true); // "not a number" reserved value
  });
});
