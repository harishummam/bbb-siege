# 5. Tier 3 browser probes as an instrumented control group

- Date: 2026-08-26
- Status: Accepted

## Context

Signaling bots (Tier 1) stress the GraphQL backend but never touch media, so they can't
report what a real user *experiences* — audio quality, ICE success, TURN usage, join-to-media
latency. Real browsers can, but they are expensive (a full Chromium/Firefox process each), so
they cannot be the bulk load. BBB also treats Firefox as a first-class client with distinct
ICE/TURN behavior (§6), which must be measured, not assumed.

## Decision

Add a Tier 3 `BrowserBot` (Playwright, real Chromium/Firefox, fake media) used as a small
**instrumented control group**, not bulk load:

- It performs the real UI join (mic → join audio → share webcam), hooks every
  `RTCPeerConnection`, and reports ground-truth QoE from `getStats()`: RTT, audio jitter /
  packet loss / kbps, video frames / fps / freezes, and whether the selected candidate-pair
  used a **TURN relay** — all labelled by browser.
- Media phase timings are measured **event-to-event** from the first peer-connection
  creation (`t0`), not wall-clock, so UI-automation sleeps don't inflate them.
- In a scenario run, the probe count is derived from `mix.browser.weight` but **hard-capped**
  (`maxBrowserProbes`, default 3) because each probe is a real browser process; probes launch
  alongside the signaling ramp and hold for the whole run, measuring QoE *while the ramp
  applies load*. They can also run standalone via `pnpm probe`.

## Consequences

- QoE numbers are real and per-browser; `turnRelayUsed` reports whether the relay was used on
  a given network path (not whether TURN exists) — interpret per position, don't infer the
  media stack from it.
- Receiving-QoE (inbound video from other participants) is limited until Tier 2 (M5) supplies
  media publishers; a solo probe measures its own publish, audio from the mixer, ICE and RTT.
- Browser automation is inherently selector- and timing-sensitive; the join flow is driven by
  real `data-test` selectors captured live, with DOM-clicks to bypass BBB's hidden duplicate
  toolbar buttons, and is verified against a live server rather than assumed.
- The default cap keeps a `peak=300, 5%` scenario from spawning 15 browsers by surprise; raise
  it deliberately (`BROWSERS_MAX`, or `maxBrowserProbes`) on a node sized for it.
