const crypto = require('node:crypto');
class AppError extends Error {
    constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
class KeyedQueue {
    constructor() { this.tails = new Map(); }
    run(keys, task) {
        keys = [...new Set(keys)].sort();
        const previous = keys.map(key => this.tails.get(key) || Promise.resolve());
        const result = Promise.all(previous).then(task);
        const tail = result.catch(() => {});
        for (const key of keys) this.tails.set(key, tail);
        tail.then(() => { for (const key of keys) if (this.tails.get(key) === tail) this.tails.delete(key); });
        return result;
    }
    async drain() { await Promise.all([...this.tails.values()]); }
}
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
}
module.exports = {AppError, KeyedQueue, hash, canonical};
