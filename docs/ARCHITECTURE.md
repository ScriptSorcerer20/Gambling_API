# Architecture and operations

`createApplication(options)` constructs an isolated application; importing `gambling.js` starts no listener or timers. Configuration, repository, clock, deck generation, bcrypt cost, and timing limits are injectable for deterministic tests.

| Module | Responsibility |
| --- | --- |
| `lib/repository.js` | SQLite schema migration, transactions, ledger, idempotency, interrupted-hand refunds |
| `lib/database-lock.js` | Enforce one process owner per database, recover locks after a crashed PID |
| `lib/sessions.js` | Password/session verification, hashed session storage, rotation/revocation events |
| `lib/lobbies.js` | Membership, command queues, staged state, timer scheduling, post-commit broadcasts |
| `lib/engine.js` | Synchronous poker transitions with injected clock and deck |
| `lib/poker.js` | Hand evaluation, shuffling, contribution-layer payouts |
| `lib/http.js` / `lib/transport.js` | HTTP / WebSocket validation, limits, subscription, personalized output |
| `public/protocol.js` / `public/client.js` | Shared request contracts and resilient browser connection |

Commands lock their lobby and account; membership mutations also share a membership queue. Session replacement and authorized actions share a session/account queue. SQLite operations share a database queue, so reads cannot see partial multi-statement transactions. Each command clones state, validates and calculates its complete result, and checks that account deltas plus the escrow delta sum to zero. A transaction persists all balance deltas, the ledger, lobby snapshot, and idempotency record. Only then is memory replaced and state broadcast.

Timers have hand IDs, deadlines, and lobby revisions. Stale timers are no-ops. Failed timer transactions retry with the same identity and the original unchanged state. There are no detached settlement promises. The engine can settle and move into intermission within the same atomic action transaction.

SQLite uses WAL and synchronous=FULL. The startup recovery transaction refunds the contributions of all persisted active hands and clears lobbies. Deleting those snapshots in the same transaction makes recovery repeatable without duplicate refunds. The server deliberately supports **one process per database**, not clustered workers; a transactionally claimed SQLite ownership row enforces this. Ownership held by a dead PID is reclaimed atomically. If an OS PID has been reused by another live process, startup fails closed; verify no server owns the file before clearing the runtime_owner row manually. Keep the database on a local filesystem.

## Upgrades and migration

Stop the application before upgrading or importing. Back up the database and any legacy JSON outside the checkout. On schema version 0 upgrades, SQLite creates an additional `*.backup` snapshot before rebuilding the user table. The transactional migration preserves usernames/password hashes/balances, rejects invalid balances, discards raw stored sessions, and advances `PRAGMA user_version` to 1. Users sign in again. Databases from newer versions are rejected.

Legacy JSON is never imported automatically. Run `npm run migrate:legacy -- path/to/data.json` while the server is stopped. The importer validates all records first, preserves the source, creates a content-verified backup, then imports every row and records the source hash in one transaction. Username conflicts fail the entire import. Repeating a successful identical file is a no-op. Legacy tokens/lobby references are not imported. Protect backups because legacy JSON may contain plaintext passwords.

Run only the migration command against the target database; development and tests use separate databases. Test suites use in-memory or temporary files and do not touch the application database or `data.json`.

## Deployment and maintenance

Set `PUBLIC_ORIGIN` to the exact HTTPS origin without a trailing slash when behind a reverse proxy. Set `TRUST_PROXY` only to the IPs/subnets of proxies you control; it defaults to false. Do not trust arbitrary forwarded headers. Bind `HOST` as appropriate (the local default is 127.0.0.1). Set a randomly generated `TOKEN_SECRET` of at least 32 characters. Changing it invalidates sessions.

CI runs syntax/contract checks, unit/integration tests, Chromium end-to-end tests, and npm audit. Scheduled CI and Dependabot check dependencies weekly; review lockfile diffs and run the full suite before merging updates. High/critical audit findings block CI. Review moderate findings rather than applying blind `--force` updates. `npm ci` uses the checked-in lockfile.

The ledger and idempotency records intentionally have no automatic deletion. Monitor file growth; any future retention policy must preserve replay safety and accounting evidence. Keep backups, and test restoring them. This is virtual-chip software with an explicit simplified ruleset, not a real-money payment or regulatory platform.

Testing references: [Playwright server setup](https://playwright.dev/docs/test-webserver), [isolated browser contexts](https://playwright.dev/docs/browser-contexts), and [npm audit](https://docs.npmjs.com/cli/v11/commands/npm-audit/).
