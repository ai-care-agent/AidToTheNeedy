import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { MedicineProposal } from '../../shared/types';
import { config } from '../env';
import { aiStatus, describeError, fallbackParams, getClient } from './client';

// "Apteczka": a photo of a box or a pharmacy label becomes a proposal she confirms. The model
// transcribes what is printed; it never suggests a dose or judges the medicine.

const Read = z.object({
  is_medicine_package: z.boolean().describe('true tylko dla opakowania leku, suplementu albo etykiety z apteki'),
  name: z.string().describe('Nazwa leku tak, jak na opakowaniu'),
  strength: z.string().describe('Moc, np. „5 mg” albo „2000 j.m.”; pusty tekst, jeśli nie widać'),
  form: z.string().describe('Postać, np. „tabletki”, „kapsułki”; pusty tekst, jeśli nie widać'),
  dosing_as_printed: z.string().describe('Dawkowanie dokładnie tak, jak jest napisane na opakowaniu lub etykiecie; pusty tekst, jeśli go nie ma'),
  times_per_day: z.number().int().describe('Ile razy dziennie według napisu; 0, jeśli dawkowania nie ma na zdjęciu'),
  when: z.enum(['morning', 'midday', 'evening', 'morning_evening', 'three_times', 'unspecified']).describe('Pora dnia według napisu'),
  dose_units: z.number().describe('Ile sztuk na jedną dawkę według napisu; 1, jeśli nie podano'),
  pack_size: z.number().int().describe('Liczba sztuk w opakowaniu; 0, jeśli nie widać'),
  caution: z.string().describe('Jedno krótkie zdanie po polsku, jeśli coś jest nieczytelne albo niejasne; pusty tekst, gdy wszystko jasne'),
});

const SYSTEM = `Odczytujesz zdjęcie opakowania leku, suplementu albo etykiety z apteki, żeby seniorka mogła dodać go do swojej apteczki w aplikacji.
Przepisz wyłącznie to, co jest napisane. Nie zgaduj dawkowania, nie proponuj dawek i nie oceniaj, czy lek jest właściwy — dawkowanie ustala lekarz. Jeśli dawkowania nie ma na zdjęciu, zostaw je puste i ustaw times_per_day na 0.
Jeśli to nie jest opakowanie leku, ustaw is_medicine_package na false.`;

/** Default hours for "rano / wieczorem / 2 razy dziennie" — she and the family can change them later. */
function timesFor(timesPerDay: number, when: z.infer<typeof Read>['when']): string[] {
  if (timesPerDay <= 0) return [];
  if (timesPerDay >= 3 || when === 'three_times') return ['08:00', '13:00', '19:00'];
  if (timesPerDay === 2 || when === 'morning_evening') return ['08:00', '20:00'];
  if (when === 'evening') return ['20:00'];
  if (when === 'midday') return ['13:00'];
  return ['08:00'];
}

export class ScanUnavailable extends Error {}

export async function scanMedicine(image: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string }): Promise<MedicineProposal | null> {
  if (!aiStatus().configured) throw new ScanUnavailable('Rozpoznawanie zdjęć wymaga klucza AI (ANTHROPIC_API_KEY).');
  try {
    const response = await getClient().beta.messages.parse({
      model: config.model,
      max_tokens: 4000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
            { type: 'text', text: 'Co jest napisane na tym opakowaniu?' },
          ],
        },
      ],
      output_config: { ...(config.scamEffort ? { effort: config.scamEffort } : {}), format: betaZodOutputFormat(Read) },
      ...fallbackParams(),
    });
    const out = response.parsed_output;
    if (response.stop_reason === 'refusal' || !out || !out.is_medicine_package || !out.name.trim()) return null;
    return {
      name: out.name.trim(),
      strength: out.strength.trim() || null,
      form: out.form.trim() || null,
      instructions: out.dosing_as_printed.trim() || null,
      times: timesFor(out.times_per_day, out.when),
      doseUnits: out.dose_units > 0 ? out.dose_units : 1,
      packSize: out.pack_size > 0 ? out.pack_size : null,
      caution: out.caution.trim() || null,
    };
  } catch (err) {
    console.error('[medicine-scan] model call failed:', describeError(err));
    throw new ScanUnavailable('Nie udało się odczytać zdjęcia. Proszę spróbować jeszcze raz.');
  }
}
