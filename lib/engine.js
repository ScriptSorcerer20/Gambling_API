const crypto = require('node:crypto');
const {createDeck, evaluateBestHand, calculatePayouts} = require('./poker');
const {AppError} = require('./core');
const dict = () => Object.create(null);
const live = game => game.players.filter(player => game.hands[player] && !game.folded[player]);
const canAct = (game, player) => live(game).includes(player) && game.stacks[player] > 0;
const callAmount = (game, player) => Math.max(0, game.currentBet - (game.playerBets[player] || 0));
const canRaise = (game, player) => game.actedAt[player] == null || game.currentBet - game.actedAt[player] >= game.minRaise;
const turn = game => game.phase === 'betting' ? game.players[game.currentPlayerIndex] : null;

function intermission(players, balances, config, previous = null) {
    return {
        id: crypto.randomUUID(), players: [...players], stacks: {...balances}, hands: dict(), folded: dict(),
        contributions: dict(), playerBets: dict(), actedAt: dict(), communityCards: [], deck: [],
        phase: 'intermission', street: 'intermission', round: previous?.round || 0,
        dealerIndex: previous?.dealerIndex ?? -1, currentPlayerIndex: -1,
        pot: 0, currentBet: 0, minRaise: config.ante, turnEndsAt: null,
        nextRoundStartsAt: config.now() + config.intermissionMs, lastAction: 'Waiting for the next hand.',
        winner: null, showdown: null, payouts: dict(), departed: []
    };
}
function deal(players, balances, config, previous) {
    const game = intermission(players, balances, config, previous);
    game.round++;
    game.dealerIndex = (game.dealerIndex + 1) % players.length;
    game.nextRoundStartsAt = null;
    const funded = players.filter(player => balances[player] >= config.ante);
    if (funded.length < 2) {
        game.phase = 'waiting'; game.lastAction = `Waiting for two players with at least ${config.ante} chips.`;
        return game;
    }
    game.deck = (config.createDeck || createDeck)();
    game.phase = 'betting'; game.street = 'preflop';
    for (const player of players) {
        game.contributions[player] = 0; game.playerBets[player] = 0; game.actedAt[player] = null;
        game.folded[player] = !funded.includes(player);
        if (!game.folded[player]) {
            game.hands[player] = [game.deck.pop(), game.deck.pop()];
            pay(game, player, config.ante);
            // The ante is not a street bet.
            game.playerBets[player] = 0;
        }
    }
    game.lastAction = `Round ${game.round}: each player paid ${config.ante} chips.`;
    advance(game, config, game.dealerIndex);
    return game;
}
function pay(game, player, amount) {
    game.stacks[player] -= amount;
    game.playerBets[player] += amount;
    game.contributions[player] += amount;
    game.pot += amount;
}
function settle(game, config) {
    const active = live(game);
    const evaluations = active.map(player => ({player, hand: game.hands[player], result: active.length === 1
        ? {score: [0], name: 'Last remaining hand', comboCards: []}
        : evaluateBestHand([...game.hands[player], ...game.communityCards])}));
    const seats = game.players.slice(game.dealerIndex + 1).concat(game.players.slice(0, game.dealerIndex + 1));
    game.payouts = calculatePayouts(game.contributions, evaluations, seats);
    for (const [player, amount] of Object.entries(game.payouts)) game.stacks[player] += amount;
    const distributed = Object.values(game.payouts).reduce((sum, amount) => sum + amount, 0);
    if (distributed !== game.pot) throw new Error('Pot conservation failed');
    game.lastAction = `Distributed ${game.pot} chips: ${Object.entries(game.payouts).map(([player, amount]) => `${player} +${amount}`).join(', ')}.`;
    game.pot = 0; game.phase = 'intermission'; game.currentPlayerIndex = -1;
    game.turnEndsAt = null; game.nextRoundStartsAt = config.now() + config.intermissionMs;
    game.winner = Object.keys(game.payouts).join(', ');
    game.showdown = active.length > 1 ? evaluations : [];
}
function advance(game, config, from = game.currentPlayerIndex) {
    if (live(game).length <= 1) { settle(game, config); return; }
    const solvent = live(game).filter(player => game.stacks[player] > 0);
    const pending = solvent.filter(player => game.actedAt[player] == null || callAmount(game, player) > 0);
    // A sole solvent hand cannot bet into players who are already all-in.
    if (pending.length && !(solvent.length === 1 && callAmount(game, solvent[0]) === 0)) {
        for (let offset = 1; offset <= game.players.length; offset++) {
            const index = (from + offset + game.players.length) % game.players.length;
            if (!pending.includes(game.players[index])) continue;
            game.currentPlayerIndex = index;
            game.turnEndsAt = config.now() + config.turnMs;
            return;
        }
    }
    if (game.street === 'river') { settle(game, config); return; }
    const next = {preflop: 'flop', flop: 'turn', turn: 'river'}[game.street];
    const count = next === 'flop' ? 3 : 1;
    for (let i = 0; i < count; i++) game.communityCards.push(game.deck.pop());
    game.street = next; game.currentBet = 0; game.minRaise = config.ante;
    for (const player of game.players) { game.playerBets[player] = 0; game.actedAt[player] = null; }
    advance(game, config, game.dealerIndex);
}
function action(game, player, kind, amount, config) {
    if (game.phase !== 'betting') throw new AppError('WRONG_PHASE', 'No hand is accepting actions', 409);
    if (turn(game) !== player || !canAct(game, player)) throw new AppError('NOT_YOUR_TURN', 'Wait for your turn', 409);
    if (kind === 'timeout') kind = callAmount(game, player) ? 'fold' : 'hit';
    if (kind === 'fold') {
        game.folded[player] = true; game.lastAction = `${player} folded.`;
    } else if (kind === 'hit' || kind === 'bet') {
        const call = callAmount(game, player);
        if (kind === 'hit') amount = Math.min(call, game.stacks[player]);
        if (!Number.isSafeInteger(amount) || amount < 0 || amount > game.stacks[player]) throw new AppError('INVALID_BET', 'Bet must be whole chips within your stack');
        const allIn = amount === game.stacks[player];
        const target = game.playerBets[player] + amount;
        if (amount < call && !allIn) throw new AppError('INVALID_BET', `Call at least ${call} chips or go all-in`);
        if (target > game.currentBet) {
            if (!canRaise(game, player)) throw new AppError('RAISE_NOT_REOPENED', 'A short all-in has not reopened your raise');
            if (live(game).filter(other => other !== player && game.stacks[other] > 0).length === 0) throw new AppError('INVALID_BET', 'No opponent can match a raise');
            const raise = target - game.currentBet;
            if (raise < game.minRaise && !allIn) throw new AppError('MINIMUM_RAISE', `A full raise must add at least ${game.minRaise} chips above the table bet`);
            if (raise >= game.minRaise) game.minRaise = raise;
            game.currentBet = target;
        }
        pay(game, player, amount);
        game.actedAt[player] = game.currentBet;
        game.lastAction = `${player} ${amount ? `paid ${amount} chips` : 'checked'}.`;
    } else throw new AppError('INVALID_ACTION', 'Unknown poker action');
    advance(game, config);
}
function leave(game, player, config) {
    if (!game || game.phase !== 'betting' || !game.players.includes(player)) return;
    game.departed.push(player); game.folded[player] = true;
    if (turn(game) === player || live(game).length <= 1) advance(game, config);
    else {
        const solvent = live(game).filter(other => game.stacks[other] > 0);
        if (!solvent.length || (solvent.length === 1 && callAmount(game, solvent[0]) === 0)) advance(game, config);
    }
}
function state(game, username, lobbyId, config) {
    return {
        type: 'poker:state', lobbyId, username, players: game.players, round: game.round,
        pot: game.pot, currentBet: game.currentBet, bet: game.currentBet,
        communityCards: game.communityCards, hand: game.hands[username] || [],
        currentPlayer: turn(game), isYourTurn: turn(game) === username,
        queue: game.phase === 'betting' ? game.players.slice(game.currentPlayerIndex).concat(game.players.slice(0, game.currentPlayerIndex)).filter(player => canAct(game, player)) : [],
        folded: game.folded, street: game.street, phase: game.phase, lastAction: game.lastAction,
        yourContribution: game.contributions[username] || 0, yourStack: game.stacks[username] || 0,
        isSpectator: !game.hands[username] || Boolean(game.folded[username]), callAmount: callAmount(game, username),
        minimumStake: config.ante, minimumRaise: game.minRaise, canRaise: canRaise(game, username),
        nextRoundStartsAt: game.nextRoundStartsAt, turnEndsAt: game.turnEndsAt,
        winner: game.winner, showdown: game.showdown, payouts: game.payouts
    };
}
module.exports = {intermission, deal, action, leave, state, turn, callAmount};
