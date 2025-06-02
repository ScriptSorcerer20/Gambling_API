document.addEventListener("DOMContentLoaded", async () => {
    const logoutButton = document.getElementById("logout");
    const balance = document.getElementById("balance");
    const hostButton = document.getElementById("host");
    const joinButton = document.getElementById("join");
    const joinForm = document.getElementById("join-form");
    const joinCodeInput = document.getElementById("join-code");
    const joinSubmit = document.getElementById("submit-join");
    const leaveButton = document.getElementById("leave-button");
    let playerUpdateInterval = null;

    const startPlayerUpdates = (lobbyId) => {
        if (playerUpdateInterval) {
            clearInterval(playerUpdateInterval);
        }

        playerUpdateInterval = setInterval(async () => {
            const res = await fetch(`/lobby/players?lobbyId=${lobbyId}`);
            const data = await res.json();
            const playerList = document.getElementById("player-list");
            playerList.innerHTML = data.players.map(p => `<p>${p}</p>`).join("") || "<p>No players yet</p>";
        }, 3000);
    };

    leaveButton.addEventListener("click", async () => {
        const username = await getUsernameFromToken();
        const lobbyId = document.getElementById("lobby-id").textContent;
        try {
            const res = await fetch(`/lobby/leave?lobbyId=${lobbyId}&username=${username}`, {
                method: "DELETE",
            });
            if (res.ok) {
                // Stoppe das Interval beim Verlassen
                if (playerUpdateInterval) {
                    clearInterval(playerUpdateInterval);
                    playerUpdateInterval = null;
                }
                document.getElementById("lobby-room").classList.add("hidden");
                document.getElementById("player-list").innerHTML = "<p>Waiting for players...</p>";
                document.getElementById("lobby-id").textContent = "N/A";
            } else {
                const err = await res.json();
                alert("Failed to leave lobby: " + (err.error || "Unknown error"));
            }
        } catch (err) {
            console.error("Error leaving lobby:", err);
            alert("Could not leave lobby.");
        }
    });

    const getUsernameFromToken = async () => {
        try {
            const res = await fetch("/verify", {method: "POST"});
            const data = await res.json();
            return data.user?.username;
        } catch (err) {
            console.error("Failed to get username from token");
            return null;
        }
    };

    try {
        const balanceRes = await fetch('/balance', {method: "GET"});
        if (balanceRes.ok) {
            const balanceData = await balanceRes.json();
            balance.innerHTML = balanceData.balance;
        }
    } catch (error) {
        console.log("Balance error:", error);
    }
    logoutButton.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
            const logoutRes = await fetch('/logout', {method: "DELETE"});
            if (logoutRes.ok) {
                document.cookie = "authorization=; Max-Age=0; path=/;";
                window.location.href = "/login.html";
            }
        } catch (err) {
            console.log("Logout error:", err);
        }
    });
    // Im hostButton Event Listener
    hostButton.addEventListener("click", async (e) => {
        e.preventDefault();
        const username = await getUsernameFromToken();
        if (!username) return alert("User not authenticated");
        try {
            const res = await fetch(`/lobby/create?username=${username}`);
            if (res.redirected) {
                const joinURL = new URL(res.url);
                const lobbyId = joinURL.searchParams.get("lobbyId");
                const joinRes = await fetch(joinURL.href);
                const {lobbyId: finalLobbyId} = await joinRes.json();
                document.getElementById("lobby-id").textContent = finalLobbyId;
                document.getElementById("lobby-room").classList.remove("hidden");
                // ... bisheriger Code bis zum Interval ...
                startPlayerUpdates(finalLobbyId);
            }
        } catch (err) {
            console.error("Lobby create/join error:", err);
        }
    });
    joinButton.addEventListener("click", (e) => {
        e.preventDefault();
        if (joinForm.classList.contains("hidden")) {
            joinForm.classList.remove("hidden");
            joinCodeInput.focus();
        } else {
            joinForm.classList.add("hidden");
        }
    });
    // Im joinSubmit Event Listener
    joinSubmit.addEventListener("click", async (e) => {
        e.preventDefault();
        const lobbyId = joinCodeInput.value.trim();
        const joinError = document.getElementById("join-error");
        joinError.classList.add("hidden"); // hide any previous error
        joinError.textContent = "";
        if (!lobbyId) {
            joinError.textContent = "Please enter a lobby ID.";
            joinError.classList.remove("hidden");
            return;
        }
        const username = await getUsernameFromToken();
        if (!username) {
            joinError.textContent = "User not authenticated.";
            joinError.classList.remove("hidden");
            return;
        }
        try {
            const joinRes = await fetch(`/lobby/join?lobbyId=${lobbyId}&username=${username}`);
            if (joinRes.ok) {
                const {lobbyId: finalLobbyId} = await joinRes.json();
                document.getElementById("lobby-id").textContent = finalLobbyId;
                document.getElementById("lobby-room").classList.remove("hidden");
                joinForm.classList.add("hidden");
                joinCodeInput.value = "";
                // ... bisheriger Code bis zum Interval ...
                startPlayerUpdates(finalLobbyId);
            } else {
                const error = await joinRes.json();
                joinError.textContent = "Join failed: " + (error.error || "Unknown error");
                joinError.classList.remove("hidden");
            }
        } catch (err) {
            console.error("Join lobby error:", err);
            joinError.textContent = "Could not join lobby. Please try again.";
            joinError.classList.remove("hidden");
        }
    });
});