# 2. Hand-rolled orchestrator, no load-testing framework

- Date: 2026-08-26
- Status: Accepted

## Context

M3 needed declarative scenarios, a ramp scheduler, concurrency control, graceful teardown,
and a metrics endpoint. Off-the-shelf options exist: k6, Locust, Gatling (load frameworks),
or Nest (app framework). Adopting one would bring a large dependency surface and its own
programming model, and none of them speak BBB's GraphQL join protocol — we would still write
all the protocol code ourselves and then bend it to fit the framework's runner.

AGENTS.md §4 requires an explicit decision record before adding any heavyweight framework.

## Decision

Build the orchestrator as a few hundred lines of async TypeScript, composing small pinned
libraries rather than a framework:

- `zod` + `yaml` — scenario schema, validation, and `${VAR}` / `${VAR:-default}` env
  interpolation (`scenario.ts`).
- A custom ramp scheduler (`ramp.ts`) that compiles `{at,users}` / `{hold}` steps into
  per-bot launch times (piecewise-linear), and `scenario-run.ts` / `fleet.ts` that drive
  bots over a shared `run-core.ts` (meeting create/teardown, per-bot run, report).
- `prom-client` for metrics, `commander` for the CLI.

## Consequences

- Full control over the ramp/concurrency model and teardown semantics (ending every created
  meeting is a hard requirement — a framework would hide that).
- Small, legible surface: the whole runner is readable in one sitting and unit-testable with
  fakes (no live server needed).
- We maintain the ramp and fleet logic ourselves. This is revisited only if build/runtime
  complexity clearly outgrows the hand-rolled approach; that revisit needs its own ADR.
- A Pion/Go ultra-density tier stays deferred (Phase 4) for the same "keep the surface small"
  reason.
