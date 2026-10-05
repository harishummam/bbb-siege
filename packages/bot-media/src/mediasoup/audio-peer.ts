import { randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { IceFailedError, TimeoutError } from '@bbb-siege/api-client';
import { Audio, cleanup, PeerConnection, type IceServer as NdcIceServer, type Track } from 'node-datachannel';
import { RtpReceiveStats, type RtpReceiveSnapshot } from './rtp-stats.js';

const OPUS_PAYLOAD_TYPE = 111;
const OPUS_CLOCK_RATE = 48_000;

export interface AudioPeerOptions {
  iceServers: (string | NdcIceServer)[];
  label?: string;
  answerTimeoutMs?: number;
}

export interface PeerEvents {
  createdAt: number;
  iceConnectedAt?: number;
  connectedAt?: number;
}

export interface CandidatePairInfo {
  local: string;
  remote: string;
  turnRelayUsed: boolean;
}

export interface AudioPeer {
  answer(offerSdp: string): Promise<string>;
  readonly connected: Promise<void>;
  readonly events: PeerEvents;
  stats(): RtpReceiveSnapshot;
  candidatePair(): CandidatePairInfo | undefined;
  close(): void;
}

export type AudioPeerFactory = (options: AudioPeerOptions) => AudioPeer;

export class NdcAudioPeer implements AudioPeer {
  readonly connected: Promise<void>;
  readonly events: PeerEvents = { createdAt: performance.now() };
  private readonly pc: PeerConnection;
  private readonly track: Track;
  private readonly rtp = new RtpReceiveStats(OPUS_CLOCK_RATE);
  private readonly answerTimeoutMs: number;
  private closed = false;

  constructor(options: AudioPeerOptions) {
    this.answerTimeoutMs = options.answerTimeoutMs ?? 5000;
    this.pc = new PeerConnection(options.label ?? 'bbb-siege-audio', { iceServers: options.iceServers });

    // The SFU silently ignores a sendrecv answer without an a=ssrc line (DTLS never starts),
    // so the track is created up front with an SSRC instead of letting the offer auto-create it.
    const audio = new Audio('0', 'SendRecv');
    audio.addOpusCodec(OPUS_PAYLOAD_TYPE);
    audio.addSSRC(randomInt(1, 0xffffffff), 'bbb-siege', 'bbb-siege-stream', 'bbb-siege-audio');
    this.track = this.pc.addTrack(audio);
    this.track.onMessage((packet) => this.rtp.onPacket(packet));

    this.connected = new Promise<void>((resolve, reject) => {
      this.pc.onIceStateChange((state) => {
        if ((state === 'connected' || state === 'completed') && this.events.iceConnectedAt === undefined) {
          this.events.iceConnectedAt = performance.now();
        }
      });
      this.pc.onStateChange((state) => {
        if (state === 'connected') {
          this.events.connectedAt ??= performance.now();
          resolve();
        } else if (state === 'failed') {
          reject(new IceFailedError('peer connection failed (ICE/DTLS)', { iceState: this.pc.iceState() }));
        } else if (state === 'closed' && !this.closed) {
          reject(new IceFailedError('peer connection closed before connecting'));
        }
      });
    });
    this.connected.catch(() => undefined);
  }

  answer(offerSdp: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new TimeoutError(`local SDP answer not produced within ${this.answerTimeoutMs}ms`)),
        this.answerTimeoutMs
      );
      this.pc.onLocalDescription((sdp, type) => {
        if (type !== 'answer') return;
        clearTimeout(timer);
        resolve(sdp);
      });
      try {
        this.pc.setRemoteDescription(offerSdp, 'offer');
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  stats(): RtpReceiveSnapshot {
    return this.rtp.snapshot();
  }

  candidatePair(): CandidatePairInfo | undefined {
    const pair = this.pc.getSelectedCandidatePair();
    if (!pair) return undefined;
    return {
      local: pair.local.type,
      remote: pair.remote.type,
      turnRelayUsed: pair.local.type === 'relay' || pair.remote.type === 'relay',
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.track.close();
    } catch {
      // track may already be closed by the peer connection
    }
    this.pc.close();
  }
}

export const createNdcAudioPeer: AudioPeerFactory = (options) => new NdcAudioPeer(options);

export function shutdownMediaTransport(): void {
  cleanup();
}
