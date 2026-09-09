const {test} = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../lib/engine');
const config = {ante: 10, now: () => 100, turnMs: 30000, intermissionMs: 30000};
function game(stacks = {a: 200, b: 200, c: 200}) {return engine.deal(Object.keys(stacks), stacks, config);}
function act(g, kind, amount) {engine.action(g, engine.turn(g), kind, amount, config);}
test('complete checked hand conserves all chips and reveals exactly five board cards', () => {
    const g = game();
    for (let i = 0; i < 20 && g.phase === 'betting'; i++) act(g, 'hit');
    assert.equal(g.phase, 'intermission'); assert.equal(g.communityCards.length, 5);
    assert.equal(Object.values(g.stacks).reduce((a,b) => a+b,0), 600); assert.equal(g.pot, 0);
});
test('short all-in does not reopen raising for an earlier actor', () => {
    const g = game({a: 200, b: 200, c: 25});
    assert.equal(engine.turn(g), 'b'); act(g, 'bet', 10);
    assert.equal(engine.turn(g), 'c'); act(g, 'bet', 15);
    assert.equal(engine.turn(g), 'a'); act(g, 'hit');
    assert.equal(engine.turn(g), 'b');
    assert.throws(() => act(g, 'bet', 20), error => error.code === 'RAISE_NOT_REOPENED');
    act(g, 'hit'); assert.equal(g.street, 'flop');
});
test('minimum raise and whole-chip validation do not change state on failure', () => {
    const g = game(); act(g, 'bet', 20);
    const before = JSON.stringify(g);
    for (const amount of [21, 0.5, '20', -1, Infinity]) assert.throws(() => act(g, 'bet', amount));
    assert.equal(JSON.stringify(g), before);
});
test('timeout folds facing a bet and checks for free', () => {
    const g = game(); act(g, 'bet', 20);
    const player = engine.turn(g), stack = g.stacks[player];
    act(g, 'timeout'); assert.equal(g.stacks[player], stack); assert.equal(g.folded[player], true);
    const free = game(); act(free, 'timeout'); assert.equal(free.folded.b, false); assert.equal(free.stacks.b, 190);
});
test('ante-only all-ins run out immediately and settlement pays exactly the pot', () => {
    const g = game({a: 10, b: 10}); assert.equal(g.phase, 'intermission');
    assert.equal(g.communityCards.length, 5); assert.equal(g.stacks.a + g.stacks.b, 20);
});
test('leaving preserves seat order and refunds unclaimable contribution layers', () => {
    const g = game(); const current = engine.turn(g); engine.leave(g, 'a', config);
    assert.equal(engine.turn(g), current); engine.leave(g, 'b', config);
    assert.equal(g.phase, 'intermission'); assert.equal(Object.values(g.stacks).reduce((a,b) => a+b,0), 600);
});
