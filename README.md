# bbb-siege

Load and stress testing harness for self-hosted BigBlueButton 3.x.

> **Disclaimer:** BigBlueButton and the BBB logo are trademarks of BigBlueButton Inc. This project is not an official BigBlueButton project and is not endorsed by or affiliated with BigBlueButton Inc.

## Overview

`bbb-siege` measures how many concurrent users a BigBlueButton server can hold before join latency, audio, or video degrades, and identifies which component breaks first.

## Architecture & Bot Tiers

- **Tier 1 — Signaling bots (`@bbb-siege/bot-headless`)**: High-density signaling and GraphQL WebSocket load generator.
- **Tier 2 — Media bots (`@bbb-siege/bot-media`)**: Native WebRTC media load generator (LiveKit & mediasoup).
- **Tier 3 — Browser bots (`@bbb-siege/bot-browser`)**: Playwright Chromium & Firefox probes measuring real QoE.

## Monorepo Layout

- `packages/api-client` — BBB Server REST API client.
- `packages/protocol` — Versioned protocol adapters for BigBlueButton internals.
- `packages/bot-headless` — Tier 1 signaling bot.
- `packages/bot-media` — Tier 2 media bot.
- `packages/bot-browser` — Tier 3 Playwright browser bot.
- `packages/orchestrator` — Scenario execution and worker fleet coordinator.
- `packages/metrics` — Prometheus metrics exporter and report generation.
- `packages/cli` — Single CLI entrypoint (`bbb-siege`).

## Requirements

- Node.js 22 LTS
- pnpm 9+

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

## License

[MIT](LICENSE)
