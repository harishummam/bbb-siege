# BigBlueButton 3.0.19 Protocol Reference (`v30`)

This document describes the exact, observed protocol handshake and signaling for BigBlueButton 3.0.19 captured during Milestone 0.

---

## 1. Overview & Architecture

BigBlueButton 3.0 removed Meteor and MongoDB, replacing them with a GraphQL architecture:
- **`bbb-web`**: Java/Scala backend handling public REST API (`/create`, `/join`).
- **`bbb-graphql-middleware`**: Go proxy handling WebSocket authentication, rate limiting, and subscription patch minimization (`wss://<host>/graphql`).
- **`bbb-graphql-server`**: Hasura engine executing GraphQL queries and subscription pushes.
- **`bbb-graphql-actions`**: Node.js service executing GraphQL mutations published via Redis.
- **`bbb-webrtc-sfu`**: SFU media transport router (mediasoup / LiveKit).

---

## 2. Phase 1: Public REST API Handshake

### 2.1 `/bigbluebutton/api/create`
- **Method**: `GET`
- **Params**: `meetingID`, `name`, `attendeePW`, `moderatorPW`, `record`, `checksum`.
- **Checksum Calculation**:
  $$\text{checksum} = \text{SHA-256}(\text{"create"} + \text{queryString} + \text{BBB\_SECRET})$$
  *(SHA-256 preferred; SHA-1 supported if negotiated)*.
- **Response**: XML containing `<returncode>SUCCESS</returncode>` and meeting details.

### 2.2 `/bigbluebutton/api/join`
- **Method**: `GET`
- **Params**: `fullName`, `meetingID`, `password`, `redirect` (`true` or `false`), `checksum`.
- **Checksum Calculation**:
  $$\text{checksum} = \text{SHA-256}(\text{"join"} + \text{queryString} + \text{BBB\_SECRET})$$
- **Behavior with `redirect=false`**: Returns XML containing:
  - `<session_token>`: Unique session token string.
  - `<auth_token>`: User authentication token.
  - `<url>`: HTML5 client join URL (`https://<host>/html5client/?sessionToken=<token>`).
  - **Also sets the `JSESSIONID` HTTP cookie** (`Set-Cookie: JSESSIONID=...; Path=/; Secure; HttpOnly`) — verified against a live test server, 2026-08-26.
- **Behavior with `redirect=true`**:
  - Sets `JSESSIONID` HTTP cookie (`Path=/; Secure; HttpOnly`).
  - Responds with `302 Found` redirecting to `https://<host>/html5client/?sessionToken=<token>`.

> [!IMPORTANT]
> **CORRECTED (verified 2026-08-26):** The `JSESSIONID` cookie from the join response is **mandatory** for the GraphQL WebSocket. It must be sent as a `Cookie: JSESSIONID=...` header on the `/graphql` upgrade request (see §4). Without it the middleware returns an `error` frame `{"messageId":"check_authorization_error"}` and closes with code `4403` — even when all `connection_init` headers are present. A non-browser client must capture `Set-Cookie` from the `redirect=false` join and replay it on the WebSocket upgrade.

> [!IMPORTANT]
> `sessionToken` values are **single-use per join session**. Reusing a consumed token on a second browser instance results in `401 Unauthorized`.

---

## 3. Phase 2: Client Config Discovery

When the HTML5 client loads `https://<host>/html5client/?sessionToken=<token>`:
1. The client makes a `GET` request to `/bigbluebutton/api` (or `/bigbluebutton/api/`) with request header **`Content-Type: application/json`**.
2. The server responds with JSON endpoints config:
```json
{
  "response": {
    "returncode": "SUCCESS",
    "version": "2.0",
    "apiVersion": "2.0",
    "bbbVersion": "",
    "graphqlWebsocketUrl": "wss://<host>/graphql",
    "graphqlApiUrl": "https://<host>/api/rest"
  }
}
```

> **CORRECTED (verified against a live test server, 2026-08-26):** The JSON response is only returned when the request carries `Content-Type: application/json`. Without it the same endpoint returns the classic XML `<response>` document, and a JSON parse fails with `Unexpected token '<'`. Also note `bbbVersion` is observed **empty** (`""`) on this server, so version detection cannot rely on it from this endpoint.

---

## 4. Phase 3: GraphQL WebSocket Connection (`graphql-transport-ws`)

