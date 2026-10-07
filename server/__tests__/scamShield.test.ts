import { describe, expect, it } from 'vitest';
import { screenMessage } from '../ai/scamHeuristics';
import { smsPresets } from '../seed';

describe('local scam screening', () => {
  it.each(smsPresets)('classifies the "$id" demo SMS as $expected', (preset) => {
    const result = screenMessage(preset.text, preset.sender);
    if (preset.expected === 'scam') expect(result.verdict).toBe('scam');
    else expect(result.verdict).toBe('safe');
  });

  it('names the pattern', () => {
    const byId = Object.fromEntries(smsPresets.map((p) => [p.id, screenMessage(p.text, p.sender).category]));
    expect(byId).toMatchObject({ bank: 'bank_impersonation', parcel: 'parcel_fee', grandchild: 'family_emergency', energy: 'utility_disconnection' });
  });

  it('works on text with Polish diacritics too', () => {
    const r = screenMessage('Twoje konto zostanie zablokowane dziś. Potwierdź dane logowania: https://bank-weryfikacja.online', '+48 500 100 200');
    expect(r.verdict).toBe('scam');
  });

  it('does not flag an ordinary message from family', () => {
    expect(screenMessage('Mamo, będę jutro koło 17, kupię chleb.', '+48 600 100 200').verdict).toBe('safe');
  });
});
