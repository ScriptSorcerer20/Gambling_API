const crypto = require('node:crypto');
const {EventEmitter} = require('node:events');
const {KeyedQueue, AppError, hash, canonical} = require('./core');
const engine = require('./engine');

function createLobbyService(repository, config) {
    const lobbies = new Map();
    const queue = new KeyedQueue();
    const events = new EventEmitter();
    const timers = new Map();
    let closing = false;
    function membership(username) { return [...lobbies.values()].find(lobby => lobby.players.includes(username)); }
    function reserved(username) { return [...lobbies.values()].find(lobby => lobby.game?.phase === 'betting' && lobby.game.players.includes(username)); }
    async function balances(players) { return Object.fromEntries(await Promise.all(players.map(async player => [player, (await repository.user(player)).money]))); }
    function schedule(lobby) {
        clearTimeout(timers.get(lobby.id)); timers.delete(lobby.id);
        if (closing || !lobby.players.length || !lobby.game) return;
        const deadline = lobby.game.phase === 'betting' ? lobby.game.turnEndsAt : lobby.game.nextRoundStartsAt;
        if (!deadline) return;
        const id = lobby.game.id;
        const expectedPhase = lobby.game.phase;
        const revision = lobby.revision;
        const timer = setTimeout(() => {
            command(null, {type: 'timer', lobbyId: lobby.id, handId: id, deadline, phase: expectedPhase, revision, requestId: `timer-${id}-${revision}`})
                .catch(error => {
                    // Failed transactions leave state untouched. Retry the same deadline/idempotency key.
                    events.emit('failure', error);
                    if (!closing && lobbies.get(lobby.id) === lobby) {
                        const retry = setTimeout(() => schedule(lobby), 1000); retry.unref(); timers.set(lobby.id, retry);
                    }
                });
        }, Math.max(1, deadline - config.now()));
        timer.unref(); timers.set(lobby.id, timer);
    }
    async function command(username, message) {
        if (closing) throw new AppError('SHUTTING_DOWN', 'Server is shutting down', 503);
        const membershipMutation = ['lobby:create', 'lobby:join', 'lobby:leave'].includes(message.type);
        return queue.run([...(membershipMutation ? ['membership'] : []), ...(username ? [`account:${username}`] : []),
            ...(message.lobbyId ? [`lobby:${message.lobbyId}`] : [])], async () => {
            const id = `${username || 'system'}:${message.requestId}`;
            const fingerprint = hash(JSON.stringify(canonical(message)));
            const prior = await repository.command(id);
            if (prior) {
                if (prior.fingerprint !== fingerprint) throw new AppError('IDEMPOTENCY_CONFLICT', 'Request ID was reused', 409);
                return JSON.parse(prior.result);
            }
            let old = lobbies.get(message.lobbyId);
            if (message.type === 'lobby:create') {
                if (membership(username) || reserved(username)) throw new AppError('ALREADY_SEATED', 'Leave your table and wait for its hand to settle first', 409);
                old = {id: crypto.randomBytes(8).toString('hex'), host: username, players: [], private: message.private || false, game: null};
            }
            if (!old) throw new AppError('LOBBY_NOT_FOUND', 'Lobby not found', 404);
            const lobby = structuredClone(old);
            const baseline = Object.assign(Object.create(null), old.game?.stacks || {});
            if (lobby.game) {
                for (const key of ['stacks', 'hands', 'folded', 'contributions', 'playerBets', 'actedAt', 'payouts']) lobby.game[key] = Object.assign(Object.create(null), lobby.game[key]);
            }
            if (message.type === 'lobby:create' || message.type === 'lobby:join') {
                const current = membership(username) || reserved(username);
                if (current && current.id !== lobby.id) throw new AppError('ALREADY_SEATED', 'Leave your table and wait for its hand to settle first', 409);
                if (!lobby.players.includes(username)) {
                    if (lobby.game?.phase === 'betting' && lobby.game.players.includes(username)) throw new AppError('HAND_PENDING', 'Rejoin after your previous hand settles', 409);
                    if (lobby.players.length >= 10) throw new AppError('LOBBY_FULL', 'Lobby is full', 409);
                    lobby.players.push(username);
                    if (lobby.game) {
                        const balance = (await repository.user(username)).money;
                        lobby.game.stacks[username] = balance; baseline[username] = balance;
                    }
                }
                if (lobby.game?.phase === 'waiting' && (Object.values(await balances(lobby.players)).filter(value => value >= config.ante).length >= 2)) {
                    lobby.game = engine.intermission(lobby.players, await balances(lobby.players), config, lobby.game);
                }
            } else if (message.type === 'lobby:leave') {
                if (!lobby.players.includes(username)) throw new AppError('NOT_SEATED', 'You are not in this lobby', 409);
                lobby.players = lobby.players.filter(player => player !== username);
                engine.leave(lobby.game, username, config);
                if (lobby.host === username) lobby.host = lobby.players[0] || null;
            } else if (message.type === 'poker:start') {
                if (lobby.host !== username) throw new AppError('HOST_REQUIRED', 'Only the host can start', 403);
                if (lobby.game) throw new AppError('GAME_STARTED', 'Game already started', 409);
                if (lobby.players.length < 2) throw new AppError('NOT_ENOUGH_PLAYERS', 'At least two players are required', 409);
                lobby.game = engine.intermission(lobby.players, await balances(lobby.players), config);
                Object.assign(baseline, lobby.game.stacks);
            } else if (message.type === 'poker:action') {
                if (!lobby.players.includes(username)) throw new AppError('NOT_SEATED', 'Join this lobby first', 403);
                if (!lobby.game) throw new AppError('WRONG_PHASE', 'Host must start the game', 409);
                engine.action(lobby.game, username, message.action, message.payload?.amount, config);
            } else if (message.type === 'timer') {
                if (message.revision !== undefined && message.revision !== lobby.revision) return {ignored: true};
                if (!lobby.game || lobby.game.id !== message.handId || lobby.game.phase !== message.phase) return {ignored: true};
                const deadline = lobby.game.phase === 'betting' ? lobby.game.turnEndsAt : lobby.game.nextRoundStartsAt;
                if (deadline !== message.deadline || deadline > config.now()) return {ignored: true};
                if (lobby.game.phase === 'betting') engine.action(lobby.game, engine.turn(lobby.game), 'timeout', undefined, config);
                else {
                    const fresh = await balances(lobby.players);
                    Object.assign(baseline, fresh);
                    lobby.game = engine.deal(lobby.players, fresh, config, lobby.game);
                }
            } else throw new AppError('INVALID_MESSAGE', 'Unsupported command');
            const deltas = Object.fromEntries(Object.entries(lobby.game?.stacks || {}).map(([player, stack]) => [player, stack - (baseline[player] ?? stack)]));
            const difference = Object.values(deltas).reduce((sum, amount) => sum + amount, 0) + (lobby.game?.pot || 0) - (old.game?.pot || 0);
            if (difference !== 0) throw new Error('Command violates chip conservation');
            lobby.revision = (old.revision || 0) + 1;
            const result = {lobbyId: lobby.id, username, type: message.type, requestId: message.requestId};
            await repository.commit({id, fingerprint, lobby, deltas, result, reason: message.type});
            if (lobby.players.length) lobbies.set(lobby.id, lobby); else lobbies.delete(lobby.id);
            schedule(lobby);
            events.emit('changed', lobby, username, message.type);
            return result;
        });
    }
    return {command, membership, events,
        get: id => lobbies.get(id),
        publicList: () => [...lobbies.values()].filter(lobby => !lobby.private).map(lobby => ({lobbyId: lobby.id, host: lobby.host, players: lobby.players.length, gameStarted: Boolean(lobby.game)})),
        state: (lobby, username) => lobby.game ? engine.state(lobby.game, username, lobby.id, config) : null,
        lobbyState: lobby => ({type: 'lobby:state', lobbyId: lobby.id, host: lobby.host, players: lobby.players, isPublic: !lobby.private,
            canStart: lobby.players.length >= 2 && !lobby.game, gameStarted: Boolean(lobby.game), gameUrl: `/poker.html?lobbyId=${lobby.id}`}),
        async close() { closing = true; for (const timer of timers.values()) clearTimeout(timer); await queue.drain(); }
    };
}
module.exports = {createLobbyService};
