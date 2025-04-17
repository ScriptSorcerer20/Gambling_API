document.addEventListener("DOMContentLoaded", async () => {
    const logoutButton = document.getElementById("logout");
    const balance = document.getElementById("balance");
    const hostButton = document.getElementById("host");

    const getUsernameFromToken = async () => {
        try {
            const res = await fetch("/verify", { method: "POST" });
            const data = await res.json();
            return data.user?.username;
        } catch (err) {
            console.error("Failed to get username from token");
            return null;
        }
    };

    // Get and display user balance
    try {
        const balanceRes = await fetch('/balance', { method: "GET" });
        if (balanceRes.ok) {
            const balanceData = await balanceRes.json();
            balance.innerHTML = balanceData.balance;
        }
    } catch (error) {
        console.log("Balance error:", error);
    }

    // Logout
    logoutButton.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
            const logoutRes = await fetch('/logout', { method: "DELETE" });
            if (logoutRes.ok) {
                document.cookie = "authorization=; Max-Age=0; path=/;";
                window.location.href = "/login";
            }
        } catch (err) {
            console.log("Logout error:", err);
        }
    });

    // Host Lobby and join immediately
    hostButton.addEventListener("click", async (e) => {
        e.preventDefault();

        const username = await getUsernameFromToken();
        if (!username) return alert("User not authenticated");

        try {
            const res = await fetch(`/lobby/create?username=${username}`);
            if (res.redirected) {
                // If server redirects to join, follow the URL manually
                const joinURL = new URL(res.url);
                const lobbyId = joinURL.searchParams.get("lobbyId");

                const joinRes = await fetch(joinURL.href);
                const { lobbyId: finalLobbyId } = await joinRes.json();

                document.getElementById("lobby-id").textContent = finalLobbyId;
                document.getElementById("lobby-room").classList.remove("hidden");

                setInterval(async () => {
                    const res = await fetch(`/lobby/players?lobbyId=${finalLobbyId}`);
                    const data = await res.json();
                    const playerList = document.getElementById("player-list");
                    playerList.innerHTML = data.players.map(p => `<p>${p}</p>`).join("") || "<p>No players yet</p>";
                }, 3000);
            }
        } catch (err) {
            console.error("Lobby create/join error:", err);
        }
    });
});