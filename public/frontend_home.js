document.addEventListener("DOMContentLoaded", async () => {
    const logoutButton = document.getElementById("logout");
    const balance = document.getElementById("balance");
    const hostButton = document.getElementById("host");
    const joinButton = document.getElementById("join");
    try {
        const balanceRes = await fetch('/balance', {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            }
        });
        if (balanceRes.ok) {
            const balanceData = await balanceRes.json();
            console.log(balanceData);
            balance.innerHTML = balanceData.balance;
        }
    } catch (error) {
        console.log(error);
    }
    logoutButton.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
            const logoutRes = await fetch('/logout', {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                }
            });

            if (logoutRes.ok) {
                document.cookie = "authorization=; Max-Age=0; path=/;";
                window.location.href = "/login";
            } else {
                console.log("Failed to logout");
            }
        } catch (err) {
            console.log("Logout error:", err);
        }
    });
    hostButton.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
            const hostRes = await fetch('/lobby/create', {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                }
            });
            if (hostRes.ok) {
                const lobbyId = await hostRes.text();
                document.getElementById("lobby-id").textContent = lobbyId;
                document.getElementById("lobby-room").classList.remove("hidden");
                setInterval(async () => {
                    const res = await fetch(`/lobby/players?lobbyId=${lobbyId}`);
                    const data = await res.json();
                    const playerList = document.getElementById("player-list");
                    playerList.innerHTML = data.players.map(p => `<p>${p}</p>`).join("") || "<p>No players yet</p>";
                }, 3000);
            } else {
                console.log("Failed to create lobby:" + await hostRes.text());
            }
        } catch (err) {
            console.log("Lobby create error:", err);
        }
    });
});