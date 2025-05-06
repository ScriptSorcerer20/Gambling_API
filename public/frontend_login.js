document.addEventListener("DOMContentLoaded", () => {
    const form = document.querySelector("form");

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = form.username.value;
        const password = form.password.value;
        const credentials = {username, password};
        try {
            const loginRes = await fetch("/login", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(credentials),
            });

            if (loginRes.ok) {
                const loginData = await loginRes.json();
                document.cookie = `authorization=${loginData.token}`;
                showLoadingScreen("Login successful. Loading Lobby...");
                return;
            }

            const registerRes = await fetch("/register", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(credentials),
            });

            if (registerRes.ok) {
                const registerData = await registerRes.json();
                document.cookie = `authorization=${registerData.token}`;
                showLoadingScreen("Register successful. Loading Lobby...");
            } else {
                const error = await registerRes.json();
                alert("Register failed: " + (error.error || "Unknown error"));
            }
        } catch (err) {
            console.error("Network error:", err);
            alert("Server unreachable.");
        }
    });

    function showLoadingScreen(message) {
        const loadingScreen = document.getElementById("loading-screen");
        const loadingText = document.getElementById("loading-text");
        const progress = document.getElementById("progress");
        loadingText.textContent = message;
        loadingScreen.classList.remove("hidden");
        let percent = 0;
        const interval = setInterval(() => {
            percent += Math.floor(Math.random() * 10) + 5;
            if (percent >= 100) {
                percent = 100;
                progress.style.width = percent + "%";
                clearInterval(interval);
                setTimeout(() => {
                    window.location.href = "/";
                }, 500);
            } else {
                progress.style.width = percent + "%";
            }
        }, 200);
    }
});