const sqlite3 = require('sqlite3');
const {open} = require('sqlite');
const {KeyedQueue, AppError} = require('./core');

async function createRepository(filename, {beforeCommit = async () => {}} = {}) {
    const db = await open({filename, driver: sqlite3.Database});
    const queue = new KeyedQueue();
    let release;
    try {
        await db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
        release = await require('./database-lock').acquireDatabaseLock(db);
    } catch (error) {await db.close(); throw error;}
    async function transaction(work) {
        return queue.run(['database'], async () => {
            await db.exec('BEGIN IMMEDIATE');
            try {
                const result = await work(db);
                await beforeCommit();
                await db.exec('COMMIT');
                return result;
            } catch (error) { await db.exec('ROLLBACK'); throw error; }
        });
    }
    try {
        const version = await db.get('PRAGMA user_version');
        const oldUsers = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
        if (version.user_version === 0 && oldUsers && filename !== ':memory:') {
            await db.run('VACUUM INTO ?', `${filename}.${Date.now()}.backup`);
        }
        await transaction(async tx => {
            const {user_version: version} = await tx.get('PRAGMA user_version');
            if (version > 1) throw new Error('Database schema is newer than this application');
            if (version === 1) return;
            const old = await tx.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
            if (old) await tx.exec('ALTER TABLE users RENAME TO legacy_users');
            await tx.exec(`
                CREATE TABLE users (
                    username TEXT PRIMARY KEY COLLATE NOCASE,
                    password_hash TEXT NOT NULL,
                    session_hash TEXT,
                    money INTEGER NOT NULL DEFAULT 200 CHECK(typeof(money) = 'integer' AND money >= 0 AND money <= 9007199254740991)
                );
                CREATE TABLE lobbies (id TEXT PRIMARY KEY, state TEXT NOT NULL);
                CREATE TABLE commands (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL);
                CREATE TABLE ledger (id INTEGER PRIMARY KEY, command_id TEXT NOT NULL, username TEXT NOT NULL REFERENCES users(username), delta INTEGER NOT NULL, reason TEXT NOT NULL);
                CREATE TABLE migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
            `);
            if (old) {
                // Fails and rolls back rather than silently rounding or losing invalid balances.
                await tx.exec('INSERT INTO users(username, password_hash, money) SELECT username, password_hash, money FROM legacy_users; INSERT INTO ledger(command_id,username,delta,reason) SELECT 'schema-v1:' || username, username, money, 'Opening balance migration' FROM users; DROP TABLE legacy_users;');
            }
            await tx.exec('PRAGMA user_version = 1');
        });
    } catch (error) { await release(); await db.close(); throw error; }
    const read = work => queue.run(['database'], () => work(db));
    return {
        transaction,
        user: username => read(tx => tx.get('SELECT username, password_hash AS passwordHash, session_hash AS sessionHash, money FROM users WHERE username = ?', username)),
        users: () => read(tx => tx.all('SELECT username, money FROM users ORDER BY money DESC, username ASC')),
        async register(username, passwordHash, sessionHash) {
            try { await transaction(async tx => {
                await tx.run('INSERT INTO users(username,password_hash,session_hash) VALUES(?,?,?)', username, passwordHash, sessionHash);
                await tx.run('INSERT INTO ledger(command_id,username,delta,reason) VALUES(?,?,200,?)', `register:${username}`, username, 'Starting chips');
            }); }
            catch (error) { if (error.code === 'SQLITE_CONSTRAINT') throw new AppError('USERNAME_EXISTS', 'Username already exists', 409); throw error; }
        },
        setSession: (username, sessionHash) => transaction(tx => tx.run('UPDATE users SET session_hash = ? WHERE username = ?', sessionHash, username)),
        async recover() {
            return transaction(async tx => {
                const rows = await tx.all('SELECT id,state FROM lobbies');
                for (const row of rows) {
                    const lobby = JSON.parse(row.state);
                    if (lobby.game?.phase !== 'betting') continue;
                    for (const [username, amount] of Object.entries(lobby.game.contributions)) {
                        if (!amount) continue;
                        await tx.run('UPDATE users SET money = money + ? WHERE username = ?', amount, username);
                        await tx.run('INSERT INTO ledger(command_id,username,delta,reason) VALUES(?,?,?,?)', `recovery:${lobby.game.id}`, username, amount, 'Interrupted hand refund');
                    }
                }
                await tx.run('DELETE FROM lobbies');
            });
        },
        command: id => read(tx => tx.get('SELECT fingerprint,result FROM commands WHERE id = ?', id)),
        async commit({id, fingerprint, lobby, deltas, result, reason}) {
            return transaction(async tx => {
                const prior = await tx.get('SELECT fingerprint,result FROM commands WHERE id = ?', id);
                if (prior) {
                    if (prior.fingerprint !== fingerprint) throw new AppError('IDEMPOTENCY_CONFLICT', 'Request ID was reused for a different command', 409);
                    return {duplicate: true, result: JSON.parse(prior.result)};
                }
                for (const [username, amount] of Object.entries(deltas)) {
                    if (!Number.isSafeInteger(amount)) throw new Error('Invalid ledger delta');
                    if (!amount) continue;
                    const updated = await tx.run('UPDATE users SET money = money + ? WHERE username = ? AND money + ? >= 0', amount, username, amount);
                    if (updated.changes !== 1) throw new AppError('INSUFFICIENT_CHIPS', 'Insufficient chips', 409);
                    await tx.run('INSERT INTO ledger(command_id,username,delta,reason) VALUES(?,?,?,?)', id, username, amount, reason);
                }
                if (lobby.players.length) await tx.run('INSERT INTO lobbies(id,state) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state', lobby.id, JSON.stringify(lobby));
                else await tx.run('DELETE FROM lobbies WHERE id = ?', lobby.id);
                await tx.run('INSERT INTO commands(id,fingerprint,result,created_at) VALUES(?,?,?,?)', id, fingerprint, JSON.stringify(result), Date.now());
                return {duplicate: false, result};
            });
        },
        totals: () => read(async tx => ({users: (await tx.get('SELECT COALESCE(SUM(money),0) AS total FROM users')).total,
            escrow: (await tx.all('SELECT state FROM lobbies')).reduce((sum, row) => sum + (JSON.parse(row.state).game?.pot || 0), 0)})),
        close: async () => { await queue.drain(); await release(); await db.close(); }
    };
}
module.exports = {createRepository};
