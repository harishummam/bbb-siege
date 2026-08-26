# bbb-siege

Load and stress testing harness for self-hosted BigBlueButton 3.x.

> **Disclaimer:** BigBlueButton and the BBB logo are trademarks of BigBlueButton Inc. This project is not an official BigBlueButton project and is not endorsed by or affiliated with BigBlueButton Inc.

## Overview

`bbb-siege` measures how many concurrent users a BigBlueButton server can hold before join latency, audio, or video degrades, and identifies which component breaks first. It simulates users at three levels of fidelity so a single machine can generate realistic load without running thousands of browsers.

## Architecture & Bot Tiers

- **Tier 1 — Signaling bots (`@bbb-siege/bot-headless`)** — ✅ implemented. High-density signaling and GraphQL WebSocket load generator: full join handshake, `connection_init`/`ack`, `UserJoin`, and the core subscriptions. No media.
- **Tier 2 — Media bots (`@bbb-siege/bot-media`)** — 🔜 planned. Native WebRTC media load generator (LiveKit & mediasoup).
- **Tier 3 — Browser bots (`@bbb-siege/bot-browser`)** — 🔜 planned. Playwright Chromium & Firefox probes measuring real QoE.

## Project status

| Milestone | Scope | State |
| --- | --- | --- |
| M0 | Protocol capture & `docs/protocol-v30.md` | ✅ done |
| M1 | `api-client` — REST lifecycle, checksum auth, guardrails | ✅ done |
| M2 | Tier 1 signaling bot; fleet of 100 from one process | ✅ core done |
| M3 | YAML scenarios, orchestrator, Prometheus metrics | ⏳ next |
| M4–M7 | Browser bots, media bots, distributed fleet, release | 🔜 planned |

The join/subscribe/leave lifecycle and the fleet runner are verified against a live BBB 3.0.x server. Chat / raise-hand behaviour mutations are pending a protocol re-capture.

## Monorepo Layout

- `packages/api-client` — BBB Server REST API client. ✅
- `packages/protocol` — Versioned protocol adapters (`v30`) for BigBlueButton internals. ✅
- `packages/bot-headless` — Tier 1 signaling bot. ✅
- `packages/orchestrator` — Fleet coordination, ramp scheduling, graceful teardown. ✅
- `packages/cli` — Runnable entrypoints (`smoke`, `fleet`). ✅
- `packages/bot-media` — Tier 2 media bot. 🔜
- `packages/bot-browser` — Tier 3 Playwright browser bot. 🔜
- `packages/metrics` — Prometheus metrics exporter and report generation. 🔜

## Requirements

- Node.js 22 LTS (BBB 3.0.7+ requires Node 22; parity is kept)
- pnpm 9+

## Quick start

```bash
pnpm install
pnpm build
```

Create a gitignored `.env` pointing at a **test** server:

```bash
BBB_URL=https://your-test-bbb.example.org
BBB_SECRET=your-shared-secret
BBB_TEST_HOSTS=your-test-bbb.example.org
```

> **Safety guardrail:** runs refuse any target host not listed in `BBB_TEST_HOSTS`. Only override with the `--i-understand` escape hatch (or `iUnderstand: true`) when you fully intend to point at that host. Never run this against a production server.

### Single-bot smoke test

Creates a throwaway meeting, runs one signaling bot through the full lifecycle, logs phase timings, then ends the meeting:

```bash
pnpm smoke
```

### Fleet run

Ramps `BOTS` signaling bots into `MEETINGS` meeting(s), reports p50/p95/p99 join latency, and ends every meeting it created (including on Ctrl-C):

```bash
pnpm fleet                                 # defaults: 10 bots, 1 meeting, 10s hold
BOTS=100 STAGGER_MS=50 pnpm fleet          # 100 bots ramped over ~5s
BOTS=100 MEETINGS=4 pnpm fleet             # spread across 4 meetings
pnpm fleet --verbose                       # per-bot lifecycle logs (or LOG_LEVEL=debug)
```

Environment knobs: `BOTS`, `MEETINGS`, `HOLD_MS`, `STAGGER_MS`, `LOG_LEVEL`.

## Development

```bash
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

Live integration tests are opt-in and require a reachable server. `pnpm test` does not read `.env`, so export the vars (or source `.env`) alongside the flag:

```bash
set -a; source .env; set +a
BBB_INTEGRATION_TEST=true pnpm test
```

## License

[MIT](LICENSE)