The client opens a WebSocket connection to `graphqlWebsocketUrl`:
- **URL**: `wss://<host>/graphql`
- **Subprotocol**: `graphql-transport-ws`
- **Upgrade request header (mandatory)**: `Cookie: JSESSIONID=<value>` — the `JSESSIONID` set by the `join` response. Omitting it causes `check_authorization_error` / close `4403`. See §2.2.

### 4.1 Connection Init Frame
The client MUST send a `connection_init` message with mandatory headers in `payload.headers`:

```json
{
  "type": "connection_init",
  "payload": {
    "headers": {
      "X-Session-Token": "<sessionToken>",
      "X-ClientSessionUUID": "<uuid-v4>",
      "X-ClientType": "HTML5",
      "X-ClientIsMobile": "false"
    }
  }
}
```

#### Mandatory Headers Breakdown:
- `X-Session-Token`: The `sessionToken` received from `/join`.
- `X-ClientSessionUUID`: Unique client UUID (v4) generated for this browser session.
- `X-ClientType`: `"HTML5"`.
- `X-ClientIsMobile`: `"false"` or `"true"`.

*If any header is missing, `bbb-graphql-middleware` closes the connection with close code `4403` and returns JSON error: `{"message":"X-<HeaderName> header missing on init connection","messageId":"param_missing"}`.*

### 4.2 Connection Ack Frame
Upon successful validation, the server responds with:
```json
{
  "type": "connection_ack"
}
```

---

## 5. Phase 4: Subscriptions & JSON-Patch Pushes

### 5.1 Subscriptions (`subscribe` frame)
Client sends GraphQL subscriptions:
```json
{
  "id": "<subscription-uuid>",
  "type": "subscribe",
  "payload": {
    "operationName": "Patched_UserListSubscription",
    "query": "subscription Patched_UserListSubscription($offset: Int!, $limit: Int!) { ... }",
    "variables": { "offset": 0, "limit": 50 }
  }
}
```

### 5.2 Next Frames (`next` frame & JSON Patches)
Server sends updates via `type: "next"`:
- Initial response: full document containing entity arrays.
- Subsequent updates: JSON-patch delta objects containing `op`, `path`, `value` (e.g. `[{"op":"replace","path":"/0/layout/updatedAt","value":"..."}]`).

> **Observed (live 2026-08-26):** across a captured single-user session, all `next` frames carried a full `payload.data` document (standard `graphql-transport-ws` `ExecutionResult`); no JSON-patch delta frames were seen. `graphql-ws` consumes them natively.

### 5.3 Mutations (client → server)
Mutations are sent as `type: "subscribe"` frames (graphql-transport-ws) and each returns one `next` then `complete`. Confirmed payloads (captured 2026-08-26 via `tools/capture/capture-actions.ts`):

- **`UserJoin`** → `userJoinMeeting(authToken, clientType, clientIsMobile)` — registers presence; required after `connection_ack`.
- **`ChatSendMessage`** → `chatSendMessage(chatId, chatMessageInMarkdownFormat, replyToMessageId)`; public chat id is `MAIN-PUBLIC-GROUP-CHAT`.
- **`SetRaiseHand`** → `userSetRaiseHand(userId, raiseHand: Boolean)`.

---

## 6. Phase 5: WebRTC & SFU Media Negotiation

- Audio/video streams use WebRTC peer connections negotiated with `bbb-webrtc-sfu`.
- Chromium executes WebRTC offer/answer directly.
- Firefox non-compliance with ICE-lite falls back to TURN relay candidates provided by coturn.

> **Observed (live 2026-08-26):** Both Chromium and Firefox connect with clean audio (0 loss, ~30–47ms RTT) and the probe's selected candidate-pair is **not** a `relay` (`turnRelayUsed: false`). Per the operator, this server **does** run coturn (required because it sits behind a firewall) and Firefox support is deliberately configured in the BBB config. So `turnRelayUsed: false` means only that *this probe's network path reached the SFU directly / via STUN (srflx) and did not need to fall back to the TURN relay* — TURN is present and used only when a direct path fails (symmetric NAT, blocking firewalls). **Takeaway:** `turnRelayUsed` reports whether the relay was *used on a given path*, not whether TURN exists; it will flip to `true` from network positions that require relaying. Do not infer the media stack from it.
