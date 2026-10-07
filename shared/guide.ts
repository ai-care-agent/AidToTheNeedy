// "Pokaż palcem": the places on her home screen the family (or the assistant) can point at.
// Each key is a `data-guide` attribute in the senior app; `spoken` is how the assistant names
// it ("proszę nacisnąć tutaj: …"); `label` is the family's button, `onScreen` what she reads.

export const GUIDE_TARGETS = [
  { key: 'mic', label: 'Mikrofon', spoken: 'duży okrągły przycisk — tu mówi się do asystentki' },
  { key: 'call', label: 'Zadzwoń do mnie', onScreen: 'Zadzwoń', spoken: 'zielony przycisk Zadzwoń' },
  { key: 'video', label: 'Wideo ze mną', onScreen: 'Wideo', spoken: 'przycisk Wideo' },
  { key: 'medicines', label: 'Moje leki', spoken: 'kafelek Moje leki' },
  { key: 'health', label: 'Moje zdrowie', spoken: 'kafelek Moje zdrowie' },
  { key: 'document', label: 'Przeczytaj pismo', spoken: 'kafelek Przeczytaj pismo' },
  { key: 'messages', label: 'Wiadomości', spoken: 'kafelek Wiadomości' },
  { key: 'doctor', label: 'Mój lekarz', spoken: 'kafelek Mój lekarz' },
  { key: 'magnifier', label: 'Lupa', spoken: 'kafelek Lupa' },
  { key: 'guard', label: 'Strażnik rozmowy', spoken: 'kafelek Strażnik rozmowy' },
  { key: 'record', label: 'Nagraj wiadomość', spoken: 'kafelek Nagraj wiadomość' },
  { key: 'sos', label: 'SOS', spoken: 'czerwony przycisk SOS — tylko gdy potrzebna jest pomoc' },
  { key: 'a11y', label: 'Aa — ułatwienia', onScreen: 'Aa', spoken: 'okrągły przycisk Aa na górze' },
  { key: 'plan', label: 'Plan na dziś', spoken: 'Plan na dziś' },
] as const;

export type GuideTarget = (typeof GUIDE_TARGETS)[number]['key'];

export const GUIDE_KEYS = GUIDE_TARGETS.map((t) => t.key) as [GuideTarget, ...GuideTarget[]];

export const guideTarget = (key: GuideTarget) => GUIDE_TARGETS.find((t) => t.key === key)!;

/** The name as it is written on her screen. */
export const onScreenName = (key: GuideTarget): string => {
  const t = guideTarget(key);
  return 'onScreen' in t ? t.onScreen : t.label;
};

/** Pushed to her phone; `from` is who is pointing (a family member, or null for the assistant). */
export interface GuideEvent {
  target: GuideTarget;
  from: string | null;
}
