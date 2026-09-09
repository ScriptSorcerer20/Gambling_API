const {WebSocketServer, WebSocket} = require('ws');
const crypto = require('node:crypto');
const {AppError} = require('./core');
const {validate} = require('../public/protocol');
function parseCookies(header = '') {
    const result = Object.create(null);
    for (const entry of header.split(';')) {
        const index = entry.indexOf('='); if (index < 0) continue;
        try { result[entry.slice(0, index).trim()] = decodeURIComponent(entry.slice(index + 1).trim()); } catch { /* Ignore malformed cookies. */ }
    }
    return result;
}
function tokenFrom(request) {
    const bearer = /^Bearer ([^ ]+)$/i.exec(request.headers.authorization || '');
    return bearer?.[1] || request.cookies?.authorization || parseCookies(request.headers.cookie).authorization;
}
function connectTransport(server, sessions, lobbies, config) {
    const wss = new WebSocketServer({noServer: true, maxPayload: 16 * 1024});
    const connections = new Map();
    const disconnects = new Map();
    let stopping = false;
    function send(socket, data) {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 256 * 1024) { socket.close(1013, 'Client is too slow'); return; }
        socket.send(JSON.stringify(data));
    }
    function snapshot(socket) {
        const lobby = lobbies.get(socket.lobbyId);
        if (!lobby?.players.includes(socket.user.username)) return;
        send(socket, lobbies.lobbyState(lobby));
        if (lobby.game) send(socket, lobbies.state(lobby, socket.user.username));
    }
    function disconnected(username) {
        if (stopping || [...wss.clients].some(socket => socket.user?.username === username && socket.readyState === WebSocket.OPEN)) return;
        clearTimeout(disconnects.get(username));
        const timer = setTimeout(() => {
            disconnects.delete(username);
            if ([...wss.clients].some(socket => socket.user?.username === username && socket.readyState === WebSocket.OPEN)) return;
            const lobby = lobbies.membership(username);
            if (lobby) lobbies.command(username, {type: 'lobby:leave', lobbyId: lobby.id, requestId: crypto.randomUUID()}).catch(error => {
                console.error('Disconnect leave failed:', error.message);
                disconnected(username);
            });
        }, config.disconnectMs);
        timer.unref(); disconnects.set(username, timer);
    }
    server.on('upgrade', (request, socket, head) => {
        const ip = request.socket.remoteAddress;
        const reject = status => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
        if (stopping) return reject('503 Service Unavailable');
        if (request.url !== '/') return reject('404 Not Found');
        const expectedOrigin = config.origin || `${request.socket.encrypted ? 'https' : 'http'}://${request.headers.host}`;
        if (request.headers.origin ? request.headers.origin !== expectedOrigin : !request.headers.authorization) return reject('403 Forbidden');
        if ([...connections.values()].reduce((sum, count) => sum + count, 0) >= config.maxConnections || (connections.get(ip) || 0) >= config.maxConnectionsPerIp) return reject('429 Too Many Requests');
        connections.set(ip, (connections.get(ip) || 0) + 1);
        let released = false;
        const release = () => { if (released) return; released = true; const count = connections.get(ip) - 1; if (count) connections.set(ip, count); else connections.delete(ip); };
        socket.once('close', release);
        socket.on('error', () => {});
        const token = tokenFrom(request);
        sessions.authorized(token, user => {
            if (socket.destroyed || stopping) return socket.destroy();
            wss.handleUpgrade(request, socket, head, ws => {
                ws.user = user; ws.token = token; ws.alive = true; ws.pending = 0;
                ws.windowAt = config.now(); ws.messages = 0;
                clearTimeout(disconnects.get(user.username)); disconnects.delete(user.username);
                ws.lobbyId = lobbies.membership(user.username)?.id || null;
                ws.on('error', error => console.error('WebSocket error:', error.message));
                ws.on('pong', () => { ws.alive = true; });
                const expiry = setTimeout(() => ws.close(1008, 'Session expired'), Math.max(1, user.exp * 1000 - config.now()));
                expiry.unref();
                ws.on('close', () => { clearTimeout(expiry); release(); disconnected(user.username); });
                ws.on('message', raw => {
                    if (config.now() - ws.windowAt >= 1000) { ws.windowAt = config.now(); ws.messages = 0; }
                    if (++ws.messages > config.messageLimit || ws.pending >= 8) { ws.close(1008, 'Message limit exceeded'); return; }
                    let message;
                    try { message = JSON.parse(raw.toString()); } catch { send(ws, {type: 'error', code: 'INVALID_JSON', message: 'Invalid JSON'}); return; }
                    const invalid = validate(message);
                    if (invalid) { send(ws, {type: 'error', code: 'INVALID_MESSAGE', message: invalid, requestId: message?.requestId}); return; }
                    ws.pending++;
                    sessions.authorized(token, async current => {
                        if (message.type === 'poker:join') {
                            const lobby = lobbies.get(message.lobbyId);
                            if (!lobby?.players.includes(current.username)) throw new AppError('NOT_SEATED', 'You are not in this lobby', 403);
                            ws.lobbyId = lobby.id; snapshot(ws); return;
                        }
                        const result = await lobbies.command(current.username, message);
                        send(ws, {...result, type: 'command:ack', commandType: result.type});
                    }).catch(error => {
                        send(ws, {type: 'error', code: error.code || 'INTERNAL_ERROR', message: error.status ? error.message : 'Command failed; retry with the same request ID', requestId: message.requestId});
                        if (error.status === 401) ws.close(1008, 'Session expired or revoked');
                        if (!error.status) console.error('Socket command failed:', error);
                    }).finally(() => ws.pending--);
                });
                // Handlers exist before readiness is announced.
                send(ws, {type: 'auth:success', username: user.username}); snapshot(ws);
            });
        }).catch(error => { if (error.status === 401) reject('401 Unauthorized'); else {console.error('Upgrade failed:', error.message); reject('500 Internal Server Error');} });
    });
    const onChanged = (lobby, username, type) => {
        for (const socket of wss.clients) {
            if (socket.user?.username === username && ['lobby:create', 'lobby:join'].includes(type)) socket.lobbyId = lobby.id;
            if (socket.lobbyId !== lobby.id) continue;
            if (!lobby.players.includes(socket.user.username)) {
                socket.lobbyId = null; send(socket, {type: 'lobby:left', lobbyId: lobby.id});
            } else snapshot(socket);
        }
    };
    const onRevoked = username => { for (const socket of wss.clients) if (socket.user?.username === username) socket.close(1008, 'Session expired or revoked'); };
    lobbies.events.on('changed', onChanged); sessions.events.on('revoked', onRevoked);
    const heartbeat = setInterval(() => {
        for (const socket of wss.clients) { if (!socket.alive) socket.terminate(); else { socket.alive = false; socket.ping(); } }
    }, config.heartbeatMs);
    heartbeat.unref();
    return {wss, async close() {
        stopping = true; clearInterval(heartbeat); for (const timer of disconnects.values()) clearTimeout(timer);
        lobbies.events.off('changed', onChanged); sessions.events.off('revoked', onRevoked);
        for (const socket of wss.clients) socket.terminate();
        await new Promise(resolve => wss.close(resolve));
    }};
}
module.exports = {connectTransport, tokenFrom, parseCookies};
