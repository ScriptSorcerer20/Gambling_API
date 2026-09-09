const {randomInt} = require("node:crypto");

function getRankValue(rank) {
    return {A: 14, K: 13, Q: 12, J: 11, "10": 10, "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2}[rank] || 0;
}

function getCombinations(cards, size, start = 0, current = [], result = []) {
    if (current.length === size) {
        result.push([...current]);
        return result;
    }

    for (let index = start; index < cards.length; index++) {
        current.push(cards[index]);
        getCombinations(cards, size, index + 1, current, result);
        current.pop();
    }
    return result;
}

function compareScores(a, b) {
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
        const diff = (a[index] || 0) - (b[index] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

function evaluateFiveCardHand(cards) {
    const values = cards.map(card => getRankValue(card.rank)).sort((a, b) => b - a);
    const suits = cards.map(card => card.suit);
    const isFlush = suits.every(suit => suit === suits[0]);
    const uniqueValues = [...new Set(values)].sort((a, b) => b - a);
    const straightValues = uniqueValues.includes(14)
        ? [...uniqueValues, 1]
        : uniqueValues;
    let straightHigh = 0;

    for (let index = 0; index <= straightValues.length - 5; index++) {
        const run = straightValues.slice(index, index + 5);
        if (run[0] - run[4] === 4) {
            straightHigh = run[0];
            break;
        }
    }

    const counts = values.reduce((acc, value) => {
        acc[value] = (acc[value] || 0) + 1;
        return acc;
    }, {});
    const groups = Object.entries(counts)
        .map(([value, count]) => ({value: Number(value), count}))
        .sort((a, b) => b.count - a.count || b.value - a.value);

    const sortedCards = [...cards].sort((a, b) => getRankValue(b.rank) - getRankValue(a.rank));

    if (isFlush && straightHigh === 14) return {rank: 9, name: "Royal Flush", score: [9, 14], comboCards: sortedCards};
    if (isFlush && straightHigh) return {rank: 8, name: "Straight Flush", score: [8, straightHigh], comboCards: sortedCards};
    if (groups[0].count === 4) {
        const comboCards = [
            ...sortedCards.filter(card => getRankValue(card.rank) === groups[0].value),
            ...sortedCards.filter(card => getRankValue(card.rank) !== groups[0].value).slice(0, 1)
        ];
        return {rank: 7, name: "Four of a Kind", score: [7, groups[0].value, groups[1].value], comboCards};
    }
    if (groups[0].count === 3 && groups[1].count === 2) {
        const comboCards = [
            ...sortedCards.filter(card => getRankValue(card.rank) === groups[0].value),
            ...sortedCards.filter(card => getRankValue(card.rank) === groups[1].value)
        ];
        return {rank: 6, name: "Full House", score: [6, groups[0].value, groups[1].value], comboCards};
    }
    if (isFlush) return {rank: 5, name: "Flush", score: [5, ...values], comboCards: sortedCards};
    if (straightHigh) return {rank: 4, name: "Straight", score: [4, straightHigh], comboCards: sortedCards};
    if (groups[0].count === 3) {
        const kickers = groups.filter(group => group.count === 1).map(group => group.value);
        const comboCards = [
            ...sortedCards.filter(card => getRankValue(card.rank) === groups[0].value),
            ...sortedCards.filter(card => getRankValue(card.rank) !== groups[0].value)
        ];
        return {rank: 3, name: "Three of a Kind", score: [3, groups[0].value, ...kickers], comboCards};
    }
    if (groups[0].count === 2 && groups[1].count === 2) {
        const pairValues = groups.filter(group => group.count === 2).map(group => group.value);
        const kicker = groups.find(group => group.count === 1).value;
        const comboCards = [
            ...sortedCards.filter(card => pairValues.includes(getRankValue(card.rank))),
            ...sortedCards.filter(card => !pairValues.includes(getRankValue(card.rank)))
        ];
        return {rank: 2, name: "Two Pair", score: [2, ...pairValues, kicker], comboCards};
    }
    if (groups[0].count === 2) {
        const kickers = groups.filter(group => group.count === 1).map(group => group.value);
        const comboCards = [
            ...sortedCards.filter(card => getRankValue(card.rank) === groups[0].value),
            ...sortedCards.filter(card => getRankValue(card.rank) !== groups[0].value)
        ];
        return {rank: 1, name: "Pair", score: [1, groups[0].value, ...kickers], comboCards};
    }
    return {rank: 0, name: "High Card", score: [0, ...values], comboCards: sortedCards};
}

function evaluateBestHand(cards) {
    return getCombinations(cards, 5)
        .map(evaluateFiveCardHand)
        .sort((a, b) => compareScores(b.score, a.score))[0];
}

function createDeck() {
    const deck = [];
    for (const suit of ["S", "H", "D", "C"]) {
        for (const rank of ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"]) {
            deck.push({rank, suit});
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// Each contribution level forms a separate pot, including folded players' chips.
function calculatePayouts(contributions, evaluations, seatOrder) {
    const payouts = Object.create(null);
    const levels = [...new Set(Object.values(contributions).filter(amount => amount > 0))].sort((a, b) => a - b);
    let previous = 0;
    for (const level of levels) {
        const contributors = Object.keys(contributions).filter(player => contributions[player] >= level);
        const amount = (level - previous) * contributors.length;
        previous = level;
        const eligible = evaluations.filter(entry => contributors.includes(entry.player));
        if (!eligible.length) {
            // No live hand can claim this layer: return each unmatched contribution.
            for (const player of contributors) payouts[player] = (payouts[player] || 0) + amount / contributors.length;
            continue;
        }
        const best = eligible.reduce((a, b) => compareScores(a.result.score, b.result.score) >= 0 ? a : b);
        const winners = seatOrder.filter(player => eligible.some(entry => entry.player === player && compareScores(entry.result.score, best.result.score) === 0));
        const share = Math.floor(amount / winners.length);
        let remainder = amount % winners.length;
        for (const player of winners) payouts[player] = (payouts[player] || 0) + share + (remainder-- > 0 ? 1 : 0);
    }
    return payouts;
}

module.exports = {createDeck, compareScores, evaluateFiveCardHand, evaluateBestHand, calculatePayouts};
