import { randomUUID } from 'node:crypto';
import type { VideoCallState } from '../shared/types';
import { publishChange, publishEvent } from './events';

// One video call at a time between the senior and the family. The server only relays
// WebRTC offers, answers and ICE candidates over SSE; media flows browser to browser.

const RING_TIMEOUT_MS = 45_000;

type Side = 'senior' | 'family';
type EndReason = 'declined' | 'hangup' | 'cancelled' | 'missed';

let call: VideoCallState | null = null;
let ringTimer: NodeJS.Timeout | null = null;

export function currentVideoCall(): VideoCallState | null {
  return call && call.status !== 'ended' ? call : null;
}

export function startVideoCall(from: Side, onMissed: (c: VideoCallState) => void): VideoCallState {
  if (call && call.status !== 'ended') endVideoCall(call.id, from, 'cancelled');
  const started: VideoCallState = { id: randomUUID(), from, status: 'ringing', startedAt: new Date().toISOString(), acceptedAt: null };
  call = started;
  ringTimer = setTimeout(() => {
    if (call?.id === started.id && call.status === 'ringing') {
      endVideoCall(started.id, from, 'missed');
      onMissed(started);
    }
  }, RING_TIMEOUT_MS);
  publishEvent('video', { type: 'ring', call: started });
  publishChange();
  return started;
}

export function acceptVideoCall(id: string): VideoCallState | null {
  if (!call || call.id !== id || call.status !== 'ringing') return null;
  if (ringTimer) clearTimeout(ringTimer);
  call = { ...call, status: 'active', acceptedAt: new Date().toISOString() };
  publishEvent('video', { type: 'accepted', call });
  publishChange();
  return call;
}

/** Returns how long the call lasted (0 if it was never answered). */
export function endVideoCall(id: string, by: Side, reason: EndReason): { call: VideoCallState; seconds: number } | null {
  if (!call || call.id !== id || call.status === 'ended') return null;
  if (ringTimer) clearTimeout(ringTimer);
  const seconds = call.acceptedAt ? Math.round((Date.now() - Date.parse(call.acceptedAt)) / 1000) : 0;
  call = { ...call, status: 'ended' };
  publishEvent('video', { type: 'ended', callId: id, by, reason });
  publishChange();
  return { call, seconds };
}

export function relaySignal(id: string, from: Side, data: unknown): boolean {
  if (!call || call.id !== id || call.status === 'ended') return false;
  publishEvent('video', { type: 'signal', callId: id, from, data });
  return true;
}
