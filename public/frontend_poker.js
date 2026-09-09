document.addEventListener("DOMContentLoaded", () => {
    const roundDisplay = document.getElementById("round");
    const streetDisplay = document.getElementById("street");
    const potDisplay = document.getElementById("pot");
    const communityCards = document.getElementById("community-cards");
    const playerCards = document.getElementById("player-cards");
    const spectatorNote = document.getElementById("spectator-note");
    const playerName = document.getElementById("player-name");
    const currentBet = document.getElementById("current-bet");
    const yourContribution = document.getElementById("your-contribution");
    const yourStack = document.getElementById("your-stack");
    const currentTurn = document.getElementById("current-turn");
    const turnState = document.getElementById("turn-state");
    const turnQueue = document.getElementById("turn-queue");
    const lastAction = document.getElementById("last-action");
    const showdownPanel = document.getElementById("showdown-panel");
    const errorMessage = document.getElementById("error-message");
    const leaveTable = document.getElementById("leave-table");
    const betModal = document.getElementById("bet-modal");
    const closeBet = document.getElementById("close-bet");
    const betRange = document.getElementById("bet-range");
    const betValue = document.getElementById("bet-value");
    const decreaseBet = document.getElementById("decrease-bet");
    const increaseBet = document.getElementById("increase-bet");
    const confirmBet = document.getElementById("confirm-bet");
    const actionButtons = document.querySelectorAll(".actions button");
    const params = new URLSearchParams(window.location.search);
    const lobbyId = params.get("lobbyId") || localStorage.getItem("activeLobbyId");
    const client = new RealtimeClient();
    let minimumRaise = 10;
    let raisesAllowed = true;
    let actionPending = false;
    let previousFocus = null;
    let isYourTurn = false;
    let isSpectator = false;
    let currentStackValue = 0;
    let minimumStake = 10;
    let callAmount = 0;
    let countdownTimer = null;
    const actionTooltips = {
        hit: "Check or call if your bet already matches the table.",
        fold: "Give up this hand and lose your current stake.",
        bet: "Open the bet dialog to add chips to the pot."
    };

    actionButtons.forEach((button) => {
        const tooltip = actionTooltips[button.dataset.action];
        if (!tooltip) return;
        button.title = tooltip;
        button.setAttribute("aria-label", `${button.textContent.trim()}: ${tooltip}`);
    });
    closeBet.title = "Close the bet dialog.";
    decreaseBet.title = "Decrease the bet amount.";
    increaseBet.title = "Increase the bet amount.";
    confirmBet.title = "Place the selected bet.";

    const showError = (message) => {
        errorMessage.textContent = message;
        errorMessage.classList.remove("hidden");
    };

    const hideError = () => {
        errorMessage.textContent = "";
        errorMessage.classList.add("hidden");
    };

    const renderCard = (card, fallback) => {
        const cardElement = document.createElement("div");
        cardElement.className = "card";
        if (!card) {
            cardElement.classList.add("placeholder");
            cardElement.textContent = fallback;
            return cardElement;
        }

        cardElement.classList.toggle("red", card.suit === "H" || card.suit === "D");
        cardElement.innerHTML = `<span>${card.rank}</span><span>${card.suit}</span>`;
        return cardElement;
    };

    const renderCards = (container, cards, count, fallbackPrefix) => {
        container.innerHTML = "";
        for (let index = 0; index < count; index++) {
            container.appendChild(renderCard(cards[index], `${fallbackPrefix} ${index + 1}`));
        }
    };

    const renderQueue = (queue = [], currentPlayer = null) => {
        turnQueue.innerHTML = "";
        queue.forEach((player, index) => {
            const item = document.createElement("li");
            item.textContent = index === 0 ? `${player} (now)` : player;
            item.classList.toggle("active", player === currentPlayer);
            turnQueue.appendChild(item);
        });
    };

    const renderShowdown = (showdown = [], winner = null) => {
        showdownPanel.innerHTML = "";
        showdownPanel.classList.toggle("hidden", showdown.length === 0 && !winner);

        if (winner) {
            const heading = document.createElement("h2");
            heading.textContent = `Winner: ${winner}`;
            showdownPanel.appendChild(heading);
        }

        showdown.forEach((entry) => {
            const row = document.createElement("div");
            row.className = "showdown-row";

            const name = document.createElement("span");
            name.textContent = `${entry.player}: ${entry.result.name}`;
            row.appendChild(name);

            const cards = document.createElement("div");
            cards.className = "mini-cards";
            (entry.result.comboCards || entry.hand).forEach((card) => cards.appendChild(renderCard(card, "?")));
            row.appendChild(cards);

            showdownPanel.appendChild(row);
        });
    };

    const sendSocketMessage = async (message) => {
        message = {...message, lobbyId};
        if (message.payload?.amount !== undefined) message.payload = {amount: message.payload.amount};
        else delete message.payload;
        actionPending = true; updateActionButtons();
        try { await client.send(message); }
        finally { actionPending = false; updateActionButtons(); }
    };
    const closeModal = () => {
        betModal.classList.add("hidden");
        previousFocus?.focus();
    };
    const updateActionButtons = () => {
        actionButtons.forEach((button) => {
            button.disabled = !client.ready || actionPending || !isYourTurn || isSpectator;
            if (button.dataset.action === "hit") {
                button.textContent = callAmount > 0 ? "Call" : "Check";
                button.title = callAmount > 0
                    ? `Call with $${Math.min(callAmount, currentStackValue)}.`
                    : actionTooltips.hit;
            }
        });
        confirmBet.disabled = !client.ready || actionPending || !isYourTurn || isSpectator;
        leaveTable.disabled = !client.ready || actionPending;
        leaveTable.title = "Leave and fold. Your committed chips stay in this hand until settlement.";
    };

    const stopCountdown = () => {
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
    };

    const renderIntermissionCountdown = (startsAt, baseMessage) => {
        stopCountdown();
        const updateCountdown = () => {
            const seconds = Math.max(0, Math.ceil((Number(startsAt) - Date.now()) / 1000));
            currentTurn.textContent = `${seconds}s`;
            turnState.textContent = "Waiting for next round";
            lastAction.textContent = baseMessage || `Next round starts in ${seconds}s. Minimum stake: $${minimumStake}.`;
            if (seconds <= 0) {
                stopCountdown();
            }
        };
        updateCountdown();
        countdownTimer = setInterval(updateCountdown, 1000);
    };

    const renderTurnCountdown = (startsAt, currentPlayer) => {
        stopCountdown();
        const updateCountdown = () => {
            const seconds = Math.max(0, Math.ceil((Number(startsAt) - Date.now()) / 1000));
            currentTurn.textContent = `${currentPlayer || "Player"} (${seconds}s)`;
            turnState.textContent = isYourTurn
                ? `Your decision (${seconds}s)`
                : `Waiting for other player (${seconds}s)`;
            if (seconds <= 0) {
                stopCountdown();
            }
        };
        updateCountdown();
        countdownTimer = setInterval(updateCountdown, 1000);
    };

    client.addEventListener('status', event => {
        if (event.detail) showError(event.detail);
        if (!client.ready) {isYourTurn = false; stopCountdown(); closeModal();}
        updateActionButtons();
    });
    client.addEventListener('message', event => {
        const message = event.detail;
            if (message.type === "poker:state") {
                hideError();
                isYourTurn = Boolean(message.isYourTurn);
                isSpectator = Boolean(message.isSpectator);
                currentStackValue = Number(message.yourStack ?? 0);
                minimumStake = Number(message.minimumStake || 10);
                callAmount = Number(message.callAmount || 0);
                minimumRaise = message.minimumRaise || minimumStake;
                raisesAllowed = message.canRaise !== false;
                if (!isYourTurn || isSpectator) closeModal();
                else if (!betModal.classList.contains("hidden")) updateBetRange();
                roundDisplay.textContent = message.round;
                potDisplay.textContent = message.pot;
                currentBet.textContent = message.currentBet ?? message.bet;
                yourContribution.textContent = message.yourContribution || 0;
                yourStack.textContent = currentStackValue;
                streetDisplay.textContent = message.street || "Preflop";
                playerName.textContent = message.username;
                if (message.phase === "intermission" && message.nextRoundStartsAt) {
                    renderIntermissionCountdown(message.nextRoundStartsAt, message.lastAction);
                } else if (message.phase === "betting" && message.turnEndsAt) {
                    renderTurnCountdown(message.turnEndsAt, message.currentPlayer);
                    lastAction.textContent = message.lastAction || "";
                } else {
                    stopCountdown();
                    currentTurn.textContent = message.currentPlayer || "Round ended";
                    turnState.textContent = isSpectator
                        ? "Spectating"
                        : isYourTurn
                            ? "Your decision"
                            : message.phase === "betting" ? "Waiting for other player" : message.phase;
                    lastAction.textContent = message.lastAction || "";
                }
                renderCards(communityCards, message.communityCards || [], Math.max(3, message.communityCards?.length || 0), "Dealer Card");
                renderCards(playerCards, message.hand || [], isSpectator ? 0 : 2, "Card");
                spectatorNote.classList.toggle("hidden", !isSpectator);
                renderQueue(message.queue || [], message.currentPlayer);
                renderShowdown(message.showdown || [], message.winner);
                updateActionButtons();
                return;
            }

            if (message.type === "poker:action") {
                return;
            }

            if (message.type === "lobby:left") {
                localStorage.removeItem("activeLobbyId");
                window.location.href = "/";
                return;
            }

            if (message.type === "auth:error" || message.type === "poker:error" || message.type === "error") {
                showError(message.message || "Poker connection failed");
            }
    });

    const setBetValue = (value) => {
        const nextValue = Math.max(Number(betRange.min), Math.min(Number(betRange.max), Number(value)));
        betRange.value = nextValue;
        betValue.textContent = nextValue;
    };

    const updateBetRange = () => {
        const maxBet = Math.max(0, raisesAllowed ? currentStackValue : Math.min(currentStackValue, callAmount));
        const requiredBet = raisesAllowed ? callAmount + minimumRaise : callAmount;
        const minBet = maxBet > 0 ? Math.min(requiredBet, maxBet) : 0;
        betRange.min = String(minBet);
        betRange.max = String(maxBet);
        betRange.step = "1";
        document.getElementById("range-min").textContent = `$${minBet}`;
        document.getElementById("range-max").textContent = `$${maxBet}`;
        setBetValue(Math.max(minBet, Number(betRange.value) || minBet));
    };

    if (!lobbyId) {
        showError("No active lobby found.");
        isYourTurn = false;
        updateActionButtons();
        return;
    }

    updateActionButtons();

    client.connect()
        .then(() => client.send({type: "poker:join", lobbyId}))
        .catch(() => showError("Could not connect to poker table."));

    actionButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const action = button.dataset.action;
            if (isSpectator) {
                showError("You are out of chips and can only spectate.");
                return;
            }
            if (!isYourTurn) {
                showError("Wait until it is your turn.");
                return;
            }
            if (action === "bet") {
                updateBetRange();
                previousFocus = document.activeElement;
                betModal.classList.remove("hidden");
                betRange.focus();
                return;
            }

            sendSocketMessage({type: "poker:action", action, payload: {lobbyId}}).catch(() => {
                showError("Could not send poker action.");
            });
        });
    });

    leaveTable.addEventListener("click", () => {
        sendSocketMessage({type: "lobby:leave", lobbyId}).catch(() => {
            showError("Could not leave table.");
        });
    });

    closeBet.addEventListener("click", closeModal);
    betModal.addEventListener("keydown", event => {
        if (event.key === "Escape") {event.preventDefault(); closeModal();}
        if (event.key === "Tab") {
            const items = [...betModal.querySelectorAll("button:not(:disabled), input:not(:disabled)")];
            const first = items[0], last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
            else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
        }
    });
    betRange.addEventListener("input", () => setBetValue(betRange.value));
    decreaseBet.addEventListener("click", () => setBetValue(Number(betRange.value) - 10));
    increaseBet.addEventListener("click", () => setBetValue(Number(betRange.value) + 10));
    confirmBet.addEventListener("click", () => {
        if (isSpectator) {
            showError("You are out of chips and can only spectate.");
            betModal.classList.add("hidden");
            return;
        }
        if (!isYourTurn) {
            showError("Wait until it is your turn.");
            betModal.classList.add("hidden");
            return;
        }
        sendSocketMessage({
            type: "poker:action",
            action: "bet",
            payload: {amount: Number(betRange.value), lobbyId}
        }).catch(() => showError("Could not place bet."));
        closeModal();
    });
});
