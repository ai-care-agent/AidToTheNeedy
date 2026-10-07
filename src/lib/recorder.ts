// Voice messages: recorded in the browser (Opus in WebM on Chrome, AAC in MP4 on Safari).

export const recordingSupported =
  typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * A live transcript alongside the recording. Off on phones: there the speech recognizer can
 * take the microphone away from the recorder and leave a silent clip.
 */
export const transcribeWhileRecording = typeof navigator !== 'undefined' && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export interface VoiceClip {
  blob: Blob;
  mimeType: string;
  seconds: number;
  url: string;
}

export interface Recording {
  stop: () => Promise<VoiceClip>;
  cancel: () => void;
}

const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mimeType = PREFERRED.find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const startedAt = performance.now();
  recorder.start(250);
  const release = () => stream.getTracks().forEach((t) => t.stop());

  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          release();
          const type = recorder.mimeType || mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type });
          resolve({ blob, mimeType: type, seconds: (performance.now() - startedAt) / 1000, url: URL.createObjectURL(blob) });
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = release;
      if (recorder.state === 'inactive') release();
      else recorder.stop();
    },
  };
}

export async function clipPayload(clip: VoiceClip, transcript: string) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(clip.blob);
  });
  return {
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
    mimeType: clip.mimeType,
    seconds: Math.max(0.5, Math.round(clip.seconds * 10) / 10),
    transcript: transcript.trim() || undefined,
  };
}

export function fmtSeconds(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
