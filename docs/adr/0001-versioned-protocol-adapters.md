# 1. Versioned protocol adapters

- Date: 2026-08-26
- Status: Accepted

## Context

The predecessor tool (`openfun/bbb-stress-test`) hardcoded BigBlueButton internals
throughout its codebase and drove the Meteor-era HTML5 client by spawning browser tabs.
BBB 3.0 removed Meteor/MongoDB entirely and replaced them with `bbb-graphql-server`
(Hasura), `bbb-graphql-middleware`, `bbb-graphql-actions` and PostgreSQL. Every assumption
in that tool became false in a single release, and nobody could cheaply repair it — the tool
rotted and died. BBB will keep changing (3.1, 4.0), so any tool that couples orchestration
logic to BBB internals inherits the same fate.

## Decision

All knowledge of BBB internals lives behind versioned adapters under
`packages/protocol/src/adapters/vNN/`, reached only through the `BbbAdapter` interface.
Core orchestration, metrics, bots and CLI MUST NOT import an adapter directory directly.
The adapter is selected at runtime (`--bbb-version` or auto-detection). A BBB-specific string
constant (GraphQL query, header, endpoint, cookie name) appearing outside `adapters/` is a bug.

Every adapter method has a contract test against recorded fixtures in
`packages/protocol/fixtures/vNN/`, and protocol facts are captured from a live server
(never guessed) and documented in `docs/protocol-v30.md`.

## Consequences

- Supporting a new BBB version is a new adapter directory plus fixtures, not a rewrite.
- The join handshake, GraphQL lifecycle, subscriptions and mutation payloads are all
  centralized in `adapters/v30/` (`operations.ts`, `signaling.ts`, `config.ts`).
- A thin layer of indirection is paid on every protocol call; this is deliberate and cheap.
- The rule is enforced by review and by keeping the `BbbAdapter` interface the only import
  surface the rest of the monorepo sees.
