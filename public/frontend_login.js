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
                alert(`Welcome back, ${loginData.username}!`);
                document.cookie = `authorization=${loginData.token}`
                window.location.href = "/";
                return;
            }

            const registerRes = await fetch("/register", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(credentials),
            });

            if (registerRes.ok) {
                const registerData = await registerRes.json();
                alert(`Account created! Welcome, ${registerData.username}`);
                document.cookie = `authorization=${registerData.token}`
                window.location.href = "/";
            } else {
                const error = await registerRes.json();
                alert("Register failed: " + (error.error || "Unknown error"));
            }
        } catch (err) {
            console.error("Network error:", err);
            alert("Server unreachable.");
        }
    });
});