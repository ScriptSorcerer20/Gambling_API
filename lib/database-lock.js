const crypto = require('node:crypto');
// Claim ownership inside a SQLite transaction, including replacement of a dead PID.
// This avoids races between two processes attempting crash recovery at once.
async function acquireDatabaseLock(db) {
    const token = crypto.randomUUID();
    await db.exec('BEGIN IMMEDIATE');
    try {
        await db.exec('CREATE TABLE IF NOT EXISTS runtime_owner (id INTEGER PRIMARY KEY CHECK(id = 1), pid INTEGER NOT NULL, token TEXT NOT NULL)');
        const owner = await db.get('SELECT pid FROM runtime_owner WHERE id = 1');
        if (owner) {
            if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error('Invalid database owner');
            try {process.kill(owner.pid, 0); throw new Error(`Database is in use by process ${owner.pid}`);}
            catch (error) {if (error.code !== 'ESRCH') throw error;}
        }
        await db.run('INSERT INTO runtime_owner(id,pid,token) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET pid=excluded.pid,token=excluded.token', process.pid, token);
        await db.exec('COMMIT');
    } catch (error) {await db.exec('ROLLBACK'); throw error;}
    return () => db.run('DELETE FROM runtime_owner WHERE id = 1 AND token = ?', token);
}
module.exports = {acquireDatabaseLock};
