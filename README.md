# Gambling API

Multiplayer virtual-chip poker with Express, WebSockets, SQLite, and a vanilla JavaScript frontend. Accounts start with 200 chips. See [the rules](docs/RULES.md) for the ante-based variant.

## Run locally

Use Node.js 24 or newer.

1. Run `npm ci`.
2. Copy `.env.example` to `.env` and generate a random `TOKEN_SECRET` using the command in that file.
3. Run `npm start` and visit <http://127.0.0.1:42069/login>.
4. Register two accounts in separate browser profiles. Create a lobby, join with the other account, and start as host.

The default listener is `127.0.0.1:42069`. Configure `HOST`, `PORT`, and `DATABASE_PATH` as needed. For HTTPS proxies, set `PUBLIC_ORIGIN` and explicitly configure `TRUST_PROXY`; see [operations](docs/ARCHITECTURE.md).

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the server |
| `npm run dev` | Restart on source changes |
| `npm test` | Syntax, contract freshness, unit/integration tests |
| `npm run test:e2e` | Chromium two-player, mobile, reconnect, and process-crash tests |
| `npm run docs` | Generate HTTP and WebSocket contracts |
| `npm run audit:deps` | Check known dependency vulnerabilities |
| `npm run migrate:legacy -- path/to/data.json` | Explicit transactional import; stop the server first |

Install Chromium before browser tests:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.playwright-browsers"
npx playwright install chromium
npm run test:e2e
```

On Linux/macOS: `PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright-browsers" npx playwright install chromium`. CI installs system dependencies as well. The test runner uses no child-process isolation for unit tests, while browser/crash tests require process-launch permission. Tests use isolated in-memory or temporary databases and leave real accounts untouched.

## Persistence and upgrades

Accepted commands atomically store account deltas, escrow/table state, a ledger, and an idempotency record. `/balance` and the leaderboard show current spendable chips. Interrupted hands are refunded exactly once at startup; lobbies are then cleared. One process may own a database at a time.

**Upgrading from the original version:** stop the server and back up the database/legacy JSON. Startup migrates the SQLite schema and makes an additional backup, preserves accounts and balances, and invalidates old sessions. Users must log in again. Legacy JSON imports are now explicit and never erase the source.

HTTP create/join/leave/start/action mutations now use POST and require a `requestId`. WebSocket mutation messages require the same ID and a lobbyId where relevant. External clients must update to [the new protocol](docs/PROTOCOL.md). Browser clients are updated.

## Documentation

- [AUDIT.md](AUDIT.md): completion map and validation evidence for all eight audit items.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module boundaries, transactions, migration, deployment, dependency policy.
- [docs/RULES.md](docs/RULES.md): betting, all-ins, timeout, departure, and recovery rules.
- [docs/PROTOCOL.md](docs/PROTOCOL.md): HTTP/WebSocket commands, errors, limits, and retry behavior.
- `/swagger-ui`: interactive HTTP documentation while the server is running.
