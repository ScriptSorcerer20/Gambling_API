const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('node:path');
const swaggerUi = require('swagger-ui-express');
const {AppError} = require('./core');
const {tokenFrom} = require('./transport');
const {validate} = require('../public/protocol');
function createHttpApp(repository, sessions, lobbies, config) {
    const app = express();
    app.disable('x-powered-by'); app.set('trust proxy', config.trustProxy);
    app.use(express.json({limit: '16kb'})); app.use(cookieParser());
    app.use((req, res, next) => {
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Referrer-Policy', 'same-origin');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
            const origin = config.origin || `${req.protocol}://${req.get('host')}`;
            if (req.headers.origin !== origin) return res.status(403).json({code: 'ORIGIN_DENIED', error: 'Origin denied'});
        }
        next();
    });
    const attempts = new Map();
    function rateLimit(req, res, next) {
        const now = config.now();
        for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
        const key = req.ip;
        if (!attempts.has(key)) {
            if (attempts.size >= 10000) return res.status(503).json({code: 'BUSY', error: 'Try again later'});
            attempts.set(key, {count: 0, until: now + config.authWindowMs});
        }
        const record = attempts.get(key);
        if (++record.count > config.authLimit) {
            res.set('Retry-After', String(Math.ceil((record.until - now) / 1000)));
            return res.status(429).json({code: 'RATE_LIMITED', error: 'Too many authentication attempts'});
        }
        next();
    }
    const cookie = req => ({httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/', maxAge: config.sessionSeconds * 1000});
    const authorized = handler => async (req, res) => sessions.authorized(tokenFrom(req), user => handler(req, res, user));
    for (const method of ['register', 'login']) app.post(`/${method}`, rateLimit, async (req, res) => {
        const result = await sessions[method](req.body);
        res.cookie('authorization', result.token, cookie(req)); res.set('Cache-Control', 'no-store'); res.json(result);
    });
    app.post('/verify', authorized((req, res, user) => res.json({valid: true, user})));
    app.delete('/logout', authorized(async (req, res, user) => {
        const lobby = lobbies.membership(user.username);
        if (lobby) await lobbies.command(user.username, {type: 'lobby:leave', lobbyId: lobby.id, requestId: require('node:crypto').randomUUID()});
        await sessions.revoke(user.username);
        const options = cookie(req); delete options.maxAge;
        res.clearCookie('authorization', options); res.json({message: 'Logged out'});
    }));
    app.get('/balance', authorized(async (req, res, user) => res.json({balance: (await repository.user(user.username)).money})));
    app.get('/leaderboard', authorized(async (req, res, user) => {
        const users = await repository.users(); const index = users.findIndex(entry => entry.username === user.username);
        res.json({leaderboard: users.slice(0, 10), self: {...users[index], position: index + 1}});
    }));
    app.post('/easter-egg', authorized(async (req, res, user) => {
        const code = req.body?.code;
        if (!['ILIKEMONEY', 'FRETUX', 'KRISHD', 'LOSERNOOB'].includes(code)) throw new AppError('INVALID_EASTER_EGG', 'Unknown terminal command.', 400);
        res.json(await repository.redeemEasterEgg(user.username, code));
    }));
    for (const [route, type] of [['/lobby/create', 'lobby:create'], ['/lobby/join', 'lobby:join'], ['/lobby/leave', 'lobby:leave'], ['/poker/start', 'poker:start'], ['/poker/action', 'poker:action']]) {
        app.post(route, authorized(async (req, res, user) => {
            const message = {...req.body, type};
            const invalid = validate(message);
            if (invalid) throw new AppError('INVALID_MESSAGE', invalid);
            res.json(await lobbies.command(user.username, message));
        }));
        app.get(route, (req, res) => res.set('Allow', 'POST').status(405).json({code: 'METHOD_NOT_ALLOWED', error: 'Use POST with a requestId'}));
    }
    app.get('/lobby/public', authorized((req, res) => res.json({lobbies: lobbies.publicList()})));
    app.get('/lobby/players', authorized((req, res, user) => {
        const lobby = lobbies.get(req.query.lobbyId);
        if (!lobby?.players.includes(user.username)) throw new AppError('NOT_SEATED', 'Join this lobby first', 403);
        res.json({players: lobby.players});
    }));
    const publicPath = path.join(__dirname, '..', 'public');
    app.get(['/', '/home.html', '/poker.html'], async (req, res) => {
        if (!await sessions.verify(tokenFrom(req))) return res.redirect('/login');
        res.set('Cache-Control', 'no-store');
        res.sendFile(path.join(publicPath, req.path === '/poker.html' ? 'poker.html' : 'home.html'));
    });
    app.get('/login', (req, res) => res.sendFile(path.join(publicPath, 'login.html')));
    app.use('/swagger-ui', swaggerUi.serve, swaggerUi.setup(require('../swagger.json')));
    app.use(express.static(publicPath, {index: false}));
    app.use((req, res) => res.status(404).json({code: 'NOT_FOUND', error: 'Not found'}));
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        const status = error.status >= 400 && error.status < 600 ? error.status : 500;
        if (status === 500) console.error('Request failed:', error);
        res.status(status).json({code: error.code || (status === 500 ? 'INTERNAL_ERROR' : 'INVALID_BODY'), error: status === 500 ? 'Internal server error' : error.message});
    });
    return app;
}
module.exports = {createHttpApp};
