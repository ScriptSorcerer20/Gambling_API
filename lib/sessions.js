const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const {EventEmitter} = require('node:events');
const {AppError, KeyedQueue, hash} = require('./core');
const {schemas, matches} = require('../public/protocol');
function createSessionService(repository, config) {
    const events = new EventEmitter();
    const queue = new KeyedQueue();
    let dummyHash;
    function credentials(body) {
        if (!matches(body, schemas.credentials) || Buffer.byteLength(body.password, 'utf8') > 72) throw new AppError('INVALID_CREDENTIALS', 'Username must be 1-40 characters; password must be 1-72 UTF-8 bytes');
        const username = body.username.trim().toLowerCase();
        if (!username) throw new AppError('INVALID_CREDENTIALS', 'Username is required');
        return {username, password: body.password};
    }
    function issue(username) { return jwt.sign({username}, config.secret, {algorithm: 'HS256', expiresIn: config.sessionSeconds, jwtid: crypto.randomUUID()}); }
    async function verify(token) {
        try {
            if (typeof token !== 'string') return null;
            const decoded = jwt.verify(token, config.secret, {algorithms: ['HS256']});
            if (typeof decoded.username !== 'string') return null;
            const user = await repository.user(decoded.username);
            if (!user?.sessionHash || user.sessionHash !== hash(token)) return null;
            return {username: user.username, exp: decoded.exp};
        } catch (error) {
            if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError || error instanceof jwt.NotBeforeError) return null;
            throw error;
        }
    }
    return {events, verify,
        async register(body) {
            const {username, password} = credentials(body);
            return queue.run([username], async () => {
                const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
                const token = issue(username);
                await repository.register(username, passwordHash, hash(token));
                return {username, token};
            });
        },
        async login(body) {
            const {username, password} = credentials(body);
            return queue.run([username], async () => {
                const user = await repository.user(username);
                dummyHash ||= bcrypt.hash('invalid-account-placeholder', config.bcryptRounds);
                const valid = await bcrypt.compare(password, user?.passwordHash || await dummyHash);
                if (!user || !valid) throw new AppError('INVALID_CREDENTIALS', 'Invalid credentials', 401);
                const token = issue(user.username);
                await repository.setSession(user.username, hash(token));
                events.emit('revoked', user.username);
                return {username: user.username, token};
            });
        },
        async authorized(token, work) {
            const decoded = typeof token === 'string' ? jwt.decode(token) : null;
            if (typeof decoded?.username !== 'string') throw new AppError('UNAUTHORIZED', 'Please sign in', 401);
            return queue.run([decoded.username], async () => {
                const user = await verify(token);
                if (!user) throw new AppError('UNAUTHORIZED', 'Session expired or revoked', 401);
                return work(user);
            });
        },
        async revoke(username) { await repository.setSession(username, null); events.emit('revoked', username); },
        close: () => queue.drain()
    };
}
module.exports = {createSessionService};
