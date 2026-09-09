const path = require('node:path');
function configuration(overrides = {}) {
    const config = {
        port: Number(process.env.PORT || 42069),
        host: process.env.HOST || '127.0.0.1',
        databasePath: process.env.DATABASE_PATH || path.join(__dirname, '..', 'users.sqlite'),
        secret: process.env.TOKEN_SECRET,
        origin: process.env.PUBLIC_ORIGIN || null,
        trustProxy: process.env.TRUST_PROXY ? process.env.TRUST_PROXY.split(',').map(value => value.trim()) : false,
        sessionSeconds: 1800, bcryptRounds: 12, ante: 10,
        intermissionMs: 30000, turnMs: 30000, disconnectMs: 10000,
        heartbeatMs: 30000, maxConnections: 200, maxConnectionsPerIp: 10,
        authLimit: 20, authWindowMs: 15 * 60 * 1000, messageLimit: 30,
        now: Date.now, ...overrides
    };
    if (typeof config.secret !== 'string' || config.secret.length < 32) throw new Error('TOKEN_SECRET must contain at least 32 characters');
    if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('Invalid PORT');
    if (config.origin && new URL(config.origin).origin !== config.origin) throw new Error('PUBLIC_ORIGIN must be an origin without a trailing slash');
    return config;
}
module.exports = {configuration};
