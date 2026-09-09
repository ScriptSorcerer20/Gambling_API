document.addEventListener('DOMContentLoaded', async () => {
    const byId = id => document.getElementById(id);
    const client = new RealtimeClient();
    let username; let lobbyId;
    const error = message => {byId('join-error').textContent = message; byId('join-error').classList.toggle('hidden', !message);};
    const send = async message => {try {error(''); await client.send(message);} catch (problem) {error(problem.message);}};
    const hideLobby = () => {
        lobbyId = null; localStorage.removeItem('activeLobbyId'); byId('lobby-room').classList.add('hidden');
        byId('host').disabled = false; byId('join').disabled = false;
    };
    async function refreshBalance() {
        try {
            const [balance, ranks] = await Promise.all([apiRequest('/balance'), apiRequest('/leaderboard')]);
            byId('balance').textContent = balance.balance;
            byId('leaderboard-list').replaceChildren(...ranks.leaderboard.map((player, index) => {
                const item = document.createElement('li'); item.textContent = `${index + 1}. ${player.username}: ${player.money}`;
                item.classList.toggle('you', player.username === username); return item;
            }));
            byId('your-rank').textContent = `Your rank: #${ranks.self.position}`;
        } catch (problem) {error(problem.message);}
    }
    client.addEventListener('status', event => {error(event.detail); byId('start-game').disabled = !client.ready || byId('start-game').dataset.allowed !== 'true';});
    client.addEventListener('message', event => {
        const message = event.detail;
        if (message.type === 'auth:success') username = message.username;
        if (message.type === 'lobby:left') {hideLobby(); refreshBalance();}
        if (message.type !== 'lobby:state') return;
        lobbyId = message.lobbyId;
        if (message.gameStarted) {
            localStorage.setItem('activeLobbyId', lobbyId);
            location.assign(`/poker.html?lobbyId=${encodeURIComponent(lobbyId)}`); return;
        }
        byId('lobby-id').textContent = lobbyId; byId('lobby-room').classList.remove('hidden');
        byId('host-form').classList.add('hidden'); byId('join-form').classList.add('hidden');
        byId('host').disabled = true; byId('join').disabled = true;
        byId('player-list').replaceChildren(...message.players.map(player => {const item = document.createElement('p'); item.textContent = player; return item;}));
        const allowed = message.host === username && message.canStart;
        byId('start-game').dataset.allowed = String(allowed);
        byId('start-game').disabled = !allowed; byId('start-game').classList.toggle('hidden', message.host !== username);
    });
    byId('host').addEventListener('click', () => {byId('host-form').classList.toggle('hidden'); byId('join-form').classList.add('hidden');});
    byId('create-lobby').addEventListener('click', () => send({type: 'lobby:create', private: document.querySelector('[name="lobby-visibility"]:checked').value === 'private'}));
    async function loadLobbies() {
        try {
            const {lobbies} = await apiRequest('/lobby/public');
            byId('public-lobbies').replaceChildren();
            if (!lobbies.length) {byId('public-lobbies').textContent = 'No public lobbies found'; return;}
            for (const lobby of lobbies) {
                const row = document.createElement('div'); row.className = 'public-lobby';
                const info = document.createElement('span'); info.textContent = `${lobby.host}: ${lobby.players}/10 players`;
                const button = document.createElement('button'); button.textContent = 'Join'; button.type = 'button';
                button.addEventListener('click', () => send({type: 'lobby:join', lobbyId: lobby.lobbyId}));
                row.append(info, button); byId('public-lobbies').append(row);
            }
        } catch (problem) {error(problem.message);}
    }
    byId('join').addEventListener('click', () => {byId('join-form').classList.toggle('hidden'); byId('host-form').classList.add('hidden'); byId('join-code').focus(); loadLobbies();});
    byId('refresh-lobbies').addEventListener('click', loadLobbies);
    byId('submit-join').addEventListener('click', () => send({type: 'lobby:join', lobbyId: byId('join-code').value.trim().toLowerCase()}));
    byId('leave-button').addEventListener('click', () => send({type: 'lobby:leave', lobbyId}));
    byId('start-game').addEventListener('click', () => send({type: 'poker:start', lobbyId}));
    byId('logout').addEventListener('click', async () => {
        try {await apiRequest('/logout', {method: 'DELETE'}); client.close(); localStorage.removeItem('activeLobbyId'); location.assign('/login');}
        catch (problem) {error(`Logout failed: ${problem.message}`);}
    });
    try {username = (await apiRequest('/verify', {method: 'POST'})).user.username; await client.connect(); await refreshBalance();}
    catch (problem) {error(problem.message);}
});
