# 6. Native Tier 2 media over node-datachannel, without mediasoup-client

- Date: 2026-10-05
- Status: Accepted

## Context

Tier 2 media bots must put real WebRTC media on a BBB server at 100–300 bots per node, with no
browser. The stack table originally paired `mediasoup-client` with `node-datachannel` for
mediasoup-backed servers, assuming the SFU spoke mediasoup's own signaling (router RTP
capabilities, transport parameters, produce/consume calls) and needed a mediasoup client
handler to drive it.

A live capture of BBB 3.0's `bbb-webrtc-sfu` traffic (`docs/protocol-v30.md` §6, fixture
`packages/protocol/fixtures/v30/sfu-signaling.json`) showed something different. Clients
exchange **plain SDP offers/answers** in JSON frames (`start`, `startResponse`,
`subscriberAnswer`, `playStart`, `stop`) over `wss://<host>/bbb-webrtc-sfu`. The server is
ICE-lite, there are no trickle-ICE messages, and no mediasoup-specific parameters ever reach
the client. Translating SDP into mediasoup calls happens on the server side.

## Decision

- **Drop `mediasoup-client`.** It solves a problem this protocol doesn't have, and would add a
  browser-oriented handler layer to maintain.
- **Use `node-datachannel` (libdatachannel bindings) as the native WebRTC stack** for the
  mediasoup path. It's the dependency the stack table already approved. It ships prebuilt
  binaries as per-platform optional packages, so nothing is compiled at install time.
  `pnpm-workspace.yaml` sets `allowBuilds: node-datachannel: false` so pnpm never tries the
  source build.
- SFU signaling lives in the protocol adapter (`openSfu`, `fetchIceServers`,
  `cameraStreamId` on `BbbAdapter`) and is independent of the WebRTC stack: flows take SDP
  callbacks. The WebRTC side lives in `packages/bot-media/src/mediasoup/`.
- The bot's audio track is **created up front with an explicit SSRC** before applying the
  server offer. Observed live: a `sendrecv` answer without an `a=ssrc` line is silently
  ignored by the SFU (ICE connects, DTLS never completes, no error frame), while the same
  answer with an SSRC reaches `webRTCAudioSuccess` in ~300 ms.
- RTP receive QoE (packets, loss from sequence gaps, RFC 3550 jitter, kbps) is computed from
  decrypted packets delivered by the track, since libdatachannel has no `getStats()`.

## Consequences

- Measured live on the test server: a native listen-only bot reaches media-flowing in ~320 ms
  (p95 355 ms across 20 concurrent bots) with zero loss. 20 bots used ~5 CPU-seconds over a
  24 s run and 120 MB RSS in one process, so receive-only audio bots are cheap enough for the
  per-node target.
- **Video publishing needs our own VP8 RTP packetization.** libdatachannel ships H264, H265
  and AV1 packetizers but not VP8, and the SFU only negotiates VP8. The plan is to encode
  fixtures once with ffmpeg and replay pre-encoded frames rather than encode per bot.
- libdatachannel keeps native threads alive. Processes that use media bots must call
  `shutdownMediaTransport()` on exit.
- If BBB ever moves media negotiation to mediasoup's native signaling, this adapter breaks
  visibly in its contract tests rather than silently, because the recorded frames are the test
  oracle. That is the failure mode the versioned-adapter design (ADR 0001) is meant to give us.
- Servers running LiveKit still use the planned `@livekit/rtc-node` transport. This ADR covers
  only the `bbb-webrtc-sfu` (mediasoup) path.
