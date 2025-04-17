document.addEventListener("DOMContentLoaded", async () => {
    const logoutButton = document.getElementById("logout");
    const balance = document.getElementById("balance");
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
});