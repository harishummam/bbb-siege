# bbb-siege

Load and stress testing harness for self-hosted BigBlueButton 3.x.

> **Disclaimer:** BigBlueButton and the BBB logo are trademarks of BigBlueButton Inc. This project is not an official BigBlueButton project and is not endorsed by or affiliated with BigBlueButton Inc.

## Overview

`bbb-siege` measures how many concurrent users a BigBlueButton server can hold before join latency, audio, or video degrades, and identifies which component breaks first. It simulates users at three levels of fidelity so a single machine can generate realistic load without running thousands of browsers.

## Architecture & Bot Tiers

- **Tier 1 — Signaling bots (`@bbb-siege/bot-headless`)** — ✅ implemented. High-density signaling and GraphQL WebSocket load generator: full join handshake, `connection_init`/`ack`, `UserJoin`, the core subscriptions, and behaviour mutations (chat, raise hand). No media.
- **Tier 2 — Media bots (`@bbb-siege/bot-media`)** — 🔜 planned. Native WebRTC media load generator (LiveKit & mediasoup).
- **Tier 3 — Browser bots (`@bbb-siege/bot-browser`)** — ✅ implemented. Playwright Chromium & Firefox probes measuring real QoE via `getStats()`; standalone (`pnpm probe`) or mixed into scenario runs.

## Project status

| Milestone | Scope | State |
| --- | --- | --- |
| M0 | Protocol capture & `docs/protocol-v30.md` | ✅ done |
| M1 | `api-client` — REST lifecycle, checksum auth, guardrails | ✅ done |
| M2 | Tier 1 signaling bot; fleet of 100 from one process | ✅ core done |
| M3 | YAML scenarios, ramp scheduler, Prometheus metrics + live dashboard, `run` CLI, the knee | ✅ done |
| M4 | Tier 3 browser bots (Playwright Chromium/Firefox, getStats QoE) | ✅ core done |
| M5–M7 | Media bots, distributed fleet, release | 🔜 planned |

The join/subscribe/leave lifecycle, chat and raise-hand behaviour, the fleet runner, and scenario-driven ramp runs (with the join-latency knee) are all verified against a live BBB 3.0.x server.

## Scenario runs

```bash
MAX_USERS=300 pnpm siege run scenarios/signaling-ramp.yaml
```

Ramps signaling load per a declarative YAML scenario, serves a live dashboard at `http://localhost:9095/` (Prometheus metrics at `/metrics`), and reports the **knee** — the concurrency where p95 join latency crosses the scenario SLO. See [scenarios/signaling-ramp.yaml](scenarios/signaling-ramp.yaml) for the format and [docs/adr/](docs/adr/) for the design decisions.

## Monorepo Layout

- `packages/api-client` — BBB Server REST API client. ✅
- `packages/protocol` — Versioned protocol adapters (`v30`) for BigBlueButton internals. ✅
- `packages/bot-headless` — Tier 1 signaling bot. ✅
- `packages/orchestrator` — Fleet coordination, ramp scheduling, graceful teardown. ✅
- `packages/cli` — Runnable entrypoints (`smoke`, `fleet`). ✅
- `packages/bot-media` — Tier 2 media bot. 🔜
- `packages/bot-browser` — Tier 3 Playwright browser bot + getStats QoE. ✅
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
BOTS=50 CHAT_PER_MIN=4 RAISE_HAND_PROB=0.1 pnpm fleet   # add chat + raise-hand load
pnpm fleet --verbose                       # per-bot lifecycle logs (or LOG_LEVEL=debug)
```

Environment knobs: `BOTS`, `MEETINGS`, `HOLD_MS`, `STAGGER_MS`, `CHAT_PER_MIN`, `RAISE_HAND_PROB`, `LOG_LEVEL`.

### Browser probe (Tier 3)

Run a single real browser that joins with mic + webcam and reports ground-truth QoE (ICE, RTT, jitter, packet loss, TURN usage) via `getStats()`:

```bash
pnpm probe                 # one headless Chromium probe
BROWSER=firefox pnpm probe # Firefox
```

Or fold a small browser-probe control group into a scenario run (probe count derived from `mix.browser`, capped at `BROWSERS_MAX`, default 3):

```bash
MAX_USERS=100 pnpm siege run scenarios/mixed-ramp.yaml
```

Their QoE appears in the run report, on `/metrics`, and in a dedicated panel on the live dashboard. Chromium probes publish **non-trivial motion+noise media** (generated once with `ffmpeg` into a temp dir) so their webcam/audio push realistic bandwidth rather than a near-empty test pattern; if `ffmpeg` isn't installed they fall back to the browser's built-in fake device.

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
