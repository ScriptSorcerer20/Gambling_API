document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('form');
    const error = document.getElementById('auth-error');
    let pending = false;
    async function authenticate(endpoint) {
        if (pending || !form.reportValidity()) return;
        pending = true; error.textContent = ''; error.classList.add('hidden');
        for (const button of form.querySelectorAll('button')) button.disabled = true;
        try {
            const response = await fetch(endpoint, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({username: form.username.value, password: form.password.value})});
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Authentication failed');
            location.assign('/');
        } catch (problem) {error.textContent = problem.message; error.classList.remove('hidden');}
        finally {pending = false; for (const button of form.querySelectorAll('button')) button.disabled = false;}
    }
    form.addEventListener('submit', event => {event.preventDefault(); authenticate('/login');});
    document.getElementById('register-button').addEventListener('click', () => authenticate('/register'));
});
