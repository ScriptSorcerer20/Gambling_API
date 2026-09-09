# HTTP and WebSocket protocol

`swagger.json` describes HTTP request and response bodies. Run `npm run docs` to regenerate it from the same command schemas used by both transports. `npm run check` fails when generated contracts are stale. The running documentation is available at `/swagger-ui`.

`docs/websocket.schema.json` is JSON Schema draft 2020-12: its root validates incoming messages; `$defs` describes every outgoing message. Runtime request validation lives in the dependency-free `public/protocol.js`, shared by server and browser.

## Authentication

Register/login with JSON `{ "username": "alice", "password": "..." }`. The response contains `{username, token}` and sets a 30-minute HttpOnly/SameSite=Strict cookie. Cookies are Secure when Express recognizes the request as HTTPS under the configured trusted proxy rules. Bearer clients use `Authorization: Bearer <token>`.

WebSockets connect at `/` on the same host. Browser upgrades must send the expected Origin. Non-browser upgrades may omit Origin only with a bearer header. Wait for `auth:success` before sending commands. Expired, replaced, and logged-out sessions close immediately with code 1008. Heartbeats remove dead peers. There are 200 total connections, 10 per direct peer IP, 30 messages/second/connection, eight queued commands/connection, and 16 KiB message/body limits. These limits are injectable application configuration; proxy-backed installations must account for the direct peer IP limit.

Authentication routes allow 20 attempts per direct/trusted-proxy client IP per 15 minutes, returning HTTP 429 plus Retry-After when exhausted. WebSocket over-limit messages close with 1008; excess upgrades return HTTP 429. Slow clients exceeding 256 KiB buffered output close with 1013.

## Mutating commands

All mutations use a unique `requestId` (8-128 letters, digits, hyphens, or underscores). Use a UUID. For HTTP, POST the fields below without `type` to the corresponding route. The old GET mutations return 405.

| Type | HTTP route | Other fields |
| --- | --- | --- |
| `lobby:create` | `/lobby/create` | optional boolean `private` |
| `lobby:join` | `/lobby/join` | `lobbyId` |
| `lobby:leave` | `/lobby/leave` | `lobbyId` |
| `poker:start` | `/poker/start` | `lobbyId` |
| `poker:action` | `/poker/action` | `lobbyId`, `action` (`hit`, `fold`, `bet`), `payload: {amount}` for bets |

Lobby IDs contain 16 lowercase hexadecimal characters. Unknown fields, malformed types, fractional bets, and missing fields are rejected. Failed business-rule validation does not consume a request ID. Committed commands retain their durable idempotency records. Retry an identical command using the same request ID after an uncertain response; reusing the ID with a different command returns `IDEMPOTENCY_CONFLICT`. A committed command replay returns its original acknowledgement and never repeats its effects, including after restart. Do not reuse an ID for a new intention.

The browser retries pending commands on reconnect with the same ID, using 0.5/1/2/4/5-second connection backoff. After five failed reconnects it asks for reload. It waits up to 30 seconds for an acknowledgement. On timeout, check restored state before creating a new command.

`poker:join` is a read/subscription message `{type, lobbyId}` without a request ID. It requires existing membership and never starts a game. Reconnecting automatically subscribes to the account's current lobby and sends a fresh snapshot.

## Server events

- `auth:success`: authenticated `username`.
- `command:ack`: `requestId`, `commandType`, `lobbyId`, `username`. HTTP returns the same fields with the command name in `type` instead.
- `lobby:state`: players, host, visibility, start eligibility, gameStarted, and gameUrl.
- `lobby:left`: lobbyId. All tabs belonging to the departing account are detached.
- `poker:state`: personalized hand, community cards, queue/turn, phase/street/round, stack/contribution, pot/table bet/call amount, minimumRaise/canRaise, deadlines, and completed-hand payouts/showdown. Opponents' private cards appear only at showdown. Full field definitions are in the schema.
- `error`: stable `code`, human-readable `message`, and `requestId` when available. HTTP uses `{code, error}`.

Error codes include `INVALID_MESSAGE`, `INVALID_JSON`, `INVALID_CREDENTIALS`, `UNAUTHORIZED`, `RATE_LIMITED`, `ORIGIN_DENIED`, `USERNAME_EXISTS`, `ALREADY_SEATED`, `HAND_PENDING`, `LOBBY_NOT_FOUND`, `LOBBY_FULL`, `NOT_SEATED`, `HOST_REQUIRED`, `GAME_STARTED`, `NOT_ENOUGH_PLAYERS`, `WRONG_PHASE`, `NOT_YOUR_TURN`, `INVALID_BET`, `MINIMUM_RAISE`, `RAISE_NOT_REOPENED`, `IDEMPOTENCY_CONFLICT`, and `INTERNAL_ERROR`. HTTP status codes are declared in OpenAPI. Storage failures never publish uncommitted state.
