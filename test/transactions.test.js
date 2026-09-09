const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createApplication} = require('../gambling');
const {createRepository} = require('../lib/repository');
const {createLobbyService} = require('../lib/lobbies');
const secret = 'test-secret-with-at-least-thirty-two-characters';
const command = (service, username, type, fields = {}) => service.command(username, {type, requestId: crypto.randomUUID(), ...fields});
async function setup(t, overrides = {}) {
    let now = 100000;
    const api = await createApplication({secret, databasePath: ':memory:', bcryptRounds: 4, now: () => now, intermissionMs: 60000, ...overrides});
    t.after(() => api.close());
    for (const username of ['a','b','c']) await api.sessions.register({username, password: 'password'});
    if (overrides.startingBalances) await api.repository.transaction(async tx => {
        for (const [username, money] of Object.entries(overrides.startingBalances)) await tx.run('UPDATE users SET money = ? WHERE username = ?', money, username);
    });
    const {lobbyId} = await command(api.lobbies, 'a', 'lobby:create');
    for (const username of ['b','c']) await command(api.lobbies, username, 'lobby:join', {lobbyId});
    await command(api.lobbies, 'a', 'poker:start', {lobbyId});
    const intermission = api.lobbies.get(lobbyId).game; now = intermission.nextRoundStartsAt;
    await command(api.lobbies, null, 'timer', {lobbyId, handId: intermission.id, phase: 'intermission', deadline: now});
    return {api, lobbyId};
}
test('accepted actions persist once; failed commits leave both memory and database unchanged', async t => {
    let fail = false;
    const {api, lobbyId} = await setup(t, {repositoryHooks: {beforeCommit: async () => {if (fail) {fail = false; throw new Error('Injected disk failure');}}}});
    const message = {type: 'poker:action', lobbyId, requestId: crypto.randomUUID(), action: 'bet', payload: {amount: 20}};
    const before = JSON.stringify(api.lobbies.get(lobbyId)); fail = true;
    await assert.rejects(api.lobbies.command('b', message), /Injected/);
    assert.equal(JSON.stringify(api.lobbies.get(lobbyId)), before);
    assert.equal((await api.repository.user('b')).money, 190);
    const reordered = {payload: message.payload, action: message.action, requestId: message.requestId, lobbyId: message.lobbyId, type: message.type};
    await Promise.all([api.lobbies.command('b', message), api.lobbies.command('b', reordered)]);
    assert.equal((await api.repository.user('b')).money, 170);
    assert.equal(api.lobbies.get(lobbyId).game.pot, 50);
    await assert.rejects(api.lobbies.command('b', {...message, action: 'fold'}), error => error.code === 'IDEMPOTENCY_CONFLICT');
    assert.deepEqual(await api.repository.totals(), {users: 550, escrow: 50});
});
test('concurrent account joins and table starts serialize; simultaneous leaves conserve chips', async t => {
    const {api, lobbyId} = await setup(t);
    const results = await Promise.allSettled([command(api.lobbies, 'a', 'lobby:create'), command(api.lobbies, 'a', 'poker:start', {lobbyId})]);
    assert.ok(results.every(result => result.status === 'rejected'));
    await Promise.all(['a', 'b', 'c'].map(username => command(api.lobbies, username, 'lobby:leave', {lobbyId})));
    assert.deepEqual(await api.repository.totals(), {users: 600, escrow: 0}); assert.equal(api.lobbies.get(lobbyId), undefined);
});
test('stale timer cannot act on a new turn', async t => {
    const {api, lobbyId} = await setup(t);
    const original = api.lobbies.get(lobbyId);
    const game = original.game;
    await command(api.lobbies, 'b', 'poker:action', {lobbyId, action: 'hit'});
    const before = JSON.stringify(api.lobbies.get(lobbyId));
    await command(api.lobbies, null, 'timer', {lobbyId, handId: game.id, phase: 'betting', deadline: game.turnEndsAt, revision: original.revision});
    assert.equal(JSON.stringify(api.lobbies.get(lobbyId)), before);
});
test('unequal all-ins settle correct side pots atomically even after a settlement write fails', async t => {
    let fail = false;
    const draws = 'AS AH KS KH QS QH 2D 3C 7S 8H 9D'.split(' ').map(value => ({rank:value.slice(0,-1),suit:value.slice(-1)}));
    const {api, lobbyId} = await setup(t, {startingBalances:{a:60,b:200,c:100}, createDeck:()=>[
        ...require('../lib/poker').createDeck().filter(card=>!draws.some(d=>d.rank===card.rank && d.suit===card.suit)), ...draws.toReversed()
    ], repositoryHooks:{beforeCommit:async()=>{if(fail){fail=false;throw new Error('Settlement disk failure');}}}});
    await command(api.lobbies,'b','poker:action',{lobbyId,action:'bet',payload:{amount:190}});
    await command(api.lobbies,'c','poker:action',{lobbyId,action:'hit'});
    const message={type:'poker:action',lobbyId,requestId:crypto.randomUUID(),action:'hit'};
    fail=true;
    await assert.rejects(api.lobbies.command('a',message),/Settlement disk failure/);
    assert.equal(api.lobbies.get(lobbyId).game.phase,'betting');
    assert.deepEqual(await api.repository.totals(),{users:50,escrow:310});
    await api.lobbies.command('a',message);
    await api.lobbies.command('a',message);
    const game=api.lobbies.get(lobbyId).game;
    assert.equal(game.phase,'intermission');
    assert.deepEqual({...game.payouts},{a:180,b:180});
    for(const username of ['a','b','c']) assert.equal((await api.repository.user(username)).money,game.stacks[username]);
    assert.deepEqual(await api.repository.totals(),{users:360,escrow:0});
});
test('reopening a database refunds interrupted escrow exactly once', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gambling-recovery-'));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const filename = path.join(directory, 'test.sqlite');
    const repo = await createRepository(filename);
    for (const username of ['a','b']) await repo.register(username, 'unused-test-hash', null);
    let now = 1;
    const service = createLobbyService(repo, {ante: 10, intermissionMs: 60000, turnMs: 30000, now: () => now});
    const {lobbyId} = await command(service, 'a', 'lobby:create');
    await command(service, 'b', 'lobby:join', {lobbyId}); await command(service, 'a', 'poker:start', {lobbyId});
    const game = service.get(lobbyId).game; now = game.nextRoundStartsAt;
    await command(service, null, 'timer', {lobbyId, handId: game.id, phase: 'intermission', deadline: now});
    await command(service, 'b', 'poker:action', {lobbyId, action: 'bet', payload: {amount: 30}});
    assert.deepEqual(await repo.totals(), {users: 350, escrow: 50});
    await service.close(); await repo.close();
    const restarted = await createRepository(filename);
    try {
        await restarted.recover(); await restarted.recover();
        assert.deepEqual(await restarted.totals(), {users: 400, escrow: 0});
        assert.equal((await restarted.user('a')).money, 200); assert.equal((await restarted.user('b')).money, 200);
    } finally {await restarted.close();}
});
test('account membership and host starts serialize even when requests arrive together', async t => {
    const api = await createApplication({secret,databasePath:':memory:',bcryptRounds:4,intermissionMs:60000});
    t.after(()=>api.close());
    for(const username of ['a','b']) await api.sessions.register({username,password:'password'});
    const creates=await Promise.allSettled([command(api.lobbies,'a','lobby:create'),command(api.lobbies,'a','lobby:create')]);
    assert.equal(creates.filter(item=>item.status==='fulfilled').length,1);
    const {lobbyId}=creates.find(item=>item.status==='fulfilled').value;
    await command(api.lobbies,'b','lobby:join',{lobbyId});
    const starts=await Promise.allSettled([command(api.lobbies,'a','poker:start',{lobbyId}),command(api.lobbies,'a','poker:start',{lobbyId})]);
    assert.equal(starts.filter(item=>item.status==='fulfilled').length,1);
});
test('a departure waits for an in-flight action commit and cannot overwrite its balance', async t => {
    let pause=null;
    const {api,lobbyId}=await setup(t,{repositoryHooks:{beforeCommit:async()=>{if(pause) await pause();}}});
    let reached,release;
    const entered=new Promise(resolve=>{reached=resolve;});
    const gate=new Promise(resolve=>{release=resolve;});
    pause=async()=>{reached();await gate;};
    const action=command(api.lobbies,'b','poker:action',{lobbyId,action:'bet',payload:{amount:20}});
    await entered;
    const departure=command(api.lobbies,'b','lobby:leave',{lobbyId});
    pause=null;release();
    await Promise.all([action,departure]);
    assert.equal((await api.repository.user('b')).money,170);
    assert.equal(api.lobbies.get(lobbyId).game.contributions.b,30);
    const totals=await api.repository.totals();assert.equal(totals.users+totals.escrow,600);
});
