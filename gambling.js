const express = require("express");
const app = express();
const http = require("http");
const {WebSocket, WebSocketServer} = require("ws");
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./swagger.json");
const path = require("path");
app.use(express.static(path.join(__dirname, "public")));
const fs = require("fs/promises");
const crypto = require("crypto");
const dotenv = require("dotenv").config();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3");
const {open} = require("sqlite");
const port = process.env.PORT || 42069;
const server = http.createServer(app);
const wss = new WebSocketServer({server});
let db;
const authCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    path: "/"
};

app.use(express.json());
app.use("/swagger-ui", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.use(cookieParser());

/*
    Here are Helper function  -----------------------------------------------------------------------------------------------
 */

async function initializeDatabase() {
    db = await open({
        filename: path.join(__dirname, "users.sqlite"),
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            token TEXT,
            money INTEGER NOT NULL DEFAULT 200,
            lobby_id TEXT
        )
    `);

    await migrateJsonUsers();
}

async function migrateJsonUsers() {
    const dataPath = path.join(__dirname, "data.json");
    try {
        const rawUsers = JSON.parse(await fs.readFile(dataPath, "utf8"));
        if (!Array.isArray(rawUsers)) return;

        for (const user of rawUsers) {
            if (!user.username || !user.password) continue;
            const username = user.username.toLowerCase();
            const existingUser = await findUserByUsername(username);
            if (existingUser) continue;

            const passwordHash = user.password.startsWith("$2")
                ? user.password
                : await bcrypt.hash(user.password, 12);

            await db.run(
                "INSERT INTO users (username, password_hash, token, money, lobby_id) VALUES (?, ?, ?, ?, ?)",
                username,
                passwordHash,
                user.token || null,
                Number.isFinite(user.money) ? user.money : 200,
                user.lobbyId || null
            );
        }

        if (rawUsers.length > 0) {
            await fs.writeFile(dataPath, "[]\n");
        }
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.error("Failed to migrate data.json users:", error);
        }
    }
}

async function getUsers() {
    return db.all("SELECT username, token, money, lobby_id AS lobbyId FROM users");
}

async function findUserByUsername(username) {
    return db.get(
        "SELECT username, password_hash AS passwordHash, token, money, lobby_id AS lobbyId FROM users WHERE username = ?",
        username
    );
}

async function saveUser({username, password, token, money = 200}) {
    const passwordHash = await bcrypt.hash(password, 12);
    await db.run(
        "INSERT INTO users (username, password_hash, token, money) VALUES (?, ?, ?, ?)",
        username,
        passwordHash,
        token,
        money
    );
}

async function setUserToken(username, token) {
    await db.run("UPDATE users SET token = ? WHERE username = ?", token || null, username);
}

async function setUserLobby(username, lobbyId) {
    await db.run("UPDATE users SET lobby_id = ? WHERE username = ?", lobbyId || null, username);
}

async function setUserMoney(username, money) {
    await db.run("UPDATE users SET money = ? WHERE username = ?", Math.max(0, Math.floor(money)), username);
}

function generateAccessToken(user) {
    return jwt.sign(user, process.env.TOKEN_SECRET, {expiresIn: "1800s"});
}

function setAuthCookie(response, token) {
    response.cookie("authorization", token, authCookieOptions);
}

function normalizeUsername(username) {
    return typeof username === "string" ? username.trim().toLowerCase() : "";
}

function isValidPassword(password) {
    return typeof password === "string" && password.length > 0;
}

function parseCookieHeader(cookieHeader = "") {
    return cookieHeader.split(";").reduce((cookies, cookie) => {
        const separatorIndex = cookie.indexOf("=");
        if (separatorIndex === -1) return cookies;
        const key = cookie.slice(0, separatorIndex).trim();
        const value = decodeURIComponent(cookie.slice(separatorIndex + 1).trim());
        cookies[key] = value;
        return cookies;
    }, {});
}

function getAuthTokenFromRequest(request) {
    return request.headers.authorization?.split(" ")[1] || request.cookies.authorization;
}

async function verifyAuthToken(token) {
    if (!token) return null;
    try {
        const decoded = jwt.verify(token, process.env.TOKEN_SECRET);
        const foundUser = await findUserByUsername(decoded.username);
        if (!foundUser || foundUser.token !== token) return null;
        return decoded;
    } catch {
        return null;
    }
}

async function authenticateToken(request, response, next) {
    /* #swagger.security = [{
        "bearerAuth": []
    }] */
    const token = getAuthTokenFromRequest(request);
    if (token == null) return response.sendStatus(401);
    const user = await verifyAuthToken(token);
    if (!user) {
        return response.status(403).json({error: "Token has been revoked or is invalid"});
    }
    request.user = user;
    next();
}

/*
    Here is the the Login logic -----------------------------------------------------------------------------------------------
 */

app.post("/register", async (request, response) => {
    let {username, password} = request.body;
    username = normalizeUsername(username);
    if (!username || !isValidPassword(password))
        return response.status(400).json({error: "Username and password are required"});
    const existingUser = await findUserByUsername(username);
    if (existingUser) {
        return response.status(400).json({error: "Username already exists"});
    }
    const token = generateAccessToken({username});
    await saveUser({username, password, token, money: 200});
    setAuthCookie(response, token);
    response.json({username, token});
});

app.get("/leaderboard", authenticateToken, async (req, res) => {
    const users = await getUsers();
    const sorted = users.sort((a, b) => b.money - a.money);
    const top10 = sorted.slice(0, 10).map(u => ({
        username: u.username,
        money: u.money,
    }));
    const username = req.user.username;
    const position = sorted.findIndex(u => u.username === username) + 1;
    const self = sorted.find(u => u.username === username);
    res.json({
        leaderboard: top10,
        self: {
            username: self.username,
            money: self.money,
            position
        }
    });
});

app.get("/login", (request, response) => {
    response.sendFile(path.join(__dirname, "./public/login.html"));
})

app.post("/login", async (request, response) => {
    let {username, password} = request.body;
    username = normalizeUsername(username);
    if (!username || !isValidPassword(password))
        return response.status(400).json({error: "Username and password are required"});
    const user = await findUserByUsername(username);
    if (!user) return response.status(401).json({error: "Invalid credentials"});
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
        return response.status(401).json({error: "Invalid password"});
    }
    const token = generateAccessToken({username});
    await setUserToken(username, token);
    setAuthCookie(response, token);
    response.json({username, token});
});

app.get("/", async (req, res) => {
    const token =
        req.headers.authorization?.split(" ")[1] ||
        req.cookies.authorization;
    if (!token) {
        return res.sendFile(path.join(__dirname, "./public/unauthorized.html"));
    }
    const user = await verifyAuthToken(token);
    if (!user) {
        return res.sendFile(path.join(__dirname, "./public/unauthorized.html"));
    }
    req.user = user;
    res.sendFile(path.join(__dirname, "./public/home.html"));
});

app.get("/balance", authenticateToken, async (request, response) => {
    /* #swagger.security = [{
            "bearerAuth": []
    }] */
    const username = request.user.username;
    const me = await findUserByUsername(username);
    if (!me) {
        return response.status(404).json({error: "User not found"});
    }
    response.status(200).json({balance: me.money});
});

app.post("/verify", authenticateToken, (request, response) => {
    response.json({valid: true, user: request.user});
});

app.delete("/logout", authenticateToken, async (request, response) => {
    const username = request.user.username;
    const user = await findUserByUsername(username);
    if (!user) return response.status(404).json({error: "User not found"});
    const lobbyId = user.lobbyId;
    await leavePokerLobby(lobbyId, username);
    await setUserToken(username, null);
    response.clearCookie("authorization", authCookieOptions);
    response.json({message: "Logged out successfully."});
});

const playerMap = {};
const lobbySockets = {};
const lobbyHosts = {};
const lobbyPrivacy = {};
const pokerGames = {};
const disconnectTimers = {};
const ROUND_INTERMISSION_MS = 30000;
const TURN_TIMEOUT_MS = 30000;
const DISCONNECT_GRACE_MS = 10000;
const MINIMUM_STAKE = 10;
const STARTING_STACK = 200;

const cardSuits = ["S", "H", "D", "C"];
const cardRanks = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];

function createPlaceholderDeck() {
    const deck = [];
    for (const suit of cardSuits) {
        for (const rank of cardRanks) {
            deck.push({rank, suit});
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

async function getInitialPokerStack(player, previousStacks = {}) {
    if (Number.isFinite(previousStacks[player])) {
        return previousStacks[player];
    }
    const user = await findUserByUsername(player);
    return Number.isFinite(user?.money) ? user.money : STARTING_STACK;
}

async function persistPokerStacks(game) {
    await Promise.all(game.players.map(player => setUserMoney(player, game.stacks[player] || 0)));
}

async function createPokerGame(lobbyId) {
    const players = playerMap[lobbyId] || [];
    const existingGame = pokerGames[lobbyId];
    if (existingGame?.nextRoundTimer) {
        clearTimeout(existingGame.nextRoundTimer);
    }
    const roundNumber = existingGame ? existingGame.round + 1 : 1;
    const previousStacks = existingGame?.stacks || {};
    const dealerIndex = existingGame
        ? (existingGame.dealerIndex + 1) % Math.max(players.length, 1)
        : 0;
    const stacks = {};
    const playersWithChips = [];

    for (const player of players) {
        stacks[player] = await getInitialPokerStack(player, previousStacks);
        if (stacks[player] >= MINIMUM_STAKE) {
            playersWithChips.push(player);
        }
    }
    const activePlayers = playersWithChips.length >= 2 ? playersWithChips : [];

    const deck = createPlaceholderDeck();
    const hands = {};
    const folded = {};
    const acted = {};
    const contributions = {};
    const playerBets = {};
    let pot = 0;

    for (const player of activePlayers) {
        hands[player] = [deck.pop(), deck.pop()];
        folded[player] = false;
        acted[player] = false;
        contributions[player] = MINIMUM_STAKE;
        playerBets[player] = 0;
        stacks[player] -= MINIMUM_STAKE;
        pot += MINIMUM_STAKE;
    }

    for (const player of players) {
        if (!activePlayers.includes(player)) {
            folded[player] = true;
            acted[player] = true;
            contributions[player] = 0;
            playerBets[player] = 0;
        }
    }

    pokerGames[lobbyId] = {
        lobbyId,
        players,
        activePlayers,
        deck,
        round: roundNumber,
        street: "preflop",
        phase: activePlayers.length >= 2 ? "betting" : "waiting",
        pot,
        currentBet: 0,
        bet: 0,
        dealerIndex,
        communityCards: [],
        hands,
        folded,
        acted,
        contributions,
        playerBets,
        stacks,
        currentPlayerIndex: activePlayers.length >= 2
            ? getFirstActiveLeftOfDealer({players, folded, dealerIndex})
            : -1,
        lastAction: activePlayers.length >= 2
            ? `Round ${roundNumber} started. $${MINIMUM_STAKE} minimum stake paid by each player.`
            : `Waiting for at least two players with $${MINIMUM_STAKE}.`,
        lastBettor: null,
        winner: null,
        showdown: null,
        potAwarded: false,
        nextRoundTimer: null,
        nextRoundStartsAt: null,
        turnTimer: null,
        turnTimerPlayer: null,
        turnEndsAt: null,
        minimumStake: MINIMUM_STAKE
    };

    startTurnTimer(pokerGames[lobbyId]);
    return pokerGames[lobbyId];
}

async function createPokerIntermission(lobbyId) {
    const players = playerMap[lobbyId] || [];
    const existingGame = pokerGames[lobbyId];
    if (existingGame?.nextRoundTimer) {
        clearTimeout(existingGame.nextRoundTimer);
    }

    const roundNumber = existingGame ? existingGame.round + 1 : 1;
    const previousStacks = existingGame?.stacks || {};
    const stacks = {};
    const folded = {};
    const acted = {};
    const contributions = {};
    const playerBets = {};

    for (const player of players) {
        stacks[player] = await getInitialPokerStack(player, previousStacks);
        folded[player] = true;
        acted[player] = true;
        contributions[player] = 0;
        playerBets[player] = 0;
    }

    const previousResult = existingGame?.winner
        ? `${existingGame.lastAction} Next round starts in ${ROUND_INTERMISSION_MS / 1000} seconds.`
        : `Next round starts in ${ROUND_INTERMISSION_MS / 1000} seconds. Minimum stake: $${MINIMUM_STAKE}.`;

    const intermission = {
        lobbyId,
        players,
        activePlayers: [],
        deck: [],
        round: roundNumber,
        street: "intermission",
        phase: "intermission",
        pot: 0,
        currentBet: 0,
        bet: 0,
        dealerIndex: existingGame?.dealerIndex ?? 0,
        communityCards: [],
        hands: {},
        folded,
        acted,
        contributions,
        playerBets,
        stacks,
        currentPlayerIndex: -1,
        lastAction: previousResult,
        lastBettor: null,
        winner: existingGame?.winner || null,
        showdown: existingGame?.showdown || null,
        potAwarded: false,
        nextRoundTimer: null,
        nextRoundStartsAt: Date.now() + ROUND_INTERMISSION_MS,
        turnTimer: null,
        turnTimerPlayer: null,
        turnEndsAt: null,
        minimumStake: MINIMUM_STAKE
    };

    pokerGames[lobbyId] = intermission;
    intermission.nextRoundTimer = setTimeout(async () => {
        if (!pokerGames[lobbyId] || !playerMap[lobbyId]?.length) return;
        await createPokerGame(lobbyId);
        broadcastLobby(lobbyId);
        broadcastPokerState(lobbyId);
    }, ROUND_INTERMISSION_MS);

    return intermission;
}

function getCurrentPlayer(game) {
    if (game.phase !== "betting") return null;
    return game.players[game.currentPlayerIndex] || null;
}

function getActivePlayers(game) {
    return game.players.filter(player => !game.folded[player] && game.hands[player]);
}

function canActInBetting(game, player) {
    return !game.folded[player] && game.hands[player] && (game.stacks[player] || 0) > 0;
}

function getPlayablePlayers(game) {
    return game.players.filter(player => (game.stacks[player] || 0) >= MINIMUM_STAKE);
}

function getCallAmount(game, username) {
    return Math.max(0, (game.currentBet || 0) - (game.playerBets[username] || 0));
}

function isSpectator(game, username) {
    return game.phase !== "intermission" && (!game.hands[username] || (game.stacks[username] || 0) < 0);
}

function getFirstActiveLeftOfDealer(game) {
    for (let offset = 1; offset <= game.players.length; offset++) {
        const index = (game.dealerIndex + offset) % game.players.length;
        const player = game.players[index];
        if (game.hands ? canActInBetting(game, player) : !game.folded[player]) return index;
    }
    return -1;
}

function getQueue(game) {
    if (game.phase !== "betting" || game.currentPlayerIndex < 0) {
        return getActivePlayers(game);
    }

    const queue = [];
    for (let offset = 0; offset < game.players.length; offset++) {
        const index = (game.currentPlayerIndex + offset) % game.players.length;
        const player = game.players[index];
        if (canActInBetting(game, player)) {
            queue.push(player);
        }
    }
    return queue;
}

function clearTurnTimer(game) {
    if (game?.turnTimer) {
        clearTimeout(game.turnTimer);
    }
    if (game) {
        game.turnTimer = null;
        game.turnTimerPlayer = null;
        game.turnEndsAt = null;
    }
}

function startTurnTimer(game) {
    clearTurnTimer(game);
    const currentPlayer = getCurrentPlayer(game);
    if (!game || game.phase !== "betting" || !currentPlayer) return;

    game.turnTimerPlayer = currentPlayer;
    game.turnEndsAt = Date.now() + TURN_TIMEOUT_MS;
    game.turnTimer = setTimeout(() => {
        const activeGame = pokerGames[game.lobbyId];
        if (!activeGame || activeGame !== game || getCurrentPlayer(activeGame) !== currentPlayer) return;

        const result = applyPokerAction(activeGame, currentPlayer, "hit", {}, true);
        if (result.error && getCurrentPlayer(activeGame) === currentPlayer) {
            applyPokerAction(activeGame, currentPlayer, "fold", {}, true);
        }
        broadcastPokerState(activeGame.lobbyId);
    }, TURN_TIMEOUT_MS);
}

function resetBettingRound(game, street) {
    clearTurnTimer(game);
    game.street = street;
    game.phase = "betting";
    game.currentBet = 0;
    game.bet = 0;
    game.lastBettor = null;

    for (const player of game.players) {
        game.acted[player] = game.folded[player] || (game.hands[player] && (game.stacks[player] || 0) <= 0);
        game.playerBets[player] = 0;
    }

    game.currentPlayerIndex = getFirstActiveLeftOfDealer(game);
    if (game.currentPlayerIndex === -1 || haveAllActivePlayersMatched(game)) {
        revealNextStreet(game);
        return;
    }
    startTurnTimer(game);
}

async function completeRoundWithWinner(game, winner) {
    clearTurnTimer(game);
    game.phase = "complete";
    game.currentPlayerIndex = -1;
    game.winner = winner;
    if (!game.potAwarded) {
        game.stacks[winner] += game.pot;
        game.potAwarded = true;
    }
    game.lastAction = `${winner} wins $${game.pot}`;
    await persistPokerStacks(game);
    await scheduleNextRound(game);
}

async function scheduleNextRound(game) {
    clearTurnTimer(game);
    if (game.nextRoundTimer || !pokerGames[game.lobbyId]) return;

    await createPokerIntermission(game.lobbyId);
    broadcastLobby(game.lobbyId);
    broadcastPokerState(game.lobbyId);
}

async function maybeStartWaitingGame(lobbyId) {
    const game = pokerGames[lobbyId];
    if (!game || game.phase !== "waiting") return;
    const playersWithChips = game.players.filter(player => (game.stacks[player] || 0) >= MINIMUM_STAKE);
    if (playersWithChips.length >= 2) {
        await createPokerIntermission(lobbyId);
        broadcastPokerState(lobbyId);
    }
}

function finishIfOnlyOneActive(game) {
    const activePlayers = getActivePlayers(game);
    if (activePlayers.length <= 1) {
        clearTurnTimer(game);
        if (activePlayers.length === 1) {
            completeRoundWithWinner(game, activePlayers[0]).catch(error => {
                console.error("Failed to complete poker round:", error);
            });
        } else {
            game.phase = "complete";
            game.currentPlayerIndex = -1;
            game.lastAction = "Round ended";
        }
        return true;
    }
    return false;
}

function haveAllActivePlayersMatched(game) {
    return getActivePlayers(game).every(player => (
        game.acted[player] && (game.playerBets[player] === game.currentBet || (game.stacks[player] || 0) <= 0)
    ));
}

function revealNextStreet(game) {
    clearTurnTimer(game);
    if (game.street === "preflop") {
        game.communityCards.push(game.deck.pop(), game.deck.pop(), game.deck.pop());
        resetBettingRound(game, "flop");
        game.lastAction = "Flop revealed. Second betting round.";
        return;
    }

    if (game.street === "flop") {
        game.communityCards.push(game.deck.pop());
        resetBettingRound(game, "turn");
        game.lastAction = "Turn revealed. Third betting round.";
        return;
    }

    if (game.street === "turn") {
        game.communityCards.push(game.deck.pop());
        resetBettingRound(game, "river");
        game.lastAction = "River revealed. Final betting round.";
        return;
    }

    startShowdown(game).catch(error => {
        console.error("Failed to start poker showdown:", error);
    });
}

function advanceTurn(game) {
    clearTurnTimer(game);
    if (finishIfOnlyOneActive(game)) return;

    if (haveAllActivePlayersMatched(game)) {
        revealNextStreet(game);
        return;
    }

    for (let offset = 1; offset <= game.players.length; offset++) {
        const nextIndex = (game.currentPlayerIndex + offset) % game.players.length;
        const nextPlayer = game.players[nextIndex];
        if (canActInBetting(game, nextPlayer)) {
            game.currentPlayerIndex = nextIndex;
            startTurnTimer(game);
            return;
        }
    }
}

function getRankValue(rank) {
    return {A: 14, K: 13, Q: 12, J: 11, "10": 10, "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2}[rank] || 0;
}

function getCombinations(cards, size, start = 0, current = [], result = []) {
    if (current.length === size) {
        result.push([...current]);
        return result;
    }

    for (let index = start; index < cards.length; index++) {
        current.push(cards[index]);
        getCombinations(cards, size, index + 1, current, result);
        current.pop();
    }
    return result;
}

function compareScores(a, b) {
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
        const diff = (a[index] || 0) - (b[index] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

function evaluateFiveCardHand(cards) {
    const values = cards.map(card => getRankValue(card.rank)).sort((a, b) => b - a);
    const suits = cards.map(card => card.suit);
    const isFlush = suits.every(suit => suit === suits[0]);
    const uniqueValues = [...new Set(values)].sort((a, b) => b - a);
    const straightValues = uniqueValues.includes(14)
        ? [...uniqueValues, 1]
        : uniqueValues;
    let straightHigh = 0;

    for (let index = 0; index <= straightValues.length - 5; index++) {
        const run = straightValues.slice(index, index + 5);
        if (run[0] - run[4] === 4) {
            straightHigh = run[0];
            break;
        }
    }

    const counts = values.reduce((acc, value) => {
        acc[value] = (acc[value] || 0) + 1;
        return acc;
    }, {});
    const groups = Object.entries(counts)
        .map(([value, count]) => ({value: Number(value), count}))
        .sort((a, b) => b.count - a.count || b.value - a.value);

    const sortedCards = [...cards].sort((a, b) => getRankValue(b.rank) - getRankValue(a.rank));

    if (isFlush && straightHigh === 14) return {rank: 9, name: "Royal Flush", score: [9, 14], comboCards: sortedCards};
    if (isFlush && straightHigh) return {rank: 8, name: "Straight Flush", score: [8, straightHigh], comboCards: sortedCards};
    if (groups[0].count === 4) {
        const comboCards = [
            ...sortedCards.filter(card => getRankValue(card.rank) === groups[0].value),
            ...sortedCards.filter(card => getRankValue(card.rank) !== groups[0].value).slice(0, 1)
        ];
        return {rank: 7, name: "Four of a Kind", score: [7, groups[0].value, groups[1].value], comboCards};
    }
    if (groups[0].count === 3 && groups[1].count === 2) {
        const comboCards = [
            ...sortedCards.filter(card => getRankValue(card.rank) === groups[0].value),
            ...sortedCards.filter(card => getRankValue(card.rank) === groups[1].value)
        ];
        return {rank: 6, name: "Full House", score: [6, groups[0].value, groups[1].value], comboCards};
    }
    if (isFlush) return {rank: 5, name: "Flush", score: [5, ...values], comboCards: sortedCards};
    if (straightHigh) return {rank: 4, name: "Straight", score: [4, straightHigh], comboCards: sortedCards};
    if (groups[0].count === 3) {
        const kickers = groups.filter(group => group.count === 1).map(group => group.value);
        const comboCards = [
            ...sortedCards.filter(card => getRankValue(card.rank) === groups[0].value),
            ...sortedCards.filter(card => getRankValue(card.rank) !== groups[0].value)
        ];
        return {rank: 3, name: "Three of a Kind", score: [3, groups[0].value, ...kickers], comboCards};
    }
    if (groups[0].count === 2 && groups[1].count === 2) {
        const pairValues = groups.filter(group => group.count === 2).map(group => group.value);
        const kicker = groups.find(group => group.count === 1).value;
        const comboCards = [
            ...sortedCards.filter(card => pairValues.includes(getRankValue(card.rank))),
            ...sortedCards.filter(card => !pairValues.includes(getRankValue(card.rank)))
        ];
        return {rank: 2, name: "Two Pair", score: [2, ...pairValues, kicker], comboCards};
    }
    if (groups[0].count === 2) {
        const kickers = groups.filter(group => group.count === 1).map(group => group.value);
        const comboCards = [
            ...sortedCards.filter(card => getRankValue(card.rank) === groups[0].value),
            ...sortedCards.filter(card => getRankValue(card.rank) !== groups[0].value)
        ];
        return {rank: 1, name: "Pair", score: [1, groups[0].value, ...kickers], comboCards};
    }
    return {rank: 0, name: "High Card", score: [0, ...values], comboCards: sortedCards};
}

function evaluateBestHand(cards) {
    return getCombinations(cards, 5)
        .map(evaluateFiveCardHand)
        .sort((a, b) => compareScores(b.score, a.score))[0];
}

async function startShowdown(game) {
    const activePlayers = getActivePlayers(game);
    const evaluations = activePlayers.map(player => ({
        player,
        hand: game.hands[player],
        result: evaluateBestHand([...game.hands[player], ...game.communityCards])
    }));
    const rankedResults = [...evaluations].sort((a, b) => compareScores(b.result.score, a.result.score));
    const bestScore = rankedResults[0]?.result.score;
    const winners = bestScore
        ? rankedResults.filter(entry => compareScores(entry.result.score, bestScore) === 0)
        : [];
    const bettorIndex = game.lastBettor ? game.players.indexOf(game.lastBettor) : 0;
    const startIndex = bettorIndex >= 0 ? bettorIndex : 0;
    const revealOrder = [...evaluations].sort((a, b) => {
        const aIndex = game.players.indexOf(a.player);
        const bIndex = game.players.indexOf(b.player);
        return ((aIndex - startIndex + game.players.length) % game.players.length)
            - ((bIndex - startIndex + game.players.length) % game.players.length);
    });

    game.phase = "showdown";
    game.currentPlayerIndex = -1;
    game.showdown = revealOrder;
    game.winner = winners.length ? winners.map(entry => entry.player).join(", ") : null;
    if (winners.length && !game.potAwarded) {
        const baseShare = Math.floor(game.pot / winners.length);
        let remainder = game.pot % winners.length;
        for (const entry of winners) {
            const extraChip = remainder > 0 ? 1 : 0;
            game.stacks[entry.player] += baseShare + extraChip;
            remainder -= extraChip;
        }
        game.potAwarded = true;
    }
    game.lastAction = game.winner
        ? `Showdown: ${game.winner} ${winners.length === 1 ? "wins" : "split"} $${game.pot} with ${rankedResults[0].result.name}`
        : "Showdown ended";
    await persistPokerStacks(game);
    await scheduleNextRound(game);
}

function createPokerState(game, username) {
    return {
        type: "poker:state",
        lobbyId: game.lobbyId,
        username,
        players: game.players,
        round: game.round,
        pot: game.pot,
        bet: game.bet,
        currentBet: game.currentBet,
        communityCards: game.communityCards,
        hand: game.hands[username] || [],
        currentPlayer: getCurrentPlayer(game),
        isYourTurn: getCurrentPlayer(game) === username,
        folded: game.folded,
        queue: getQueue(game),
        street: game.street,
        phase: game.phase,
        lastAction: game.lastAction,
        contributions: game.contributions,
        yourContribution: game.contributions[username] || 0,
        stacks: game.stacks,
        yourStack: game.stacks[username] || 0,
        isSpectator: isSpectator(game, username),
        playablePlayers: getPlayablePlayers(game),
        canLeaveTable: true,
        callAmount: getCallAmount(game, username),
        minimumStake: game.minimumStake || MINIMUM_STAKE,
        nextRoundStartsAt: game.nextRoundStartsAt,
        turnEndsAt: game.turnEndsAt,
        turnTimeoutMs: TURN_TIMEOUT_MS,
        winner: game.winner,
        showdown: game.phase === "showdown" || game.phase === "intermission" ? game.showdown : null
    };
}

function broadcastPokerState(lobbyId) {
    const game = pokerGames[lobbyId];
    if (!game || !lobbySockets[lobbyId]) return;

    for (const socket of lobbySockets[lobbyId]) {
        sendSocketMessage(socket, createPokerState(game, socket.user.username));
    }
}

function canLeavePokerTable(lobbyId, username) {
    return Boolean(lobbyId && username);
}

async function removePlayerFromPokerGame(lobbyId, username) {
    const game = pokerGames[lobbyId];
    if (!game) return;

    const remainingStack = game.stacks[username];
    if (Number.isFinite(remainingStack)) {
        await setUserMoney(username, remainingStack);
    }

    const index = game.players.indexOf(username);
    if (index > -1) {
        game.players.splice(index, 1);
    }
    delete game.hands[username];
    delete game.folded[username];
    delete game.acted[username];
    delete game.contributions[username];
    delete game.playerBets[username];
    delete game.stacks[username];

    if (game.players.length === 0) {
        if (game.nextRoundTimer) {
            clearTimeout(game.nextRoundTimer);
        }
        clearTurnTimer(game);
        delete pokerGames[lobbyId];
        return;
    }

    if (game.currentPlayerIndex >= game.players.length) {
        game.currentPlayerIndex = 0;
    }
    game.dealerIndex = Math.min(game.dealerIndex, game.players.length - 1);
    if (game.turnTimerPlayer === username) {
        clearTurnTimer(game);
        if (game.phase === "betting" && !haveAllActivePlayersMatched(game)) {
            startTurnTimer(game);
        }
    }
    if (finishIfOnlyOneActive(game)) return;
    if (game.phase === "betting" && haveAllActivePlayersMatched(game)) {
        revealNextStreet(game);
    }
}

async function ensurePlayerInPokerGame(lobbyId, username) {
    const game = pokerGames[lobbyId];
    if (!game || !username) return;

    if (!game.players.includes(username)) {
        game.players.push(username);
    }

    if (!Number.isFinite(game.stacks[username])) {
        game.stacks[username] = await getInitialPokerStack(username, {});
    }
    if (!Object.prototype.hasOwnProperty.call(game.folded, username)) {
        game.folded[username] = true;
    }
    if (!Object.prototype.hasOwnProperty.call(game.acted, username)) {
        game.acted[username] = true;
    }
    if (!Object.prototype.hasOwnProperty.call(game.contributions, username)) {
        game.contributions[username] = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(game.playerBets, username)) {
        game.playerBets[username] = 0;
    }
}

function applyPokerAction(game, username, action, payload = {}, automatic = false) {
    if (game.phase !== "betting") {
        return {error: "This round is already finished"};
    }

    if (isSpectator(game, username)) {
        return {error: "You are out of chips and can only spectate"};
    }

    if (getCurrentPlayer(game) !== username) {
        return {error: "It is not your turn"};
    }

    if (game.folded[username]) {
        return {error: "You already folded"};
    }

    if (action === "bet") {
        const amount = Math.max(0, Number(payload.amount) || 0);
        if (amount > game.stacks[username]) {
            return {error: "You do not have enough chips"};
        }
        if (amount > 0 && amount < MINIMUM_STAKE) {
            return {error: `Minimum stake is $${MINIMUM_STAKE}`};
        }
        if (amount <= 0 && game.playerBets[username] < game.currentBet) {
            return {error: `You need to match the current bet of $${game.currentBet}`};
        }
        if (game.playerBets[username] + amount < game.currentBet) {
            return {error: `Minimum bet is $${game.currentBet - game.playerBets[username]} to call`};
        }
        clearTurnTimer(game);
        game.acted[username] = true;
        game.bet = amount;
        game.currentBet = Math.max(game.currentBet, game.playerBets[username] + amount);
        game.playerBets[username] += amount;
        game.contributions[username] += amount;
        game.stacks[username] -= amount;
        game.pot += amount;
        game.lastBettor = username;
        game.lastAction = `${username} bet $${amount}`;
        advanceTurn(game);
        return {};
    }

    if (action === "fold") {
        clearTurnTimer(game);
        game.folded[username] = true;
        game.acted[username] = true;
        game.lastAction = `${username} folded`;
        advanceTurn(game);
        return {};
    }

    if (action === "hit") {
        const callAmount = getCallAmount(game, username);
        const paidAmount = Math.min(callAmount, game.stacks[username]);
        clearTurnTimer(game);
        if (paidAmount > 0) {
            game.playerBets[username] += paidAmount;
            game.contributions[username] += paidAmount;
            game.stacks[username] -= paidAmount;
            game.pot += paidAmount;
        }
        game.acted[username] = true;
        game.lastAction = paidAmount > 0
            ? `${username} ${paidAmount < callAmount ? "went all-in with" : automatic ? "auto-called" : "called"} $${paidAmount}`
            : `${username} ${automatic ? "auto-checked" : "checked"}`;
        advanceTurn(game);
        return {};
    }

    return {error: "Unknown poker action"};
}

function sendSocketMessage(socket, payload) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
    }
}

function disconnectKey(lobbyId, username) {
    return `${lobbyId}:${username}`;
}

function clearDisconnectTimer(lobbyId, username) {
    const key = disconnectKey(lobbyId, username);
    if (disconnectTimers[key]) {
        clearTimeout(disconnectTimers[key]);
        delete disconnectTimers[key];
    }
}

function hasActiveLobbySocket(lobbyId, username) {
    return [...(lobbySockets[lobbyId] || [])].some(socket => (
        socket.user?.username === username && socket.readyState === WebSocket.OPEN
    ));
}

async function leavePokerLobby(lobbyId, username) {
    if (!lobbyId || !username || !playerMap[lobbyId]?.includes(username)) return false;

    clearDisconnectTimer(lobbyId, username);
    await leaveLobby(lobbyId, username);
    await removePlayerFromPokerGame(lobbyId, username);
    await deleteLobby(lobbyId);
    await setUserLobby(username, null);
    broadcastLobby(lobbyId);
    broadcastPokerState(lobbyId);
    return true;
}

function scheduleDisconnectLeave(lobbyId, username) {
    if (!lobbyId || !username || hasActiveLobbySocket(lobbyId, username)) return;

    clearDisconnectTimer(lobbyId, username);
    disconnectTimers[disconnectKey(lobbyId, username)] = setTimeout(async () => {
        delete disconnectTimers[disconnectKey(lobbyId, username)];
        if (hasActiveLobbySocket(lobbyId, username)) return;

        try {
            await leavePokerLobby(lobbyId, username);
        } catch (error) {
            console.error("Failed to leave disconnected player:", error);
        }
    }, DISCONNECT_GRACE_MS);
}

function subscribeToLobby(socket, lobbyId) {
    if (socket.lobbyId && lobbySockets[socket.lobbyId]) {
        lobbySockets[socket.lobbyId].delete(socket);
    }
    socket.lobbyId = lobbyId;
    if (!lobbySockets[lobbyId]) {
        lobbySockets[lobbyId] = new Set();
    }
    lobbySockets[lobbyId].add(socket);
    clearDisconnectTimer(lobbyId, socket.user.username);
}

function broadcastLobby(lobbyId) {
    if (!lobbyId || !lobbySockets[lobbyId]) return;
    const players = playerMap[lobbyId] || [];
    const gameStarted = Boolean(pokerGames[lobbyId]);
    const message = {
        type: "lobby:state",
        lobbyId,
        players,
        host: lobbyHosts[lobbyId] || players[0] || null,
        isPublic: lobbyPrivacy[lobbyId] !== "private",
        canStart: players.length >= 2,
        gameStarted,
        gameUrl: gameStarted ? `/poker.html?lobbyId=${encodeURIComponent(lobbyId)}` : null
    };
    for (const socket of lobbySockets[lobbyId]) {
        sendSocketMessage(socket, message);
    }
}

function createPublicLobbyList() {
    return Object.entries(playerMap)
        .filter(([lobbyId]) => lobbyPrivacy[lobbyId] !== "private")
        .map(([lobbyId, players]) => ({
            lobbyId,
            host: lobbyHosts[lobbyId] || players[0] || null,
            players: players.length,
            gameStarted: Boolean(pokerGames[lobbyId])
        }));
}

function broadcastToLobby(lobbyId, payload) {
    if (!lobbyId || !lobbySockets[lobbyId]) return;
    for (const socket of lobbySockets[lobbyId]) {
        sendSocketMessage(socket, payload);
    }
}

async function createLobby() {
    let lobbyId;
    do {
        lobbyId = crypto.randomBytes(4).toString("hex");
    } while (playerMap[lobbyId]);
    return lobbyId;
}

app.post("/leave-lobby", authenticateToken, async (req, res) => {
    const {lobbyId} = req.body;
    const username = req.user.username;
    if (!lobbyId || !username) {
        return res.status(400).json({error: "Lobby ID und Username sind erforderlich!"});
    }
    if (!playerMap[lobbyId]) {
        return res.status(404).json({error: "Lobby nicht gefunden!"});
    }
    if (await leavePokerLobby(lobbyId, username)) {
        return res.json({message: `Lobby ${lobbyId} aktualisiert.`});
    }
    return res.status(404).json({error: "User not in lobby"});
});
setInterval(() => removeEmptyLobbies(playerMap), 10000);

function removeEmptyLobbies(playerMap) {
    for (const lobby in playerMap) {
        if (playerMap[lobby].length === 0) {
            deleteLobby(lobby).catch(error => {
                console.error("Failed to delete empty lobby:", error);
            });
            console.log(`Lobby ${lobby} wurde gelöscht.`);
        }
    }
}

async function leaveLobby(id, username) {
    if (id && playerMap[id] && username) {
        const index = playerMap[id].indexOf(username);
        if (index > -1) {
            playerMap[id].splice(index, 1);
            if (lobbyHosts[id] === username) {
                lobbyHosts[id] = playerMap[id][0] || null;
            }
            broadcastLobby(id);
        }
    }
}

async function deleteLobby(id) {
    if (id && playerMap[id]) {
        if (playerMap[id].length === 0) {
            delete playerMap[id];
            delete lobbySockets[id];
            delete lobbyHosts[id];
            delete lobbyPrivacy[id];
            if (pokerGames[id]?.nextRoundTimer) {
                clearTimeout(pokerGames[id].nextRoundTimer);
            }
            clearTurnTimer(pokerGames[id]);
            delete pokerGames[id];
        }
    }
}

async function joinLobby(lobbyId, playerName) {
    if (!lobbyId || !playerName || !playerMap[lobbyId]) return false;
    if (!playerMap[lobbyId].includes(playerName)) {
        playerMap[lobbyId].push(playerName);
    }
    return true;
}

app.get("/lobby/create", authenticateToken, async (req, res) => {
    const username = req.user.username;
    if (!username) {
        return res.status(400).send("Username is required");
    }
    let lobbyId = await createLobby();
    if (!playerMap[lobbyId]) {
        playerMap[lobbyId] = [];
    }
    if (!playerMap[lobbyId].includes(username)) {
        playerMap[lobbyId].push(username);
    }
    lobbyHosts[lobbyId] = username;
    lobbyPrivacy[lobbyId] = req.query.private === "true" ? "private" : "public";
    broadcastLobby(lobbyId);
    await setUserLobby(username, lobbyId);
    res.redirect(`/lobby/join?lobbyId=${lobbyId}&username=${username}`);
})

app.get("/lobby/join", authenticateToken, async (req, res) => {
    let lobbyId = req.query.lobbyId;
    let username = req.user.username;
    const user = await findUserByUsername(username);
    if (!user) {
        return res.status(401).json({error: "User doesn't exist"});
    }
    if (lobbyId in playerMap) {
        await joinLobby(lobbyId, user.username);
        await ensurePlayerInPokerGame(lobbyId, username);
        await maybeStartWaitingGame(lobbyId);
        broadcastLobby(lobbyId);
        broadcastPokerState(lobbyId);
        await setUserLobby(username, lobbyId);
        res.json({lobbyId, username});
    } else {
        console.log("Lobby with " + lobbyId + " not found.");
        return res.status(404).json({error: "Lobby not found"});
    }
});

app.delete("/lobby/leave", authenticateToken, async (req, res) => {
    const lobbyId = req.query.lobbyId;
    const username = req.user.username;
    if (!lobbyId || !username) {
        return res.status(400).json({error: "Missing lobbyId or username"});
    }
    if (lobbyId in playerMap) {
        if (await leavePokerLobby(lobbyId, username)) {
            return res.json({message: "Successfully left lobby"});
        }
        return res.status(404).json({error: "User not in lobby"});
    }
    res.status(404).json({error: "Lobby not found"});
});

app.get("/lobby/players", authenticateToken, async (req, res) => {
    let lobbyId = req.query.lobbyId;
    let players = playerMap[lobbyId] || [];
    res.json({players});
});

app.get("/lobby/public", authenticateToken, async (req, res) => {
    res.json({lobbies: createPublicLobbyList()});
});

wss.on("connection", async (socket, request) => {
    const cookies = parseCookieHeader(request.headers.cookie);
    const token = request.headers.authorization?.split(" ")[1] || cookies.authorization;
    const user = await verifyAuthToken(token);

    if (!user) {
        sendSocketMessage(socket, {type: "auth:error", message: "Authentication failed"});
        socket.close(1008, "Authentication failed");
        return;
    }

    socket.user = user;
    sendSocketMessage(socket, {type: "auth:success", username: user.username});
    const storedUser = await findUserByUsername(user.username);
    if (storedUser?.lobbyId && playerMap[storedUser.lobbyId]?.includes(user.username)) {
        subscribeToLobby(socket, storedUser.lobbyId);
        broadcastLobby(storedUser.lobbyId);
    }

    socket.on("message", async (rawMessage) => {
        let message;
        try {
            message = JSON.parse(rawMessage.toString());
        } catch {
            sendSocketMessage(socket, {type: "error", message: "Invalid JSON message"});
            return;
        }

        try {
            if (message.type === "lobby:create") {
                const lobbyId = await createLobby();
                playerMap[lobbyId] = playerMap[lobbyId] || [];
                if (!playerMap[lobbyId].includes(user.username)) {
                    playerMap[lobbyId].push(user.username);
                }
                lobbyHosts[lobbyId] = user.username;
                lobbyPrivacy[lobbyId] = message.private ? "private" : "public";

                await setUserLobby(user.username, lobbyId);

                subscribeToLobby(socket, lobbyId);
                await ensurePlayerInPokerGame(lobbyId, user.username);
                await maybeStartWaitingGame(lobbyId);
                broadcastLobby(lobbyId);
                broadcastPokerState(lobbyId);
                return;
            }

            if (message.type === "lobby:join") {
                const lobbyId = message.lobbyId;
                if (!lobbyId || !playerMap[lobbyId]) {
                    sendSocketMessage(socket, {type: "lobby:error", message: "Lobby not found"});
                    return;
                }

                await joinLobby(lobbyId, user.username);
                await ensurePlayerInPokerGame(lobbyId, user.username);
                await maybeStartWaitingGame(lobbyId);

                await setUserLobby(user.username, lobbyId);

                subscribeToLobby(socket, lobbyId);
                broadcastLobby(lobbyId);
                broadcastPokerState(lobbyId);
                return;
            }

            if (message.type === "lobby:leave") {
                const lobbyId = message.lobbyId || socket.lobbyId;
                await leavePokerLobby(lobbyId, user.username);
                if (lobbySockets[lobbyId]) {
                    lobbySockets[lobbyId].delete(socket);
                }
                socket.lobbyId = null;
                sendSocketMessage(socket, {type: "lobby:left", lobbyId});
                broadcastPokerState(lobbyId);
                return;
            }

            if (message.type === "poker:start") {
                const lobbyId = message.lobbyId || socket.lobbyId;
                const players = playerMap[lobbyId] || [];
                if (!lobbyId || !playerMap[lobbyId]) {
                    sendSocketMessage(socket, {type: "poker:error", message: "Lobby not found"});
                    return;
                }
                if (lobbyHosts[lobbyId] !== user.username) {
                    sendSocketMessage(socket, {type: "poker:error", message: "Only the lobby host can start the game"});
                    return;
                }
                if (players.length < 2) {
                    sendSocketMessage(socket, {type: "poker:error", message: "At least 2 players are needed to start"});
                    return;
                }

                await createPokerIntermission(lobbyId);
                broadcastLobby(lobbyId);
                broadcastPokerState(lobbyId);
                broadcastToLobby(lobbyId, {
                    type: "poker:started",
                    lobbyId,
                    url: `/poker.html?lobbyId=${encodeURIComponent(lobbyId)}`
                });
                return;
            }

            if (message.type === "poker:join") {
                const lobbyId = message.lobbyId;
                if (!lobbyId || !playerMap[lobbyId] || !playerMap[lobbyId].includes(user.username)) {
                    sendSocketMessage(socket, {type: "poker:error", message: "Poker table not found"});
                    return;
                }

                subscribeToLobby(socket, lobbyId);
                if (!pokerGames[lobbyId]) {
                    await createPokerIntermission(lobbyId);
                }
                await ensurePlayerInPokerGame(lobbyId, user.username);
                await maybeStartWaitingGame(lobbyId);
                broadcastPokerState(lobbyId);
                return;
            }

            if (message.type === "poker:action") {
                if (!socket.lobbyId) {
                    sendSocketMessage(socket, {type: "poker:error", message: "Join a lobby before sending poker actions"});
                    return;
                }
                const game = pokerGames[socket.lobbyId];
                if (!game) {
                    sendSocketMessage(socket, {type: "poker:error", message: "Poker game not found"});
                    return;
                }

                const result = applyPokerAction(game, user.username, message.action, message.payload);
                if (result.error) {
                    sendSocketMessage(socket, {type: "poker:error", message: result.error});
                    return;
                }

                broadcastPokerState(socket.lobbyId);
                return;
            }

            sendSocketMessage(socket, {type: "error", message: "Unknown message type"});
        } catch (error) {
            console.error("WebSocket message error:", error);
            sendSocketMessage(socket, {type: "error", message: "WebSocket request failed"});
        }
    });

    socket.on("close", async () => {
        if (!socket.lobbyId) return;
        const lobbyId = socket.lobbyId;
        if (lobbySockets[lobbyId]) {
            lobbySockets[lobbyId].delete(socket);
        }
        scheduleDisconnectLeave(lobbyId, socket.user.username);
    });
});

initializeDatabase()
    .then(() => {
        server.listen(port, () => {
            console.log("Server is running on port " + port);
        });
    })
    .catch((error) => {
        console.error("Failed to initialize database:", error);
        process.exit(1);
    });
