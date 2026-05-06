document.addEventListener("DOMContentLoaded", async () => {
    const logoutButton = document.getElementById("logout");
    const balance = document.getElementById("balance");
    const hostButton = document.getElementById("host");
    const joinButton = document.getElementById("join");
    const hostForm = document.getElementById("host-form");
    const createLobbyButton = document.getElementById("create-lobby");
    const lobbyVisibilityInputs = document.querySelectorAll("input[name='lobby-visibility']");
    const joinForm = document.getElementById("join-form");
    const joinCodeInput = document.getElementById("join-code");
    const joinSubmit = document.getElementById("submit-join");
    const refreshLobbies = document.getElementById("refresh-lobbies");
    const publicLobbies = document.getElementById("public-lobbies");
    const leaveButton = document.getElementById("leave-button");
    const joinError = document.getElementById("join-error");
    const lobbyRoom = document.getElementById("lobby-room");
    const lobbyIdDisplay = document.getElementById("lobby-id");
    const playerList = document.getElementById("player-list");
    const startGameButton = document.getElementById("start-game");
    let socket = null;
    let socketReady = null;
    let currentUsername = null;
    let currentLobbyId = null;

    const showJoinError = (message) => {
        joinError.textContent = message;
        joinError.classList.remove("hidden");
    };

    const clearJoinError = () => {
        joinError.textContent = "";
        joinError.classList.add("hidden");
    };

    const renderPlayers = (players) => {
        playerList.innerHTML = "";

        if (!players.length) {
            playerList.innerHTML = "<p>No players yet</p>";
            return;
        }

        for (const player of players) {
            const entry = document.createElement("p");
            entry.textContent = player;
            playerList.appendChild(entry);
        }
    };

    const updateStartButton = (host, canStart) => {
        const isHost = currentUsername && host === currentUsername;
        startGameButton.classList.toggle("hidden", !isHost);
        startGameButton.disabled = !isHost || !canStart;
        startGameButton.textContent = canStart ? "Start Game" : "Waiting for 2 players";
    };

    const showLobby = (lobbyId, players = [], host = null, canStart = false) => {
        currentLobbyId = lobbyId;
        lobbyIdDisplay.textContent = lobbyId;
        lobbyRoom.classList.remove("hidden");
        joinForm.classList.add("hidden");
        hostForm.classList.add("hidden");
        renderPlayers(players);
        updateStartButton(host, canStart);
    };

    const joinLobby = (lobbyId) => {
        if (!currentUsername) {
            showJoinError("User not authenticated.");
            return Promise.reject(new Error("User not authenticated"));
        }
        return sendSocketMessage({type: "lobby:join", lobbyId});
    };

    const renderPublicLobbies = (lobbies = []) => {
        publicLobbies.innerHTML = "";

        if (!lobbies.length) {
            publicLobbies.innerHTML = "<p>No public lobbies found</p>";
            return;
        }

        lobbies.forEach((lobby) => {
            const row = document.createElement("div");
            row.className = "public-lobby";

            const info = document.createElement("div");
            info.className = "public-lobby-info";

            const title = document.createElement("strong");
            title.textContent = lobby.host ? `${lobby.host}'s lobby` : "Public lobby";
            info.appendChild(title);

            const meta = document.createElement("span");
            meta.textContent = `${lobby.players} player${lobby.players === 1 ? "" : "s"} - ${lobby.gameStarted ? "Game running" : "Waiting"}`;
            info.appendChild(meta);

            const join = document.createElement("button");
            join.type = "button";
            join.textContent = "Join";
            join.addEventListener("click", () => {
                clearJoinError();
                joinLobby(lobby.lobbyId).catch(() => showJoinError("Could not join lobby."));
            });

            row.appendChild(info);
            row.appendChild(join);
            publicLobbies.appendChild(row);
        });
    };

    const loadPublicLobbies = async () => {
        try {
            publicLobbies.innerHTML = "<p>Loading lobbies...</p>";
            const res = await fetch("/lobby/public", {credentials: "same-origin"});
            if (!res.ok) {
                throw new Error("Failed to load lobbies");
            }
            const data = await res.json();
            renderPublicLobbies(data.lobbies || []);
        } catch (error) {
            publicLobbies.innerHTML = "<p>Could not load lobbies</p>";
        }
    };

    const hideLobby = () => {
        currentLobbyId = null;
        lobbyRoom.classList.add("hidden");
        lobbyIdDisplay.textContent = "N/A";
        playerList.innerHTML = "<p>Waiting for players...</p>";
        startGameButton.classList.add("hidden");
        startGameButton.disabled = true;
    };

    const sendSocketMessage = async (message) => {
        const ws = await connectSocket();
        ws.send(JSON.stringify(message));
    };

    const connectSocket = () => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            return Promise.resolve(socket);
        }

        if (socketReady) {
            return socketReady;
        }

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(`${protocol}//${window.location.host}`);

        socketReady = new Promise((resolve, reject) => {
            socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), {once: true});
            socket.addEventListener("close", (event) => {
                reject(new Error(`WebSocket closed before authentication: ${event.reason || event.code}`));
            }, {once: true});
            socket.addEventListener("message", (event) => {
                const message = JSON.parse(event.data);
                if (message.type === "auth:success") {
                    currentUsername = message.username;
                    resolve(socket);
                }
                if (message.type === "auth:error") {
                    reject(new Error(message.message || "WebSocket authentication failed"));
                }
            }, {once: true});
        });

        socket.addEventListener("message", (event) => {
            const message = JSON.parse(event.data);

            if (message.type === "auth:error") {
                showJoinError(message.message);
                return;
            }

            if (message.type === "auth:success") {
                currentUsername = message.username;
                return;
            }

            if (message.type === "lobby:state") {
                clearJoinError();
                if (message.gameStarted) {
                    localStorage.setItem("activeLobbyId", message.lobbyId);
                    window.location.href = message.gameUrl || `/poker.html?lobbyId=${encodeURIComponent(message.lobbyId)}`;
                    return;
                }
                showLobby(message.lobbyId, message.players || [], message.host, Boolean(message.canStart));
                return;
            }

            if (message.type === "poker:started") {
                localStorage.setItem("activeLobbyId", message.lobbyId);
                window.location.href = message.url || `/poker.html?lobbyId=${encodeURIComponent(message.lobbyId)}`;
                return;
            }

            if (message.type === "lobby:left") {
                hideLobby();
                return;
            }

            if (message.type === "lobby:error" || message.type === "error" || message.type === "poker:error") {
                showJoinError(message.message || "WebSocket request failed");
            }
        });

        socket.addEventListener("close", () => {
            socket = null;
            socketReady = null;
        });

        return socketReady;
    };

    const getUsernameFromToken = async () => {
        try {
            const res = await fetch("/verify", {
                method: "POST",
                credentials: "same-origin"
            });
            if (!res.ok) {
                console.error("Token verification failed", res.status, await res.text());
                return null;
            }
            const data = await res.json();
            return data.user?.username;
        } catch (err) {
            console.error("Failed to get username from token", err);
            return null;
        }
    };

    currentUsername = await getUsernameFromToken();
    if (!currentUsername) {
        showJoinError("User not authenticated.");
    }

    connectSocket().catch((error) => {
        console.error("Home WebSocket connection failed:", error);
        showJoinError("Real-time poker connection failed.");
    });

    try {
        const balanceRes = await fetch("/balance", {
            method: "GET",
            credentials: "same-origin"
        });
        if (balanceRes.ok) {
            const balanceData = await balanceRes.json();
            balance.textContent = balanceData.balance;
        }
    } catch (error) {
        console.log("Balance error:", error);
    }

    logoutButton.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.close();
            }
            const logoutRes = await fetch("/logout", {
                method: "DELETE",
                credentials: "same-origin"
            });
            if (logoutRes.ok) {
                document.cookie = "authorization=; Max-Age=0; path=/;";
                window.location.href = "/login.html";
            }
        } catch (err) {
            console.log("Logout error:", err);
        }
    });

    hostButton.addEventListener("click", async (e) => {
        e.preventDefault();
        clearJoinError();
        hostForm.classList.toggle("hidden");
        joinForm.classList.add("hidden");
    });

    createLobbyButton.addEventListener("click", async (e) => {
        e.preventDefault();
        clearJoinError();
        if (!currentUsername) {
            showJoinError("User not authenticated.");
            return;
        }
        const selectedVisibility = [...lobbyVisibilityInputs].find(input => input.checked)?.value || "public";
        sendSocketMessage({type: "lobby:create", private: selectedVisibility === "private"}).catch(() => {
            showJoinError("Could not create lobby.");
        });
    });

    joinButton.addEventListener("click", (e) => {
        e.preventDefault();
        joinForm.classList.toggle("hidden");
        hostForm.classList.add("hidden");
        if (!joinForm.classList.contains("hidden")) {
            joinCodeInput.focus();
            loadPublicLobbies();
        }
    });

    refreshLobbies.addEventListener("click", (e) => {
        e.preventDefault();
        loadPublicLobbies();
    });

    joinSubmit.addEventListener("click", async (e) => {
        e.preventDefault();
        clearJoinError();

        const lobbyId = joinCodeInput.value.trim();
        if (!lobbyId) {
            showJoinError("Please enter a lobby ID.");
            return;
        }

        if (!currentUsername) {
            showJoinError("User not authenticated.");
            return;
        }

        joinLobby(lobbyId).then(() => {
            joinForm.classList.add("hidden");
            joinCodeInput.value = "";
        }).catch(() => {
            showJoinError("Could not join lobby. Please try again.");
        });
    });

    leaveButton.addEventListener("click", (e) => {
        e.preventDefault();
        const lobbyId = lobbyIdDisplay.textContent;
        if (!lobbyId || lobbyId === "N/A") return;
        sendSocketMessage({type: "lobby:leave", lobbyId}).catch(() => {
            showJoinError("Could not leave lobby.");
        });
    });

    startGameButton.addEventListener("click", (e) => {
        e.preventDefault();
        if (!currentLobbyId || startGameButton.disabled) return;
        sendSocketMessage({type: "poker:start", lobbyId: currentLobbyId}).catch(() => {
            showJoinError("Could not start game.");
        });
    });

    async function loadLeaderboard() {
        try {
            const res = await fetch("/leaderboard", {credentials: "same-origin"});
            if (res.ok) {
                const data = await res.json();
                const list = document.getElementById("leaderboard-list");
                const yourRank = document.getElementById("your-rank");

                list.innerHTML = "";
                data.leaderboard.forEach((player, i) => {
                    const item = document.createElement("li");
                    item.textContent = `${i + 1}. ${player.username} - $${player.money}`;
                    if (player.username === data.self.username) {
                        item.classList.add("you");
                        item.textContent += " (you)";
                    }
                    list.appendChild(item);
                });

                yourRank.textContent = `You are ranked #${data.self.position} with $${data.self.money}`;
            } else {
                console.error("Failed to load leaderboard.");
            }
        } catch (err) {
            console.error("Leaderboard error:", err);
        }
    }

    await loadLeaderboard();
});
