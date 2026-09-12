// ═══════════════════════════════════════════════════════════════════
// VELTRUVIA Telehealth WebSocket Client
// Handles WebRTC signaling over WebSocket for video calls.
// Usage: const client = new TelehealthClient(roomCode, token);
//        client.on('offer', (data) => ...);
//        await client.connect();
// ═══════════════════════════════════════════════════════════════════

class TelehealthClient {
  constructor(roomCode, token) {
    this.roomCode = roomCode;
    this.token = token;
    this.ws = null;
    this.handlers = {};
    this.reconnectAttempts = 0;
    this.maxReconnect = 5;
    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${location.host}/ws/telehealth?room=${this.roomCode}&token=${this.token}`;

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        console.log('[telehealth-ws] Connected to room', this.roomCode);
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._handleMessage(msg);
        } catch (e) {
          console.error('[telehealth-ws] Parse error:', e);
        }
      };

      this.ws.onclose = (event) => {
        this.connected = false;
        console.log('[telehealth-ws] Disconnected:', event.code, event.reason);

        if (event.code !== 4010 && this.reconnectAttempts < this.maxReconnect) {
          // Auto-reconnect (except when room ended)
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
          this.reconnectAttempts++;
          console.log(`[telehealth-ws] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
          setTimeout(() => this.connect().catch(() => {}), delay);
        }

        this._emit('disconnected', { code: event.code, reason: event.reason });
      };

      this.ws.onerror = (err) => {
        console.error('[telehealth-ws] Error:', err);
        reject(err);
      };
    });
  }

  send(type, data = {}) {
    if (!this.connected || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[telehealth-ws] Not connected, cannot send');
      return false;
    }
    this.ws.send(JSON.stringify({ type, data }));
    return true;
  }

  // WebRTC signaling helpers
  sendOffer(offer) { return this.send('offer', offer); }
  sendAnswer(answer) { return this.send('answer', answer); }
  sendCandidate(candidate) { return this.send('candidate', candidate); }
  sendChat(text) { return this.send('chat', { text }); }
  sendStatus(status) { return this.send('status', status); }

  disconnect() {
    if (this.ws) {
      this.maxReconnect = 0; // prevent reconnect
      this.ws.close(1000, 'Client disconnect');
    }
  }

  on(event, handler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }

  off(event, handler) {
    if (!this.handlers[event]) return;
    this.handlers[event] = this.handlers[event].filter(h => h !== handler);
  }

  _emit(event, data) {
    const handlers = this.handlers[event] || [];
    handlers.forEach(h => h(data));
  }

  _handleMessage(msg) {
    const { type } = msg;
    this._emit(type, msg);
  }
}

// Export for browser use
if (typeof window !== 'undefined') {
  window.TelehealthClient = TelehealthClient;
}
