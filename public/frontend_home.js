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
});