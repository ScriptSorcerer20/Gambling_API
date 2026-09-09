# Poker rules

This application plays an **ante-based no-limit community-card variant**, not casino Texas Hold'em with blinds. All amounts are integer virtual chips. The rules are implemented in `lib/engine.js`.

- Accounts start with 200 chips. Each hand requires a 10-chip ante; players below 10 watch. Tables have at most 10 seats.
- After a 30-second intermission, eligible players receive two private cards. The dealer marker rotates one seat; the first solvent player to its left acts first on every street. There are no small/big blinds or burn cards.
- Preflop, flop (three cards), turn, and river each have a betting round. At showdown, the best five of seven cards wins. Aces may be low in A-2-3-4-5 straights. Suits do not break ties.
- **Check/call** (`hit` in the protocol) checks for free or pays the smaller of the outstanding call and the remaining stack. **Fold** gives up eligibility. **Bet** specifies chips to add now, not a target total.
- An opening bet is at least 10. A full raise adds at least the previous full raise above the current table bet. A smaller increase is allowed only if it consumes the player's entire stack.
- A short all-in requires others to match the increased bet but does not reopen raises for someone who has already acted. Cumulative short raises reopen action once the increase faced since that player's last action reaches the previous full-raise size.
- A lone solvent player may call outstanding chips but may not raise into opponents who are all-in. If nobody can act, remaining board cards run out immediately.
- After 30 seconds, a turn checks when free and folds when facing a bet. Timeout never commits additional chips.

## Pots and leaving

Each distinct contribution level creates a pot. Folded players' chips contribute but their hands cannot win. Eligible tied winners split each layer. Odd chips go to eligible winners in seat order starting left of the dealer. Unmatched chips return to their contributor.

If no live hand is eligible for a contribution layer, that layer is refunded to its contributors. This explicit house rule also handles abandoned/dead hands and forfeited high contribution layers; it avoids destroying chips.

Leaving immediately folds, removes lobby membership, and keeps committed contributions in the hand. The account cannot join another table or rejoin the same hand until that hand settles. This prevents spending the same balance while an old table still holds a claim. Uncommitted chips remain in the account. A player joining an already-running hand spectates until the next deal.

A disconnect has a 10-second grace period. Reconnecting restores the same hand; if the last connection stays absent, the server leaves/folds the account through the same command queue.

## Restart policy

Committed bets are held in durable escrow; `/balance` and leaderboard values exclude that escrow. On restart, interrupted hands are cancelled, contributions are refunded exactly once, and lobbies are cleared. Completed payouts remain paid. The server does not attempt to resume partially played hands after a restart.
