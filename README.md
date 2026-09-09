# Gambling API

A small multiplayer poker prototype using Express, WebSockets, SQLite, and a vanilla JavaScript frontend. Accounts start with 200 virtual chips.

## Run locally

Use Node.js 24 (the version used for validation) and npm.

1. Run `npm install`.
2. Copy `.env.example` to `.env` and replace `TOKEN_SECRET` with a generated secret. The generation command is in the example file.
3. Run `npm start` and open <http://localhost:42069/login>.
4. Register two accounts in separate browser profiles, create a lobby, join with the second account, and start the game as host.

`PORT` overrides the listening port. `DATABASE_PATH` overrides the default `users.sqlite` path. `AUTH_DEBUG=true` enables verbose authentication diagnostics. SQLite files and `.env` are ignored by Git.

## Commands

- `npm start`: start the application.
- `npm run dev`: restart on source changes.
- `npm test`: syntax checks and Node regression tests.
- `npm run check`: syntax checks only.
- `npm run docs`: regenerate the HTTP OpenAPI document; browse `/swagger-ui` while the server is running.

If the environment blocks test child processes, run `npm run check` followed by `node --test --test-isolation=none`. Tests use an in-memory database, a temporary listening port, and skip legacy data migration.

## Current behavior

Sessions last 30 minutes. Logging in replaces the previous session. HTTP clients can use the authorization cookie or `Authorization: Bearer <token>`; browser WebSockets use the cookie. Clients must wait for `auth:success` before sending messages.

Lobbies hold at most 10 players, and each account may join one lobby at a time. Private lobbies are hidden from the public list but remain joinable by code. The host starts play. A round begins after a 30-second intermission. Each participating player pays a 10-chip ante; players below that amount spectate. There are four betting streets, best-five-of-seven hand evaluation, and contribution-based side pots. `hit` is the legacy protocol name for check/call. Turns time out after 30 seconds and automatically check/call. Disconnects have a 10-second grace period before leaving.

This is a simplified poker variant: it does not yet enforce standard blinds or minimum-raise/reopening rules. Leaving folds the hand. Unclaimable contribution layers are returned to their contributors. See the audit for settlement edge cases still needing work.

Account records persist in SQLite. Lobby and hand state live in memory and are lost on restart. Startup clears stale lobby references. Legacy `data.json` accounts are imported if present; the source is emptied after import, so back it up before migration.

## Project layout

- `gambling.js`: HTTP routes, database access, authentication, lobby lifecycle, and poker state transitions.
- `lib/poker.js`: pure hand evaluation, deck generation, and side-pot calculations.
- `public/`: HTML, CSS, and browser scripts.
- `test/`: poker and HTTP/WebSocket regression tests.
- `swagger.js` / `swagger.json`: HTTP documentation generator and output.
- [AUDIT.md](AUDIT.md): findings, completed fixes, and prioritized follow-up work.
