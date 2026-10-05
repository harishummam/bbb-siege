import { describe, expect, it } from 'vitest';
import { isRtcp, RtpReceiveStats } from './rtp-stats.js';

function rtp(seq: number, timestamp: number, ssrc = 0x1234, payloadType = 111, payloadBytes = 60): Buffer {
  const packet = Buffer.alloc(12 + payloadBytes);
  packet[0] = 0x80;
  packet[1] = payloadType;
  packet.writeUInt16BE(seq & 0xffff, 2);
  packet.writeUInt32BE(timestamp >>> 0, 4);
  packet.writeUInt32BE(ssrc, 8);
  return packet;
}

function rtcp(packetType = 200): Buffer {
  const packet = Buffer.alloc(28);
  packet[0] = 0x80;
  packet[1] = packetType;
  return packet;
}

function clock(): { now: () => number; advance(ms: number): void } {
  let t = 1000;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe('RtpReceiveStats', () => {
  it('counts packets, bytes, payload types and first arrival', () => {
    const c = clock();
    const stats = new RtpReceiveStats(48_000, c.now);
    for (let i = 0; i < 5; i++) {
      stats.onPacket(rtp(100 + i, i * 960));
      c.advance(20);
    }
    const snap = stats.snapshot();
    expect(snap).toMatchObject({ packets: 5, bytes: 5 * 72, lost: 0, ssrcs: 1, payloadTypes: [111], firstPacketAt: 1000 });
  });

  it('separates RTCP from RTP', () => {
    const stats = new RtpReceiveStats(48_000);
    stats.onPacket(rtcp(200));
    stats.onPacket(rtcp(201));
    stats.onPacket(rtp(1, 0));
    expect(isRtcp(rtcp(203))).toBe(true);
    expect(isRtcp(rtp(1, 0))).toBe(false);
    expect(stats.snapshot()).toMatchObject({ packets: 1, rtcpPackets: 2 });
  });

  it('derives loss from sequence gaps, across a sequence wraparound', () => {
    const stats = new RtpReceiveStats(48_000);
    for (const seq of [65533, 65534, 65535, 1, 2, 5]) stats.onPacket(rtp(seq, 0));
    expect(stats.snapshot().lost).toBe(3);
  });

  it('ignores reordered packets when tracking the highest sequence', () => {
    const stats = new RtpReceiveStats(48_000);
    for (const seq of [10, 12, 11, 13]) stats.onPacket(rtp(seq, 0));
    expect(stats.snapshot().lost).toBe(0);
  });

  it('reports near-zero jitter for perfectly paced packets and positive jitter for uneven arrival', () => {
    const c = clock();
    const paced = new RtpReceiveStats(48_000, c.now);
    for (let i = 0; i < 50; i++) {
      paced.onPacket(rtp(i, i * 960));
      c.advance(20);
    }
    expect(paced.snapshot().jitterMs).toBe(0);

    const uneven = new RtpReceiveStats(48_000, c.now);
    for (let i = 0; i < 50; i++) {
      uneven.onPacket(rtp(i, i * 960));
      c.advance(i % 2 ? 5 : 35);
    }
    expect(uneven.snapshot().jitterMs).toBeGreaterThan(5);
  });
});
