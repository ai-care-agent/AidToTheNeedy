import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoCallState } from '../../shared/types';
import { postJson } from './api';
import { chime } from './media';
import { onServerEvent } from './serverEvents';

// One-tap video between the two apps. The server only relays offers, answers and ICE
// candidates; the public STUN server helps across home routers (no TURN in the POC).

type Side = 'senior' | 'family';

export type VideoPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'live' | 'ended';

type VideoEvent =
  | { type: 'ring'; call: VideoCallState }
  | { type: 'accepted'; call: VideoCallState }
  | { type: 'ended'; callId: string; by: Side; reason: 'declined' | 'hangup' | 'cancelled' | 'missed' }
  | { type: 'signal'; callId: string; from: Side; data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } };

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export const videoSupported = typeof window !== 'undefined' && typeof RTCPeerConnection !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

export function useVideoCall(me: Side) {
  const other: Side = me === 'senior' ? 'family' : 'senior';
  const [phase, setPhase] = useState<VideoPhase>('idle');
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [endReason, setEndReason] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const call = useRef<VideoCallState | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const media = useRef<MediaStream | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const ringer = useRef<number | undefined>(undefined);

  const stopRinging = () => window.clearInterval(ringer.current);
  const startRinging = () => {
    stopRinging();
    chime('alert');
    ringer.current = window.setInterval(() => chime('alert'), 2_500);
  };

  const cleanup = useCallback(() => {
    stopRinging();
    pc.current?.close();
    pc.current = null;
    media.current?.getTracks().forEach((t) => t.stop());
    media.current = null;
    pendingIce.current = [];
    setLocal(null);
    setRemote(null);
    setMuted(false);
  }, []);

  const signal = (data: object) => {
    if (call.current) void postJson(`/api/video/${call.current.id}/signal`, { from: me, data }).catch(() => {});
  };

  async function openMedia() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: { echoCancellation: true, noiseSuppression: true } });
    media.current = stream;
    setLocal(stream);
    return stream;
  }

  function makePeer(stream: MediaStream) {
    const peer = new RTCPeerConnection(ICE);
    pc.current = peer;
    stream.getTracks().forEach((t) => peer.addTrack(t, stream));
    peer.ontrack = (e) => setRemote(e.streams[0] ?? new MediaStream([e.track]));
    peer.onicecandidate = (e) => e.candidate && signal({ candidate: e.candidate.toJSON() });
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') setPhase('live');
      if (peer.connectionState === 'failed') hangUp();
    };
    return peer;
  }

  async function flushIce() {
    for (const c of pendingIce.current.splice(0)) await pc.current?.addIceCandidate(c).catch(() => {});
  }

  useEffect(() => {
    return onServerEvent('video', (raw) => {
      const e = raw as VideoEvent;
      if (e.type === 'ring') {
        if (e.call.from === other && !call.current) {
          call.current = e.call;
          setEndReason(null);
          setPhase('incoming');
          startRinging();
        }
        return;
      }
      if (!call.current) return;
      if (e.type === 'accepted' && e.call.id === call.current.id && call.current.from === me) {
        // The other side has its camera open: the caller sends the offer now.
        setPhase('connecting');
        void (async () => {
          const peer = makePeer(media.current ?? (await openMedia()));
          await peer.setLocalDescription(await peer.createOffer());
          signal({ sdp: peer.localDescription!.toJSON() });
        })();
      }
      if (e.type === 'signal' && e.callId === call.current.id && e.from === other) {
        void (async () => {
          if (e.data.sdp) {
            if (e.data.sdp.type === 'offer') {
              const peer = pc.current ?? makePeer(media.current ?? (await openMedia()));
              await peer.setRemoteDescription(e.data.sdp);
              await flushIce();
              await peer.setLocalDescription(await peer.createAnswer());
              signal({ sdp: peer.localDescription!.toJSON() });
            } else {
              await pc.current?.setRemoteDescription(e.data.sdp);
              await flushIce();
            }
          } else if (e.data.candidate) {
            if (pc.current?.remoteDescription) await pc.current.addIceCandidate(e.data.candidate).catch(() => {});
            else pendingIce.current.push(e.data.candidate);
          }
        })();
      }
      if (e.type === 'ended' && e.callId === call.current.id) {
        call.current = null;
        cleanup();
        setEndReason(e.reason === 'missed' ? 'missed' : e.by === me ? null : e.reason);
        setPhase('ended');
        window.setTimeout(() => setPhase((p) => (p === 'ended' ? 'idle' : p)), 4_000);
      }
    });
  }, [me, other, cleanup]);

  useEffect(() => cleanup, [cleanup]);

  /** Picks up a call that was already ringing before this page loaded (the event was missed). */
  const adopt = useCallback((state: VideoCallState | null) => {
    if (!state || call.current || state.status !== 'ringing' || state.from !== other) return;
    call.current = state;
    setPhase('incoming');
    startRinging();
  }, [other]);

  async function start() {
    if (call.current) return;
    setEndReason(null);
    setPhase('outgoing');
    try {
      await openMedia();
    } catch {
      setEndReason('no_camera');
      setPhase('ended');
      return;
    }
    call.current = await postJson<VideoCallState>('/api/video/start', { from: me });
  }

  async function accept() {
    if (!call.current) return;
    stopRinging();
    setPhase('connecting');
    try {
      await openMedia();
    } catch {
      setEndReason('no_camera');
    }
    await postJson(`/api/video/${call.current.id}/accept`);
  }

  function end(reason: 'declined' | 'hangup' | 'cancelled') {
    const current = call.current;
    call.current = null;
    cleanup();
    setPhase('idle');
    if (current) void postJson(`/api/video/${current.id}/end`, { by: me, reason }).catch(() => {});
  }

  function hangUp() {
    end(phase === 'outgoing' ? 'cancelled' : 'hangup');
  }

  function toggleMute() {
    const track = media.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }

  return { phase, local, remote, endReason, muted, start, accept, adopt, decline: () => end('declined'), hangUp, toggleMute };
}
