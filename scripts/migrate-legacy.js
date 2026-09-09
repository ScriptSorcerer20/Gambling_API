const fs = require('node:fs/promises');
const path = require('node:path');
const bcrypt = require('bcrypt');
const {hash, AppError} = require('../lib/core');
const {schemas, matches} = require('../public/protocol');

async function migrateLegacy(repository, filename, rounds = 12) {
    const source = await fs.readFile(filename, 'utf8');
    const users = JSON.parse(source);
    if (!Array.isArray(users)) throw new Error('Legacy file must contain an array');
    const seen = new Set();
    for (const user of users) {
        if (!user || typeof user.username !== 'string' || typeof user.password !== 'string') throw new Error('Each legacy row needs username and password strings');
        const username = user.username.trim().toLowerCase();
        if (!matches(username, schemas.credentials.properties.username) || seen.has(username)) throw new Error('Invalid or duplicate legacy username');
        seen.add(username);
        if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(user.password) && (Buffer.byteLength(user.password, 'utf8') > 72 || !user.password)) throw new Error('Invalid legacy password');
        if (user.money !== undefined && (!Number.isSafeInteger(user.money) || user.money < 0)) throw new Error('Invalid legacy balance');
    }
    const id = `json:${hash(source)}`;
    const backup = `${path.resolve(filename)}.${hash(source).slice(0, 12)}.backup`;
    try { await fs.writeFile(backup, source, {flag: 'wx', mode: 0o600}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (await fs.readFile(backup, 'utf8') !== source) throw new Error('Backup content does not match'); }
    const records = await Promise.all(users.map(async user => ({username: user.username.trim().toLowerCase(), money: user.money ?? 200,
        passwordHash: user.password.startsWith('$2') ? user.password : await bcrypt.hash(user.password, rounds)})));
    return repository.transaction(async tx => {
        if (await tx.get('SELECT id FROM migrations WHERE id = ?', id)) return {imported: 0, alreadyApplied: true, backup};
        for (const user of records) {
            if (await tx.get('SELECT username FROM users WHERE username = ?', user.username)) throw new AppError('MIGRATION_CONFLICT', `Account already exists: ${user.username}`);
            await tx.run('INSERT INTO users(username,password_hash,money) VALUES(?,?,?)', user.username, user.passwordHash, user.money);
            await tx.run('INSERT INTO ledger(command_id,username,delta,reason) VALUES(?,?,?,?)', id, user.username, user.money, 'Legacy import');
        }
        await tx.run('INSERT INTO migrations(id,applied_at) VALUES(?,?)', id, Date.now());
        return {imported: records.length, backup};
    });
}
if (require.main === module) {
    require('dotenv').config();
    const {createRepository} = require('../lib/repository');
    (async () => {
        const filename = process.argv[2];
        if (!filename) throw new Error('Usage: npm run migrate:legacy -- path/to/data.json (stop the server first)');
        const repository = await createRepository(process.env.DATABASE_PATH || path.join(__dirname, '..', 'users.sqlite'));
        try { console.log(await migrateLegacy(repository, filename)); } finally { await repository.close(); }
    })().catch(error => {console.error(error.message); process.exitCode = 1;});
}
module.exports = {migrateLegacy};
