# 3. Headless join: JSESSIONID replay and Content-Type config discovery

- Date: 2026-08-26
- Status: Accepted

## Context

Running the first real bot against a live 3.0.x server surfaced two
protocol requirements that are invisible from a browser, because a browser handles them
automatically. Both were found by the smoke run failing, not from documentation — the M0
capture doc had them wrong or unstated.

1. **Client config discovery** (`GET /bigbluebutton/api`) returns the JSON config carrying
   `graphqlWebsocketUrl` **only** when the request sends header `Content-Type: application/json`.
   Otherwise it returns the classic XML `<response>` document and a JSON parse fails.
2. **The GraphQL WebSocket requires the `JSESSIONID` cookie.** The `join` response
   (`redirect=false`) sets `Set-Cookie: JSESSIONID=…`; it must be replayed as a
   `Cookie: JSESSIONID=…` header on the `/graphql` upgrade, or `bbb-graphql-middleware`
   returns `{"messageId":"check_authorization_error"}` and closes with code `4403` — even when
   every `connection_init` header is present. A browser sends the cookie automatically; a
   non-browser client must capture and replay it.

## Decision

- `api-client` captures `Set-Cookie` on `join` and exposes the `JSESSIONID` pair as
  `JoinMeetingResponse.sessionCookie` (via an internal `capture` param threaded through the
  request path).
- `JoinContext.sessionCookie` carries it; `openV30Signaling` injects it as a `Cookie` header
  on the `ws` upgrade through a `webSocketImpl` subclass.
- `discoverClientConfig` sends `Content-Type: application/json` and guards the parse with a
  clear error if the body is not JSON.
- Both facts are recorded in `docs/protocol-v30.md` (§2.2, §3, §4) and the AGENTS.md §6 table,
  marked CONFIRMED with the verification date.

## Consequences

- Bots authenticate to the GraphQL layer exactly as the HTML5 client does, without a browser.
- The cookie capture stays inside `api-client`; the cookie replay stays inside the `v30`
  adapter — no BBB-specific constant leaks into core (see ADR 1).
- `bbbVersion` comes back empty on this server, so version detection can't rely on it from the
  config endpoint; adapters are selected explicitly for now.
- This is exactly the class of guessed-vs-verified protocol detail that killed the predecessor,
  so the rule stands: capture from a live session, never assume.
