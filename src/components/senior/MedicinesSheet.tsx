import { Camera, Check, Clock, ImagePlus, LoaderCircle, Pill, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { Medicine, MedicineProposal } from '../../../shared/types';
import { encodeImage, type EncodedImage } from '../../lib/media';
import { IconBadge, Sheet } from '../ui';

const SAMPLE_BOX = '/samples/lek-witamina-d.png';

type Stage = { kind: 'list' } | { kind: 'reading'; preview: string } | { kind: 'proposal'; proposal: MedicineProposal; preview: string } | { kind: 'error'; message: string };

async function send<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string }).message ?? 'Coś poszło nie tak. Proszę spróbować jeszcze raz.');
  return data as T;
}

/** "Moje leki": her medicines with what is left, and a new one added from a photo of the box. */
export function MedicinesSheet({ medicines, onClose, onSay }: { medicines: Medicine[]; onClose: () => void; onSay: (text: string) => void }) {
  const [stage, setStage] = useState<Stage>({ kind: 'list' });

  async function read(image: EncodedImage) {
    setStage({ kind: 'reading', preview: image.previewUrl });
    try {
      const proposal = await send<MedicineProposal>('/api/senior/medicines/scan', { mediaType: image.mediaType, data: image.data });
      setStage({ kind: 'proposal', proposal, preview: image.previewUrl });
      onSay(`Na opakowaniu jest ${proposal.name}${proposal.strength ? ` ${proposal.strength}` : ''}. ${proposal.instructions ? `Dawkowanie: ${proposal.instructions}.` : 'Nie widzę dawkowania.'} Czy dodać do apteczki?`);
    } catch (err) {
      setStage({ kind: 'error', message: (err as Error).message });
    }
  }

  async function onPhoto(file: File | undefined) {
    if (file) await read(await encodeImage(file));
  }

  async function onSample() {
    await read(await encodeImage(await (await fetch(SAMPLE_BOX)).blob()));
  }

  async function add(p: MedicineProposal) {
    try {
      await send('/api/senior/medicines', { name: p.name, strength: p.strength, form: p.form, instructions: p.instructions, times: p.times, doseUnits: p.doseUnits, stock: p.packSize, packSize: p.packSize });
      onSay(`Dodałam ${p.name} do apteczki.${p.times.length ? ` Będę przypominać o ${p.times.join(' i o ')}.` : ''}`);
      setStage({ kind: 'list' });
    } catch (err) {
      setStage({ kind: 'error', message: (err as Error).message });
    }
  }

  return (
    <Sheet title="Moje leki" onClose={onClose} wide>
      {stage.kind === 'list' && (
        <>
          {medicines.length === 0 && <p className="text-xl text-muted">Apteczka jest pusta.</p>}
          <ul className="space-y-3">
            {medicines.map((m) => (
              <li key={m.id} className="flex gap-4 rounded-3xl bg-surface p-4 shadow-soft">
                <IconBadge icon={Pill} tone="teal" size={56} />
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-bold leading-tight">
                    {m.name} {m.strength}
                  </p>
                  {m.instructions && <p className="mt-1 text-xl text-muted">{m.instructions}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.times.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-tint-teal px-3 py-1 text-lg font-semibold">
                        <Clock size={18} /> {t}
                      </span>
                    ))}
                  </div>
                  {m.daysLeft !== null && (
                    <p className={`mt-2 text-lg font-semibold ${m.lowStock ? 'text-warn' : 'text-ok'}`}>
                      {m.lowStock ? 'Kończy się — ' : ''}zostało na {m.daysLeft} dni
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <label className="flex min-h-[4.5rem] cursor-pointer items-center justify-center gap-3 rounded-2xl bg-brand px-5 text-2xl font-bold text-on-accent shadow-sm hover:bg-brand-strong">
            <Camera size={30} /> Dodaj lek ze zdjęcia
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-h-16 cursor-pointer items-center justify-center gap-3 rounded-2xl bg-surface px-4 text-xl font-semibold ring-2 ring-line hover:ring-brand">
              <ImagePlus size={24} /> Zdjęcie z galerii
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => void onPhoto(e.target.files?.[0])} />
            </label>
            <button type="button" onClick={() => void onSample()} className="flex min-h-16 items-center justify-center gap-3 rounded-2xl bg-surface px-4 text-xl font-semibold ring-2 ring-line hover:ring-brand">
              <img src={SAMPLE_BOX} alt="" className="h-10 w-14 rounded object-cover" /> Przykład (demo)
            </button>
          </div>
          <p className="text-lg text-muted">Dawkowanie przepisuję z opakowania. O zmianach decyduje lekarz.</p>
        </>
      )}

      {stage.kind === 'reading' && (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <img src={stage.preview} alt="Zdjęcie opakowania" className="max-h-56 rounded-2xl object-contain shadow-soft" />
          <p className="flex items-center gap-3 text-2xl font-semibold">
            <LoaderCircle size={30} className="animate-spin" /> Czytam opakowanie…
          </p>
        </div>
      )}

      {stage.kind === 'proposal' && (
        <>
          <div className="flex gap-4 rounded-3xl bg-surface p-4 shadow-soft">
            <img src={stage.preview} alt="" className="h-28 w-24 shrink-0 rounded-xl object-cover" />
            <div className="min-w-0">
              <p className="text-2xl font-bold leading-tight">
                {stage.proposal.name} {stage.proposal.strength}
              </p>
              {stage.proposal.form && <p className="text-xl text-muted">{stage.proposal.form}</p>}
              <p className="mt-2 text-xl">
                <span className="text-muted">Na opakowaniu: </span>
                {stage.proposal.instructions ?? 'brak dawkowania'}
              </p>
            </div>
          </div>
          {stage.proposal.times.length > 0 ? (
            <p className="flex flex-wrap items-center gap-2 text-xl">
              Przypomnę o:
              {stage.proposal.times.map((t) => (
                <span key={t} className="rounded-full bg-tint-teal px-3 py-1 font-bold">
                  {t}
                </span>
              ))}
            </p>
          ) : (
            <p className="rounded-2xl bg-warn-soft p-3 text-xl text-warn">Nie ma dawkowania — przypomnienia ustali rodzina albo lekarz.</p>
          )}
          {stage.proposal.caution && (
            <p className="flex gap-2 rounded-2xl bg-warn-soft p-3 text-lg text-warn">
              <TriangleAlert size={22} className="mt-0.5 shrink-0" /> {stage.proposal.caution}
            </p>
          )}
          <button type="button" onClick={() => void add(stage.proposal)} className="flex min-h-[4.5rem] w-full items-center justify-center gap-3 rounded-2xl bg-ok text-2xl font-bold text-on-accent shadow-sm">
            <Check size={30} /> Dodaj do apteczki
          </button>
          <button type="button" onClick={() => setStage({ kind: 'list' })} className="min-h-16 w-full rounded-2xl bg-surface text-xl font-semibold ring-2 ring-line">
            Anuluj
          </button>
        </>
      )}

      {stage.kind === 'error' && (
        <>
          <p className="rounded-2xl bg-danger-soft p-4 text-xl text-danger">{stage.message}</p>
          <button type="button" onClick={() => setStage({ kind: 'list' })} className="min-h-16 w-full rounded-2xl bg-surface text-xl font-semibold ring-2 ring-line">
            Wróć
          </button>
        </>
      )}
    </Sheet>
  );
}
