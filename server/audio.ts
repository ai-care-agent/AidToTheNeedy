import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from './env';

// Voice messages are small (a minute of Opus is ~0.5 MB) and stored as files next to the database.

const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
};

export const AUDIO_CONTENT_TYPES: Record<string, string> = Object.fromEntries(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type]));

export function isSupportedAudio(mimeType: string): boolean {
  return mimeType.split(';')[0].trim() in EXTENSIONS;
}

/** Returns the stored file name (never a path). */
export function saveAudio(base64: string, mimeType: string): string {
  const ext = EXTENSIONS[mimeType.split(';')[0].trim()];
  if (!ext) throw new Error(`unsupported audio type ${mimeType}`);
  mkdirSync(config.audioDir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  writeFileSync(join(config.audioDir, name), Buffer.from(base64, 'base64'));
  return name;
}

/** Only names we generated resolve to a file, so a request cannot reach outside the folder. */
export function audioFile(name: string): { path: string; contentType: string } | null {
  const m = /^[0-9a-f-]{36}\.(webm|ogg|m4a|mp3)$/.exec(name);
  if (!m) return null;
  const path = resolve(config.audioDir, name);
  return existsSync(path) ? { path, contentType: AUDIO_CONTENT_TYPES[m[1]] } : null;
}
