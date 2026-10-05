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

> **Captured live 2026-10-05** on a mediasoup-backed 3.0.x server with two Chromium clients (publisher: microphone + webcam; viewer: listen-only + receives the webcam) via `tools/capture/capture-media.ts`. Sanitized recording: `packages/protocol/fixtures/v30/sfu-signaling.json`. A headless (non-browser) `ws` client was then confirmed to be accepted by the SFU (§6.2).

### 6.1 Media stack selection

The client picks the audio bridge from meeting config (`fullAudioBridge` / `listenOnlyBridge`: `bbb-webrtc-sfu` | `livekit` | `sip`). On a LiveKit server `user_current.livekit.livekitToken` is populated; on the captured server it is absent and all media goes through `bbb-webrtc-sfu` — FreeSWITCH/SIP.js is **not** used by the browser for audio.

### 6.2 SFU WebSocket

```
wss://<host>/bbb-webrtc-sfu?sessionToken=<sessionToken>
Cookie: JSESSIONID=<from join response>
```

- **The `JSESSIONID` cookie is mandatory.** Without it the upgrade fails with HTTP **401**; with it a headless `ws` client receives `startResponse: accepted` and a valid server SDP offer. Same rule as the `/graphql` socket (§4).
- One socket **per media session**: the audio session and each camera (publish or view) open their own socket.
- Application-level heartbeat: client sends `{"id":"ping"}`, server replies `{"id":"pong"}`, roughly every 15 s per socket.
- All messages are JSON objects discriminated by `id`.

### 6.3 ICE servers

Before opening media, the client fetches:

```
GET /bigbluebutton/api/stuns?sessionToken=<sessionToken>
→ { "stunServers": [{ "url": "stun:<coturn-host>" }],
    "turnServers": [{ "username": "<expiry>:<userId>", "password": "<hmac>", "url": "turn:<coturn-host>:5349?transport=tcp", "ttl": 86400 },
                    { ..., "url": "turns:<coturn-host>:5349?transport=tcp" }],
    "remoteIceCandidates": [] }
```

These become `RTCPeerConnection({ iceServers })` (`url` → `urls`, `password` → `credential`).

### 6.4 ICE behaviour

- The SFU is **ICE-lite**; every server SDP carries a single `a=candidate ... typ host` plus `a=end-of-candidates`.
- **There is no trickle-ICE message in either direction.** Client SDPs carry zero candidates; the client (ICE controlling) sends connectivity checks to the server candidate and the SFU learns the client address peer-reflexively.
- Server codecs offered/answered: **Opus** (48 kHz, `useinbandfec=1`, `maxaveragebitrate=30000`) for audio, **VP8** only for video (`b=AS:200`).

### 6.5 Audio (full audio and listen-only) — server offers

| # | Direction | Message |
| --- | --- | --- |
| 1 | C→S | `{"id":"start","type":"audio","role":"sendrecv","clientSessionNumber":1,"extension":null,"transparentListenOnly":true}` |
| 2 | S→C | `{"id":"startResponse","type":"audio","response":"accepted","sdpAnswer":"<SERVER OFFER>"}` |
| 3 | C→S | `{"id":"subscriberAnswer","type":"audio","role":"sendrecv","sdpOffer":"<CLIENT ANSWER>"}` |
| 4 | S→C | `{"id":"webRTCAudioSuccess","type":"audio","success":"MEDIA_FLOWING"}` |

- **The field names are inverted:** `startResponse.sdpAnswer` holds the server's *offer* (`a=setup:actpass`), and the client's *answer* (`a=setup:active`) is sent in `subscriberAnswer.sdpOffer`.
- Listen-only is identical with `role: "passive-sendrecv"`; the client answers without a send track.
- After `webRTCAudioSuccess` the client reports its input mode: `UserSetListenOnlyInput(listenOnlyInputDevice: false|true)`; the listen-only viewer additionally sent `UserSetMuted(userId, muted: true)`.
- The browser's preceding echo test is a **local loopback** (two in-page peer connections, `UpdateUserClientEchoTestRunningAt` mutation) and never touches the SFU — a native bot can skip it.

