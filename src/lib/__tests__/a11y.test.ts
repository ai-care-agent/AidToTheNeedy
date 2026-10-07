import { describe, expect, it } from 'vitest';
import { DEFAULTS, getA11y, setA11y, stepSpeechRate, stepTextSize } from '../a11y';

describe('accessibility settings', () => {
  it('steps the text size and the voice within their ranges', () => {
    setA11y(DEFAULTS);
    expect(stepTextSize(1)).toBe('duży');
    expect(getA11y().scale).toBe(115);
    for (let i = 0; i < 6; i++) stepTextSize(1);
    expect(getA11y().scale).toBe(175);
    for (let i = 0; i < 6; i++) stepTextSize(-1);
    expect(getA11y().scale).toBe(100);

    expect(stepSpeechRate(-1)).toBe('wolniej');
    expect(stepSpeechRate(-1)).toBe('wolniej');
    expect(getA11y().speechRate).toBe(0.75);
  });
});

describe('settings saved before newer options existed', () => {
  it('read as the defaults for the missing fields, and changes are described in words', async () => {
    const { describeChange, sameSettings, withDefaults } = await import('../a11y');
    const old = { scale: 130, theme: 'light', bold: false, reducedMotion: false, speechRate: 0.95, tapToRead: false } as Parameters<typeof withDefaults>[0];
    expect(withDefaults(old)).toMatchObject({ scale: 130, steadyTouch: false, flashAlerts: false });
    expect(sameSettings(withDefaults(old), { ...DEFAULTS, scale: 130, theme: 'light' })).toBe(true);
    expect(describeChange(DEFAULTS, { ...DEFAULTS, scale: 175, theme: 'contrast', steadyTouch: true })).toEqual(['tekst: największy', 'kolory: wysoki kontrast', 'ochrona przed drżeniem rąk włączone']);
  });
});

describe('"Automatycznie"', () => {
  it('is light between sunrise and sunset, dark otherwise, and can preview the other half', async () => {
    const { isDaylight, previewAutoTheme, resolveTheme, setSunTimes } = await import('../a11y');
    // Before the apps pass the sun times: 7:00–19:00 household time.
    expect(resolveTheme('auto', new Date('2026-09-29T10:00:00+02:00'))).toBe('light');
    expect(resolveTheme('auto', new Date('2026-09-29T20:30:00+02:00'))).toBe('dark');

    setSunTimes({ sunrise: '2026-12-21T06:32:00Z', sunset: '2026-12-21T14:26:00Z' });
    expect(resolveTheme('auto', new Date('2026-12-21T16:00:00+01:00'))).toBe('dark'); // 16:00 in December is after sunset
    expect(resolveTheme('auto', new Date('2026-12-21T12:00:00+01:00'))).toBe('light');
    expect(resolveTheme('contrast', new Date('2026-12-21T23:00:00+01:00'))).toBe('contrast');

    // The demo's "Zachód słońca — podgląd": evening at noon, for two minutes, only for "auto".
    previewAutoTheme('dark');
    expect(resolveTheme('auto', new Date())).toBe('dark');
    expect(resolveTheme('light', new Date())).toBe('light');
    // Three minutes later the preview is over and the sun decides again.
    const later = new Date(Date.now() + 3 * 60_000);
    expect(resolveTheme('auto', later)).toBe(isDaylight(later) ? 'light' : 'dark');
    previewAutoTheme(null);
  });
});
