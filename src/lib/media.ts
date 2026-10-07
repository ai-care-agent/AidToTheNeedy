import { flashIfWanted } from './a11y';

export interface EncodedImage {
  mediaType: 'image/jpeg';
  data: string;
  previewUrl: string;
}

/** Downscales a photo (phones produce 12 MP) to a JPEG the model can still read small print on. */
export async function encodeImage(source: Blob, maxEdge = 2000): Promise<EncodedImage> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const previewUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { mediaType: 'image/jpeg', data: previewUrl.slice(previewUrl.indexOf(',') + 1), previewUrl };
}

// ---------------------------------------------------------------- notification sounds

let audio: AudioContext | null = null;

/** Must run inside a user gesture once; browsers keep audio locked until then. */
export function unlockAudio(): void {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') void audio.resume();
}

export function chime(kind: 'gentle' | 'alert' = 'gentle'): void {
  flashIfWanted();
  if (!audio) return;
  const notes = kind === 'alert' ? [880, 660, 880, 660] : [587, 880];
  const start = audio.currentTime + 0.05;
  notes.forEach((frequency, i) => {
    const t = start + i * 0.22;
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 0.55);
  });
}