### 6.6 Camera publish — client offers

| # | Direction | Message |
| --- | --- | --- |
| 1 | C→S | `{"id":"start","type":"video","cameraId":"<cameraId>","role":"share","sdpOffer":"<CLIENT OFFER>","bitrate":200,"record":true}` |
| 2 | S→C | `{"id":"startResponse","type":"video","role":"share","cameraId":"<cameraId>","sdpAnswer":"<SERVER ANSWER>"}` |
| 3 | S→C | `{"id":"playStart","type":"video","role":"share","cameraId":"<cameraId>"}` |

After `playStart` the client announces the stream over GraphQL so other users see it:

```graphql
mutation CameraBroadcastStart($cameraId: String!, $contentType: String!) {
  cameraBroadcastStart(stream: $cameraId, contentType: $contentType)   # contentType: "camera"
}
```

`cameraId` format is `<userId>_<clientSessionUUID>_<deviceId>`, e.g. `w_abc123_be7a2c89-…_c4ab7d38…` — `clientSessionUUID` is the value sent as `X-ClientSessionUUID` in `connection_init` and `deviceId` is the browser media-device id (64 hex chars in Chromium). *(Format observed live; the construction `buildStreamName = getPrefix() + "_" + deviceId`, `getPrefix = userID + "_" + clientSessionUUID` was read from the 3.0 client bundle. Whether the server validates the prefix is unverified.)*

### 6.7 Camera view — server offers

Viewers discover streams through the `Patched_VideoStreams` subscription (`user_camera { streamId user { userId … } voice { … } }`), then per stream:

| # | Direction | Message |
| --- | --- | --- |
| 1 | C→S | `{"id":"start","type":"video","cameraId":"<streamId>","role":"viewer","sdpOffer":null,"bitrate":200,"record":true}` |
| 2 | S→C | `{"id":"startResponse","type":"video","role":"viewer","cameraId":"<streamId>","sdpAnswer":"<SERVER OFFER>"}` |
| 3 | C→S | `{"id":"subscriberAnswer","type":"video","role":"viewer","cameraId":"<streamId>","answer":"<CLIENT ANSWER>"}` |
| 4 | S→C | `{"id":"playStart","type":"video","role":"viewer","cameraId":"<streamId>"}` |

Note the client answer field is `answer` here, not `sdpOffer` as in audio.

### 6.8 Teardown

- Camera: publisher sends `CameraBroadcastStop(stream: $cameraId)` over GraphQL and `{"id":"stop","type":"video","cameraId":"<cameraId>","role":"share"}` on its SFU socket; each viewer sends `{"id":"stop","type":"video","cameraId":"<cameraId>","role":"viewer"}`.
- Audio: no explicit audio `stop` frame was observed — the client closed the socket on page close. *(Unverified whether one exists.)*

### 6.9 Not yet captured

Screen sharing, Firefox SFU frames (Chromium only so far), SFU error frames (`id: "error"`) and their codes, and behaviour when the SFU rejects a session under load.

> **Observed (live 2026-08-26):** Both Chromium and Firefox connect with clean audio (0 loss, ~30–47ms RTT) and the probe's selected candidate-pair is **not** a `relay` (`turnRelayUsed: false`). Per the operator, this server **does** run coturn (required because it sits behind a firewall) and Firefox support is deliberately configured in the BBB config. So `turnRelayUsed: false` means only that *this probe's network path reached the SFU directly / via STUN (srflx) and did not need to fall back to the TURN relay* — TURN is present and used only when a direct path fails (symmetric NAT, blocking firewalls). **Takeaway:** `turnRelayUsed` reports whether the relay was *used on a given path*, not whether TURN exists; it will flip to `true` from network positions that require relaying. Do not infer the media stack from it.
