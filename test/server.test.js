const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {once} = require("node:events");
const {WebSocket} = require("ws");
process.env.DATABASE_PATH = ":memory:";
process.env.TOKEN_SECRET = "isolated-test-secret";
const api = require("../gambling");
let base;
const sessions = Object.create(null);
before(async () => {
    await api.initializeDatabase({migrate: false});
    api.server.listen(0, "127.0.0.1");
    await once(api.server, "listening");
    base = `http://127.0.0.1:${api.server.address().port}`;
});
after(() => api.close());
async function request(route, {user, method = "GET", body} = {}) {
    return fetch(base + route, {method, headers: {
        ...(body !== undefined ? {"Content-Type": "application/json"} : {}),
        ...(user ? {Authorization: `Bearer ${sessions[user]}`} : {})
    }, body: body === undefined ? undefined : JSON.stringify(body)});
}
function nextMessage(socket, type) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {socket.off("message", listener); reject(new Error(`Timeout: ${type}`));}, 3000);
        function listener(raw) {
            const value = JSON.parse(raw);
            if (value.type !== type) return;
            clearTimeout(timer); socket.off("message", listener); resolve(value);
        }
        socket.on("message", listener);
    });
}
test("HTTP authentication and WebSocket lobby lifecycle", async () => {
    assert.equal((await request("/balance")).status, 401);
    assert.equal((await request("/register", {method: "POST"})).status, 400);
    for (const user of ["alice", "bob", "__proto__"]) {
        const response = await request("/register", {method: "POST", body: {username: user, password: "test-password"}});
        assert.equal(response.status, 200);
        sessions[user] = (await response.json()).token;
    }
    assert.equal((await request("/balance", {user: "alice"})).status, 200);
    assert.equal((await request("/register", {method: "POST", body: {username: "long", password: "x".repeat(73)}})).status, 400);
    const oldToken = sessions.alice;
    const login = await request("/login", {method: "POST", body: {username: " ALICE ", password: "test-password"}});
    sessions.alice = (await login.json()).token;
    assert.notEqual(sessions.alice, oldToken);
    assert.equal((await request("/lobby/join?lobbyId=__proto__", {user: "alice"})).status, 404);
    const socket = new WebSocket(base.replace("http", "ws"), {headers: {Authorization: `Bearer ${sessions.alice}`, Cookie: "bad=%ZZ"}});
    await nextMessage(socket, "auth:success");
    let pending = nextMessage(socket, "lobby:state");
    socket.send(JSON.stringify({type: "lobby:create"}));
    const lobby = await pending;
    assert.deepEqual(lobby.players, ["alice"]);
    assert.equal((await request("/lobby/create", {user: "alice"})).status, 409);
    assert.equal((await request(`/lobby/join?lobbyId=${lobby.lobbyId}`, {user: "bob"})).status, 200);
    pending = nextMessage(socket, "poker:started");
    socket.send(JSON.stringify({type: "poker:start"}));
    await pending;
    pending = nextMessage(socket, "poker:error");
    socket.send(JSON.stringify({type: "poker:start"}));
    assert.match((await pending).message, /already started/);
    pending = nextMessage(socket, "error");
    socket.send("null");
    assert.match((await pending).message, /object/);
    const closed = once(socket, "close");
    await request("/logout", {user: "alice", method: "DELETE"});
    socket.send(JSON.stringify({type: "lobby:create"}));
    await closed;
    assert.equal((await request("/balance", {user: "alice"})).status, 403);
});
test("leaving before the current seat preserves turn and independent lobby roster", async () => {
    const id = "test-table";
    api.playerMap[id] = ["alice", "bob", "__proto__"];
    const game = await api.createPokerGame(id);
    assert.equal(game.players[game.currentPlayerIndex], "bob");
    assert.notEqual(game.players, api.playerMap[id]);
    await api.removePlayerFromPokerGame(id, "alice");
    assert.equal(game.players[game.currentPlayerIndex], "bob");
    assert.equal(game.contributions.alice, 10);
    api.clearTurnTimer(game);
});
test("fractional and nonnumeric bets do not mutate the pot", () => {
    const game = api.pokerGames["test-table"];
    const pot = game.pot;
    for (const amount of [0.5, "10", null, Infinity, -1]) {
        assert.match(api.applyPokerAction(game, "bob", "bet", {amount}).error, /whole number/);
        assert.equal(game.pot, pot);
    }
});
test("malformed cookie encoding is ignored", () => {
    assert.equal(api.parseCookieHeader("bad=%ZZ; authorization=valid").authorization, "valid");
});

test("ante-only all-ins run out the board without waiting for a broke player", async () => {
    const id = "all-in-table";
    api.playerMap[id] = ["alice", "bob"];
    api.pokerGames[id] = {round: 1, phase: "intermission", dealerIndex: 0, stacks: {alice: 10, bob: 10}};
    const game = await api.createPokerGame(id);
    assert.equal(game.round, 1);
    assert.equal(game.communityCards.length, 5);
    assert.equal(game.potAwarded, true);
    assert.equal(game.stacks.alice + game.stacks.bob, 20);
    // Allow the asynchronous persistence and intermission transition to complete.
    for (let i = 0; i < 100 && api.pokerGames[id] === game; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(api.pokerGames[id].phase, "intermission");
    assert.equal(api.pokerGames[id].round, 2);
});
