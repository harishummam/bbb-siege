import { performance } from 'node:perf_hooks';

export interface RtpReceiveSnapshot {
  packets: number;
  bytes: number;
  lost: number;
  jitterMs: number;
  rtcpPackets: number;
  ssrcs: number;
  payloadTypes: number[];
  firstPacketAt?: number;
}

interface SourceState {
  baseSeq: number;
  maxSeq: number;
  cycles: number;
  received: number;
  lastTimestamp: number;
  lastArrivalMs: number;
  jitter: number;
}

const RTP_HEADER_BYTES = 12;
const SEQ_MOD = 0x10000;
const MAX_FORWARD_STEP = 0x8000;

export function isRtcp(packet: Uint8Array): boolean {
  return packet.length >= 2 && packet[1] >= 192 && packet[1] <= 223;
}

export class RtpReceiveStats {
  private readonly sources = new Map<number, SourceState>();
  private readonly payloadTypes = new Set<number>();
  private packets = 0;
  private bytes = 0;
  private rtcpPackets = 0;
  private firstPacketAt?: number;

  constructor(
    private readonly clockRate: number,
    private readonly now: () => number = () => performance.now()
  ) {}

  onPacket(packet: Buffer): void {
    if (isRtcp(packet)) {
      this.rtcpPackets++;
      return;
    }
    if (packet.length < RTP_HEADER_BYTES || packet[0] >> 6 !== 2) return;

    const arrivalMs = this.now();
    const seq = packet.readUInt16BE(2);
    const timestamp = packet.readUInt32BE(4);
    const ssrc = packet.readUInt32BE(8);

    this.packets++;
    this.bytes += packet.length;
    this.payloadTypes.add(packet[1] & 0x7f);
    this.firstPacketAt ??= arrivalMs;

    const source = this.sources.get(ssrc);
    if (!source) {
      this.sources.set(ssrc, {
        baseSeq: seq,
        maxSeq: seq,
        cycles: 0,
        received: 1,
        lastTimestamp: timestamp,
        lastArrivalMs: arrivalMs,
        jitter: 0,
      });
      return;
    }

    source.received++;
    const step = (seq - source.maxSeq + SEQ_MOD) % SEQ_MOD;
    if (step > 0 && step < MAX_FORWARD_STEP) {
      if (seq < source.maxSeq) source.cycles += SEQ_MOD;
      source.maxSeq = seq;
    }

    const timestampDelta = (timestamp - source.lastTimestamp) | 0;
    const arrivalDelta = ((arrivalMs - source.lastArrivalMs) / 1000) * this.clockRate;
    const transitDelta = Math.abs(arrivalDelta - timestampDelta);
    source.jitter += (transitDelta - source.jitter) / 16;
    source.lastTimestamp = timestamp;
    source.lastArrivalMs = arrivalMs;
  }

  snapshot(): RtpReceiveSnapshot {
    let lost = 0;
    let jitter = 0;
    for (const source of this.sources.values()) {
      const expected = source.cycles + source.maxSeq - source.baseSeq + 1;
      lost += Math.max(0, expected - source.received);
      jitter = Math.max(jitter, source.jitter);
    }
    return {
      packets: this.packets,
      bytes: this.bytes,
      lost,
      jitterMs: Math.round((jitter / this.clockRate) * 1000 * 10) / 10,
      rtcpPackets: this.rtcpPackets,
      ssrcs: this.sources.size,
      payloadTypes: [...this.payloadTypes],
      firstPacketAt: this.firstPacketAt,
    };
  }
}
