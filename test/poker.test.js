const {test} = require("node:test");
const assert = require("node:assert/strict");
const {createDeck, evaluateBestHand, compareScores, calculatePayouts} = require("../lib/poker");
const cards = text => text.split(" ").map(card => ({rank: card.slice(0, -1), suit: card.slice(-1)}));

test("deck contains 52 distinct cards", () => {
    for (let i = 0; i < 20; i++) {
        const deck = createDeck();
        assert.equal(deck.length, 52);
        assert.equal(new Set(deck.map(card => card.rank + card.suit)).size, 52);
    }
});
test("evaluates wheel, royal flush, and best full house from seven cards", () => {
    assert.deepEqual(evaluateBestHand(cards("AS 2H 3D 4C 5S KH QD")).score, [4, 5]);
    assert.deepEqual(evaluateBestHand(cards("AS KS QS JS 10S 2H 3D")).score, [9, 14]);
    assert.deepEqual(evaluateBestHand(cards("AS AH AD KS KH KD 2D")).score, [6, 14, 13]);
    assert.ok(compareScores([1, 10, 14, 8, 7], [1, 10, 13, 12, 11]) > 0);
});
test("short all-in wins only main pot; remaining players contest side pot", () => {
    const payouts = calculatePayouts({a: 20, b: 100, c: 100}, [
        {player: "a", result: {score: [8]}},
        {player: "b", result: {score: [4]}},
        {player: "c", result: {score: [1]}}
    ], ["a", "b", "c"]);
    assert.deepEqual({...payouts}, {a: 60, b: 160});
});
test("folded contributions count, ties preserve every chip, unmatched bets return", () => {
    const payouts = calculatePayouts({a: 5, b: 5, folded: 5}, [
        {player: "a", result: {score: [1, 14]}},
        {player: "b", result: {score: [1, 14]}}
    ], ["b", "a"]);
    assert.deepEqual({...payouts}, {b: 8, a: 7});
    assert.deepEqual({...calculatePayouts({a: 20, b: 100}, [
        {player: "a", result: {score: [8]}}, {player: "b", result: {score: [1]}}
    ], ["a", "b"])}, {a: 40, b: 80});
});
