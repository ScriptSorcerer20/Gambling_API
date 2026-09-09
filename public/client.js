'use strict';
window.apiRequest = async function (url, options = {}) {
    const response = await fetch(url, {credentials: 'same-origin', signal: AbortSignal.timeout(5000), ...options});
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
        localStorage.removeItem('activeLobbyId');
        window.location.assign('/login');
    }
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
};
window.RealtimeClient = class extends EventTarget {
    constructor() {
        super(); this.socket = null; this.ready = false; this.attempts = 0;
        this.pending = new Map(); this.stopped = false;
        window.addEventListener('offline', () => this.socket?.close());
        window.addEventListener('pagehide', () => this.close());
    }
    status(message) { this.dispatchEvent(new CustomEvent('status', {detail: message})); }
    connect() {
        if (this.ready) return Promise.resolve();
        if (this.connecting) return this.connecting;
        this.stopped = false;
        this.connecting = new Promise((resolve, reject) => {this.resolveReady = resolve; this.rejectReady = reject;});
        if (!this.reconnectTimer && (!this.socket || this.socket.readyState >= WebSocket.CLOSING)) this.open();
        return this.connecting;
    }
    open() {
        this.reconnectTimer = null;
        if (this.stopped) return;
        const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/`);
        this.socket = socket;
        const timeout = setTimeout(() => socket.close(), 5000);
        socket.addEventListener('message', event => {
            let message; try {message = JSON.parse(event.data);} catch {this.status('Server sent an invalid response.'); return;}
            if (message.type === 'auth:success') {
                clearTimeout(timeout); this.ready = true; this.attempts = 0;
                this.resolveReady?.(); this.connecting = null; this.status('');
                for (const item of this.pending.values()) socket.send(JSON.stringify(item.message));
            }
            const pending = this.pending.get(message.requestId);
            if (pending && (message.type === 'command:ack' || message.type === 'error')) {
                clearTimeout(pending.timer); this.pending.delete(message.requestId);
                if (message.type === 'error') pending.reject(new Error(message.message)); else pending.resolve(message);
            }
            this.dispatchEvent(new CustomEvent('message', {detail: message}));
        });
        socket.addEventListener('error', () => this.status('Connection interrupted. Reconnecting...'));
        socket.addEventListener('close', async event => {
            clearTimeout(timeout); this.ready = false;
            if (this.stopped) return;
            this.status('Connection interrupted. Reconnecting...');
            if (event.code === 1008 && /Session/.test(event.reason)) {
                this.close(); localStorage.removeItem('activeLobbyId'); location.assign('/login'); return;
            }
            try { await apiRequest('/verify', {method: 'POST'}); } catch { /* apiRequest redirects expired sessions; network outages are retried. */ }
            if (this.stopped) return;
            if (++this.attempts > 5) { this.close(); this.status('Could not reconnect. Reload to try again.'); return; }
            this.reconnectTimer = setTimeout(() => this.open(), Math.min(500 * 2 ** (this.attempts - 1), 5000));
        });
    }
    async send(message) {
        if (message.type === 'poker:join') { await this.connect(); this.socket.send(JSON.stringify(message)); return; }
        message = {...message, requestId: message.requestId || crypto.randomUUID()};
        const invalid = Protocol.validate(message); if (invalid) throw new Error(invalid);
        await this.connect();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(message.requestId);
                reject(new Error('No acknowledgement received. Reload to check the latest table state before retrying.'));
            }, 30000);
            this.pending.set(message.requestId, {message, resolve, reject, timer});
            this.socket.send(JSON.stringify(message));
        });
    }
    close() {
        this.stopped = true; this.ready = false; clearTimeout(this.reconnectTimer);
        this.rejectReady?.(new Error('Connection closed')); this.connecting = null;
        for (const item of this.pending.values()) {clearTimeout(item.timer); item.reject(new Error('Connection closed'));}
        this.pending.clear(); this.socket?.close();
    }
};
