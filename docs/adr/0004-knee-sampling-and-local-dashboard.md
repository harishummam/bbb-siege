# 4. Client-computed knee and locally-served dashboard

- Date: 2026-08-26
- Status: Accepted

## Context

The headline output of M3 is the "knee": the concurrent-user count where p95 join latency
crosses a configured SLO. We also wanted a live view of a run. Two design questions:

1. **How to compute the knee.** Prometheus histograms give p95 of join latency overall, but
   lose the correlation between a sample's latency and the concurrency present when that bot
   joined — which is exactly what the knee needs.
2. **How to show a live dashboard.** A published claude.ai Artifact runs under a CSP that
   blocks requests to `localhost`, so it cannot poll the metrics endpoint of a locally-running
   load test. A live view therefore cannot be an Artifact.

## Decision

- **Knee:** a `KneeSampler` records, per bot, `(activeBotsAtLaunch, joinLatencyMs)` where
  `joinLatencyMs = apiJoin + wsConnect + userJoin`. Samples are grouped into concurrency bands
  (default 25) and each band's p95 is computed; the knee is the first band whose p95 exceeds
  the SLO (`null` if none — the server held under SLO throughout). Concurrency-at-launch is a
  good proxy for concurrency-during-join because joins complete in ~100–400ms, far shorter than
  the ramp timescale.
- **Dashboard:** the metrics HTTP server serves the dashboard itself — `/` returns the HTML,
  `/metrics` stays the Prometheus scrape endpoint, `/logs` streams pino lines from an in-memory
  ring buffer. The page polls same-origin, builds its own in-browser time series, and freezes
  into a summary (parsed from the `RUN REPORT` log line) when the run completes; the server
  stays alive after the run so the summary is viewable until Ctrl-C.

## Consequences

- The knee is an approximation: concurrency is sampled at launch, and banding is coarse. This
  is appropriate for finding the degradation onset, not for exact SLA accounting.
- `/metrics` remains standard Prometheus, so a real Prometheus + Grafana can scrape a run for
  richer/off-box analysis; the built-in dashboard is the zero-setup local view.
- The dashboard is local-only by design — fine for an operator running the tool, and it avoids
  ever shipping live server data to a third-party page.
- Server-side metric scraping (per-mediasoup-worker CPU, FreeSWITCH channels, etc.) is out of
  scope here and deferred to a later `deploy/` + Grafana milestone.
