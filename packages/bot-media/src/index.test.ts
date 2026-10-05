import { IceFailedError, type BbbApiClient } from '@bbb-siege/api-client';
import type {
  BbbAdapter,
  JoinContext,
  MutationSpec,
  SfuAudioRequest,
  SfuConnection,
  SignalingSession,
  SubscriptionSpec,
} from '@bbb-siege/protocol';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { MediaBot, type AudioPeer, type AudioPeerOptions } from './index.js';

const silent = pino({ level: 'silent' });

const context: JoinContext = {
  meetingId: 'm1',
  userId: 'u1',
  sessionToken: 'tok',
  authToken: 'auth',
  clientSessionUUID: 'uuid',
  graphqlWebsocketUrl: 'ws://unused',
  joinUrl: 'https://example.test',
};

function fakeSession(userCurrent: unknown): SignalingSession {
  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => {
    resolveClosed = r;
  });
  return {
    closed,
    async *subscribe(spec: SubscriptionSpec): AsyncGenerator<unknown> {
      if (spec.operationName === 'Patched_userCurrentSubscription') yield { user_current: [userCurrent] };
    },
    mutate: vi.fn(async () => ({ userJoinMeeting: true })),
    async close(): Promise<void> {
      resolveClosed();
    },
  };
}

function fakeSfu(behaviour: (request: SfuAudioRequest) => Promise<void>): SfuConnection & { close: ReturnType<typeof vi.fn> } {
  return {
    closed: Promise.resolve(),
    startAudio: vi.fn(behaviour),
    startCameraShare: vi.fn(),
    startCameraView: vi.fn(),
    stopCamera: vi.fn(),
    close: vi.fn(async () => undefined),
  };
}

function fakeAdapter(session: SignalingSession, sfu: SfuConnection = fakeSfu(async () => undefined)): BbbAdapter {
  return {
    detectVersion: vi.fn(),
    detectMediaStack: vi.fn(),
    createMeeting: vi.fn(),
    join: vi.fn(async () => context),
    openSignaling: vi.fn(async () => session),
    leave: vi.fn(async (_c: JoinContext, s: SignalingSession) => s.close()),
    fetchIceServers: vi.fn(async () => [
      { urls: 'stun:coturn.example.com' },
      { urls: 'turn:coturn.example.com:5349?transport=tcp', username: '1:u1', credential: 'pw' },
    ]),
    openSfu: vi.fn(async () => sfu),
    cameraStreamId: vi.fn(),
  } as unknown as BbbAdapter;
}

interface FakePeer extends AudioPeer {
  options: AudioPeerOptions;
  offers: string[];
  close: ReturnType<typeof vi.fn>;
}

function fakePeerFactory(): { create: (options: AudioPeerOptions) => AudioPeer; peers: FakePeer[] } {
  const peers: FakePeer[] = [];
  return {
    peers,
    create: (options) => {
      const peer: FakePeer = {
        options,
        offers: [],
        connected: Promise.resolve(),
        events: { createdAt: 0, iceConnectedAt: 5 },
        answer: async (offer) => {
          peer.offers.push(offer);
          return 'v=0\r\nbot-answer';
        },
        stats: () => ({ packets: 250, bytes: 18_000, lost: 1, jitterMs: 2.5, rtcpPackets: 3, ssrcs: 1, payloadTypes: [111], firstPacketAt: 10 }),
        candidatePair: () => ({ local: 'prflx', remote: 'host', turnRelayUsed: false }),
        close: vi.fn(),
      };
      peers.push(peer);
      return peer;
    },
  };
}

const client = {} as BbbApiClient;
const join = { fullName: 'media-bot', meetingID: 'm1', password: 'mp' };

describe('MediaBot.detect', () => {
  it('detects LiveKit when a livekitToken is present', async () => {
    const bot = new MediaBot({ adapter: fakeAdapter(fakeSession({ livekit: { livekitToken: 'jwt-abc' } })), client, join, logger: silent });
    const result = await bot.detect();
    expect(result.stack).toBe('livekit');
    expect(result.livekitTokenPresent).toBe(true);
    expect(result.livekitToken).toBe('jwt-abc');
  });

  it('infers mediasoup when the record has no livekit token', async () => {
    const bot = new MediaBot({ adapter: fakeAdapter(fakeSession({ livekit: { livekitToken: null }, name: 'x' })), client, join, logger: silent });
    const result = await bot.detect();
    expect(result.stack).toBe('mediasoup');
    expect(result.livekitTokenPresent).toBe(false);
  });
});

describe('MediaBot.listen', () => {
  it('negotiates listen-only audio through the SFU and reports timings and RTP QoE', async () => {
    const session = fakeSession({});
    const sfu = fakeSfu(async (request) => {
      expect(request.listenOnly).toBe(true);
      expect(await request.answer('v=0\r\nserver-offer')).toBe('v=0\r\nbot-answer');
    });
    const adapter = fakeAdapter(session, sfu);
    const factory = fakePeerFactory();
    const bot = new MediaBot({ adapter, client, join, logger: silent, peerFactory: factory.create });

    const outcome = await bot.listen({ holdMs: 10 });

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') return;
    expect(outcome.audio).toMatchObject({ packets: 250, lost: 1, jitterMs: 2.5 });
    expect(outcome.candidatePair).toBe('prflx->host');
    expect(outcome.turnRelayUsed).toBe(false);
    expect(outcome.timings.joinMs).toBeGreaterThanOrEqual(0);
    expect(outcome.timings.mediaFlowingMs).toBeGreaterThanOrEqual(0);

    expect(factory.peers[0].offers).toEqual(['v=0\r\nserver-offer']);
    expect(factory.peers[0].options.iceServers).toEqual([
      'stun:coturn.example.com:3478',
      { hostname: 'coturn.example.com', port: 5349, username: '1:u1', password: 'pw', relayType: 'TurnTcp' },
    ]);
    const mutations = (session.mutate as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as MutationSpec).operationName);
    expect(mutations).toEqual(['UserJoin', 'UserSetListenOnlyInput']);
    expect(sfu.close).toHaveBeenCalled();
    expect(factory.peers[0].close).toHaveBeenCalled();
    expect(adapter.leave).toHaveBeenCalled();
  });

  it('returns a classified failure and still tears everything down', async () => {
    const session = fakeSession({});
    const sfu = fakeSfu(async () => {
      throw new IceFailedError('peer connection failed (ICE/DTLS)');
    });
    const adapter = fakeAdapter(session, sfu);
    const factory = fakePeerFactory();
    const bot = new MediaBot({ adapter, client, join, logger: silent, peerFactory: factory.create });

    const outcome = await bot.listen();

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.error).toBeInstanceOf(IceFailedError);
    expect(outcome.timings.joinMs).toBeGreaterThanOrEqual(0);
    expect(sfu.close).toHaveBeenCalled();
    expect(factory.peers[0].close).toHaveBeenCalled();
    expect(adapter.leave).toHaveBeenCalled();
  });
});
