const {test} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const crypto = require('node:crypto');
const {WebSocket} = require('ws');
const {createApplication} = require('../gambling');
const {parseCookies} = require('../lib/transport');
const secret = 'test-secret-with-at-least-thirty-two-characters';
function nextMessage(socket, type) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {socket.off('message', listener); reject(new Error(`Timeout waiting for ${type}`));}, 3000);
        const listener = raw => {const message = JSON.parse(raw); if (message.type !== type) return; clearTimeout(timeout); socket.off('message', listener); resolve(message);};
        socket.on('message', listener);
    });
}
async function fixture(t, options = {}) {
    const api = await createApplication({secret, databasePath: ':memory:', bcryptRounds: 4, intermissionMs: 60000, ...options});
    await api.listen(0); t.after(() => api.close());
    const base = `http://127.0.0.1:${api.server.address().port}`;
    const request = async (route, {token, method = 'GET', body, headers = {}} = {}) => fetch(base + route, {method, redirect: 'manual',
        headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), ...(body !== undefined ? {'Content-Type': 'application/json'} : {}), ...headers},
        body: body === undefined ? undefined : JSON.stringify(body)});
    return {api, base, request};
}
test('HTTP contract, sessions, origin checks, and socket lifecycle', async t => {
    const {api, base, request} = await fixture(t);
    assert.equal((await request('/balance')).status, 401);
    assert.equal((await request('/poker.html')).status, 302);
    assert.equal((await request('/register', {method: 'POST'})).status, 400);
    assert.equal((await request('/lobby/create')).status, 405);
    const registered = await request('/register', {method: 'POST', body: {username: '__proto__', password: 'password'}});
    const {token} = await registered.json();
    assert.equal(registered.status, 200);
    assert.match(registered.headers.get('set-cookie'), /HttpOnly/);
    assert.notEqual((await api.repository.user('__proto__')).sessionHash, token);
    assert.equal((await request('/lobby/create', {method: 'POST', token, headers: {Origin: 'https://evil.invalid'}, body: {requestId: crypto.randomUUID()}})).status, 403);
    const bob = await api.sessions.register({username: 'bob', password: 'password'});
    const socket = new WebSocket(base.replace('http', 'ws'), {headers: {Authorization: `Bearer ${token}`, Cookie: 'bad=%ZZ'}});
    await nextMessage(socket, 'auth:success');
    let pending = nextMessage(socket, 'command:ack');
    socket.send(JSON.stringify({type: 'lobby:create', requestId: crypto.randomUUID()}));
    const created = await pending;
    assert.equal(created.commandType, 'lobby:create');
    assert.equal((await request('/lobby/join', {method: 'POST', token: bob.token, body: {lobbyId: created.lobbyId, requestId: crypto.randomUUID()}})).status, 200);
    const start = {type: 'poker:start', lobbyId: created.lobbyId, requestId: crypto.randomUUID()};
    pending = nextMessage(socket, 'command:ack'); socket.send(JSON.stringify(start)); await pending;
    pending = nextMessage(socket, 'error'); socket.send(JSON.stringify({...start, requestId: crypto.randomUUID()}));
    assert.equal((await pending).code, 'GAME_STARTED');
    pending = nextMessage(socket, 'error'); socket.send('null'); assert.equal((await pending).code, 'INVALID_MESSAGE');
    const closed = once(socket, 'close');
    await request('/logout', {method: 'DELETE', token});
    assert.equal((await closed)[0], 1008);
    assert.equal((await request('/balance', {token})).status, 401);
});
test('login rotation immediately closes old sockets; proxy headers are untrusted by default', async t => {
    const {api, base, request} = await fixture(t);
    const user = await api.sessions.register({username: 'alice', password: 'password'});
    const socket = new WebSocket(base.replace('http', 'ws'), {headers: {Authorization: `Bearer ${user.token}`}});
    await nextMessage(socket, 'auth:success');
    const closed = once(socket, 'close');
    const response = await request('/login', {method: 'POST', headers: {'X-Forwarded-Proto': 'https'}, body: {username: 'ALICE', password: 'password'}});
    assert.equal(response.status, 200); assert.doesNotMatch(response.headers.get('set-cookie'), /; Secure/);
    assert.equal((await closed)[0], 1008);
    assert.equal(await api.sessions.verify(user.token), null);
});
test('authentication is rate limited and cookies tolerate invalid escapes', async t => {
    const {request} = await fixture(t, {authLimit: 2});
    for (let index = 0; index < 2; index++) assert.equal((await request('/login', {method: 'POST', body: {username: 'missing', password: 'password'}})).status, 401);
    const limited = await request('/login', {method: 'POST', body: {username: 'missing', password: 'password'}});
    assert.equal(limited.status, 429); assert.ok(limited.headers.has('retry-after'));
    assert.equal(parseCookies('bad=%ZZ; authorization=ok').authorization, 'ok');
});
test('easter egg credits are server-authoritative and single-use except matrix color', async t => {
    const {request} = await fixture(t);
    const {token} = await (await request('/register', {method: 'POST', body: {username: 'agent42', password: 'password'}})).json();
    const redeem = code => request('/easter-egg', {method: 'POST', token, body: {code}});
    assert.deepEqual(await (await redeem('ILIKEMONEY')).json(), {balance: 1200, effect: 'credits'});
    assert.equal((await redeem('ILIKEMONEY')).status, 409);
    assert.deepEqual(await (await redeem('FRETUX')).json(), {balance: 2400, effect: 'credits'});
    assert.deepEqual(await (await redeem('KRISHD')).json(), {balance: 12000, effect: 'credits'});
    assert.equal((await redeem('LOSERNOOB')).status, 200);
    assert.equal((await redeem('LOSERNOOB')).status, 200);
});
test('socket expires without waiting for a client message', async t => {
    const {api, base} = await fixture(t, {sessionSeconds: 1});
    const {token} = await api.sessions.register({username: 'alice', password: 'password'});
    const socket = new WebSocket(base.replace('http', 'ws'), {headers: {Authorization: `Bearer ${token}`}});
    const closed = once(socket, 'close');
    await nextMessage(socket, 'auth:success');
    assert.equal((await closed)[0], 1008);
});
test('WebSocket rejects cross-origin upgrades', async t => {
    const {api, base} = await fixture(t);
    const {token} = await api.sessions.register({username: 'alice', password: 'password'});
    const socket = new WebSocket(base.replace('http', 'ws'), {headers: {Authorization: `Bearer ${token}`, Origin: 'https://evil.invalid'}});
    socket.on('error', () => {});
    const [, response] = await once(socket, 'unexpected-response');
    assert.equal(response.statusCode, 403); response.resume(); socket.terminate();
});
module.exports = {fixture};
