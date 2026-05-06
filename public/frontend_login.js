document.addEventListener("DOMContentLoaded", () => {
    const form = document.querySelector("form");
    const registerButton = document.getElementById("register-button");
    const loginButton = document.getElementById("login-button");
    const authError = document.getElementById("auth-error");

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await authenticate("/login", "Login successful. Loading Lobby...");
    });

    registerButton.addEventListener("click", async () => {
        await authenticate("/register", "Register successful. Loading Lobby...");
    });

    async function authenticate(endpoint, successMessage) {
        clearAuthError();
        setButtonsDisabled(true);

        const credentials = {
            username: form.username.value,
            password: form.password.value
        };

        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                credentials: "same-origin",
                body: JSON.stringify(credentials)
            });

            const data = await readJsonResponse(response);
            if (!response.ok) {
                showAuthError(data.error || "Authentication failed.");
                return;
            }

            const verified = await verifySession();
            if (!verified) {
                showAuthError("Login succeeded, but the browser did not send the session cookie back to the server.");
                return;
            }

            showLoadingScreen(successMessage);
        } catch (error) {
            console.error("Authentication request failed:", error);
            showAuthError("Server unreachable.");
        } finally {
            setButtonsDisabled(false);
        }
    }

    async function verifySession() {
        const response = await fetch("/verify", {
            method: "POST",
            credentials: "same-origin"
        });
        if (!response.ok) return false;

        const data = await readJsonResponse(response);
        return Boolean(data.valid && data.user?.username);
    }

    async function readJsonResponse(response) {
        try {
            return await response.json();
        } catch {
            return {};
        }
    }

    function showAuthError(message) {
        authError.textContent = message;
        authError.classList.remove("hidden");
    }

    function clearAuthError() {
        authError.textContent = "";
        authError.classList.add("hidden");
    }

    function setButtonsDisabled(disabled) {
        loginButton.disabled = disabled;
        registerButton.disabled = disabled;
    }

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
