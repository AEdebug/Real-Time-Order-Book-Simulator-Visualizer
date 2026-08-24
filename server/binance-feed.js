/**
 * BinanceFeed — WebSocket connection to Binance's public market data
 * 
 * Connects to two streams:
 *   1. Depth stream (@depth20@100ms) — top 20 price levels, updated every 100ms
 *   2. Trade stream (@trade) — individual trades as they happen
 * 
 * No API key required. This is all public data.
 * 
 * The feed emits events that the server can listen to:
 *   - 'depth'  → order book snapshot with bids and asks
 *   - 'trade'  → individual trade execution
 *   - 'status' → connection status changes
 * 
 * @module binance-feed
 */

'use strict';

const WebSocket = require('ws');
const EventEmitter = require('events');

// Binance WebSocket base URL.
// NOTE: stream.binance.com is Binance's main trading-account WS endpoint and
// blocks connections from US-hosted cloud IPs (regulatory geo-blocking) —
// which is exactly what most free hosting tiers (e.g. Render's default
// Oregon region) look like. data-stream.binance.vision is Binance's
// dedicated market-data-only endpoint: same public depth/trade streams,
// no account/geo restrictions, built for this exact use case.
const BINANCE_WS_BASE = 'wss://data-stream.binance.vision';

class BinanceFeed extends EventEmitter {
  /**
   * @param {string} symbol — trading pair in lowercase, e.g. 'btcusdt'
   * @param {Object} options
   * @param {number} options.depthLevels — number of depth levels (5, 10, or 20)
   * @param {number} options.depthSpeed — update speed in ms (100 or 1000)
   * @param {number} options.reconnectDelay — ms to wait before reconnecting
   * @param {number} options.maxReconnectAttempts — max reconnection attempts
   */
  constructor(symbol = 'btcusdt', options = {}) {
    super();

    this.symbol = symbol.toLowerCase();
    this.depthLevels = options.depthLevels || 20;
    this.depthSpeed = options.depthSpeed || 100;
    this.reconnectDelay = options.reconnectDelay || 3000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 50;

    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.shouldReconnect = true;

    // Stats
    this.messagesReceived = 0;
    this.lastMessageTime = null;
    this.connectionStartTime = null;
  }

  /**
   * Build the combined stream URL.
   * Binance allows combining multiple streams into one WebSocket connection.
   * Format: /stream?streams=<stream1>/<stream2>/...
   */
  _buildStreamUrl() {
    const streams = [
      `${this.symbol}@depth${this.depthLevels}@${this.depthSpeed}ms`,
      `${this.symbol}@trade`
    ];
    return `${BINANCE_WS_BASE}/stream?streams=${streams.join('/')}`;
  }

  /**
   * Connect to Binance WebSocket
   */
  connect() {
    const url = this._buildStreamUrl();
    console.log(`[BinanceFeed] Connecting to ${url}`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.connectionStartTime = Date.now();
      console.log(`[BinanceFeed] ✓ Connected to Binance (${this.symbol.toUpperCase()})`);
      this.emit('status', { connected: true, symbol: this.symbol });
    });

    this.ws.on('message', (raw) => {
      try {
        const wrapper = JSON.parse(raw);
        this.messagesReceived++;
        this.lastMessageTime = Date.now();

        // Binance combined stream format: { stream: "...", data: {...} }
        const { stream, data } = wrapper;

        if (stream.includes('@depth')) {
          this._handleDepthMessage(data);
        } else if (stream.includes('@trade')) {
          this._handleTradeMessage(data);
        }
      } catch (err) {
        console.error('[BinanceFeed] Failed to parse message:', err.message);
      }
    });

    this.ws.on('close', (code, reason) => {
      this.isConnected = false;
      console.log(`[BinanceFeed] Connection closed (code: ${code})`);
      this.emit('status', { connected: false, symbol: this.symbol, code });

      if (this.shouldReconnect) {
        this._scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      console.error(`[BinanceFeed] WebSocket error:`, err.message);
      this.emit('status', { connected: false, error: err.message });
    });
  }

  /**
   * Handle depth (order book) snapshot message
   * 
   * Binance depth20 format:
   * {
   *   lastUpdateId: number,
   *   bids: [["price", "qty"], ...],   // sorted best to worst
   *   asks: [["price", "qty"], ...]    // sorted best to worst
   * }
   * 
   * @param {Object} data
   * @private
   */
  _handleDepthMessage(data) {
    this.emit('depth', {
      bids: data.bids,  // [[price, qty], ...]
      asks: data.asks,
      lastUpdateId: data.lastUpdateId,
      timestamp: Date.now()
    });
  }

  /**
   * Handle individual trade message
   * 
   * Binance trade format:
   * {
   *   e: "trade",
   *   E: eventTime,
   *   s: symbol,
   *   t: tradeId,
   *   p: price (string),
   *   q: quantity (string),
   *   b: buyerOrderId,
   *   a: sellerOrderId,
   *   T: tradeTime,
   *   m: isBuyerMaker (boolean)
   * }
   * 
   * @param {Object} data
   * @private
   */
  _handleTradeMessage(data) {
    this.emit('trade', {
      tradeId: data.t,
      price: data.p,
      quantity: data.q,
      isBuyerMaker: data.m,
      timestamp: data.T || Date.now()
    });
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   * @private
   */
  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[BinanceFeed] Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      this.emit('status', { connected: false, error: 'Max reconnect attempts reached' });
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff: 3s, 6s, 12s, 24s... capped at 60s
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      60000
    );

    console.log(`[BinanceFeed] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect();
      }
    }, delay);
  }

  /**
   * Change the trading symbol (disconnects and reconnects)
   * @param {string} newSymbol — e.g. 'ethusdt'
   */
  changeSymbol(newSymbol) {
    console.log(`[BinanceFeed] Switching from ${this.symbol} to ${newSymbol}`);
    this.symbol = newSymbol.toLowerCase();
    this.disconnect();
    setTimeout(() => this.connect(), 500);
  }

  /**
   * Disconnect from Binance
   */
  disconnect() {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    console.log('[BinanceFeed] Disconnected');
  }

  /**
   * Get connection statistics
   * @returns {Object}
   */
  getStats() {
    return {
      connected: this.isConnected,
      symbol: this.symbol,
      messagesReceived: this.messagesReceived,
      lastMessageTime: this.lastMessageTime,
      uptime: this.connectionStartTime ? Date.now() - this.connectionStartTime : 0,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

module.exports = { BinanceFeed };
