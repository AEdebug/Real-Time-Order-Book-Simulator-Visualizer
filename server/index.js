/**
 * Server — Express + Socket.IO entry point
 * 
 * This is the main server that:
 *   1. Connects to Binance WebSocket for live market data
 *   2. Feeds data into the OrderBookEngine
 *   3. Calculates real-time metrics
 *   4. Serves the frontend dashboard
 *   5. Relays real-time data to connected browser clients via Socket.IO
 *   6. Handles simulated order placement from clients
 * 
 * @module server
 */

'use strict';

const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const path = require('path');

const { OrderBookEngine } = require('./orderbook-engine');
const { BinanceFeed } = require('./binance-feed');
const { MetricsEngine } = require('./metrics');

// ─────────────────────────────────────────────────────────────
//  Configuration
// ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const DEFAULT_SYMBOL = process.env.SYMBOL || 'btcusdt';
const FRONTEND_UPDATE_INTERVAL = 200; // ms — how often to push updates to browser (5 fps)

// Supported trading pairs
const SUPPORTED_SYMBOLS = [
  'btcusdt', 'ethusdt', 'bnbusdt', 'solusdt', 'xrpusdt',
  'adausdt', 'dogeusdt', 'avaxusdt', 'dotusdt', 'linkusdt'
];

// ─────────────────────────────────────────────────────────────
//  Initialize Components
// ─────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 5000
});

// Core components
let orderBook = new OrderBookEngine(DEFAULT_SYMBOL.toUpperCase());
let binanceFeed = new BinanceFeed(DEFAULT_SYMBOL);
const metrics = new MetricsEngine({ historySize: 600 });

// ─────────────────────────────────────────────────────────────
//  Serve Static Frontend
// ─────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

// API endpoint for supported symbols
app.get('/api/symbols', (req, res) => {
  res.json({ symbols: SUPPORTED_SYMBOLS });
});

// API endpoint for current stats
app.get('/api/stats', (req, res) => {
  res.json({
    feed: binanceFeed.getStats(),
    engine: {
      symbol: orderBook.symbol,
      updateCount: orderBook.updateCount,
      lastUpdate: orderBook.lastUpdateTime
    },
    metrics: metrics.getLatestMetrics()
  });
});

// ─────────────────────────────────────────────────────────────
//  Binance Feed → Order Book Engine → Metrics
// ─────────────────────────────────────────────────────────────

binanceFeed.on('depth', (data) => {
  const start = process.hrtime.bigint();

  // Update the order book with new market data
  orderBook.updateFromBinance(data.bids, data.asks);

  // Record metrics
  const snapshot = orderBook.getSnapshot();
  metrics.recordSnapshot(snapshot);

  const end = process.hrtime.bigint();
  // Convert nanoseconds to microseconds
  const latencyUs = Number(end - start) / 1000;
  metrics.recordLatency(latencyUs);
});

binanceFeed.on('trade', (trade) => {
  // Record the trade in the order book
  orderBook.recordTrade(trade);

  // Record trade in metrics
  metrics.recordTrade({
    price: trade.price,
    quantity: trade.quantity,
    side: trade.isBuyerMaker ? 'sell' : 'buy'
  });

  // Broadcast trade immediately (trades are important events)
  io.emit('trade', {
    price: parseFloat(trade.price),
    quantity: parseFloat(trade.quantity),
    side: trade.isBuyerMaker ? 'sell' : 'buy',
    timestamp: trade.timestamp
  });
});

binanceFeed.on('status', (status) => {
  console.log(`[Server] Binance feed status:`, status);
  io.emit('feed-status', status);
});

// ─────────────────────────────────────────────────────────────
//  Push Updates to Frontend (throttled)
// ─────────────────────────────────────────────────────────────

let updateInterval;

function startUpdateLoop() {
  updateInterval = setInterval(() => {
    if (io.engine.clientsCount === 0) return; // No clients, skip

    const snapshot = orderBook.getSnapshot();
    const latestMetrics = metrics.getLatestMetrics();
    const metricsHistory = metrics.getAllHistory(200);

    io.emit('orderbook-update', {
      ...snapshot,
      metrics: latestMetrics,
      metricsHistory: metricsHistory
    });
  }, FRONTEND_UPDATE_INTERVAL);
}

// ─────────────────────────────────────────────────────────────
//  Socket.IO — Client Connections
// ─────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Server] Client connected: ${socket.id}`);

  // Send initial snapshot immediately
  const snapshot = orderBook.getSnapshot();
  const latestMetrics = metrics.getLatestMetrics();
  const metricsHistory = metrics.getAllHistory(200);

  socket.emit('orderbook-update', {
    ...snapshot,
    metrics: latestMetrics,
    metricsHistory: metricsHistory
  });

  socket.emit('feed-status', {
    connected: binanceFeed.isConnected,
    symbol: binanceFeed.symbol
  });

  // ── Handle simulated order placement ──

  socket.on('place-order', (data) => {
    console.log(`[Server] Order received:`, data);

    try {
      const side = data && data.side;
      const type = data && data.type;
      const quantity = Number(data && data.quantity);

      if (side !== 'buy' && side !== 'sell') {
        throw new Error('Invalid order side: must be "buy" or "sell"');
      }
      if (type !== 'market' && type !== 'limit') {
        throw new Error('Invalid order type: must be "market" or "limit"');
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Invalid quantity: must be a positive number');
      }

      let result;
      if (type === 'market') {
        result = orderBook.placeMarketOrder(side, quantity);
      } else {
        const price = Number(data.price);
        if (!Number.isFinite(price) || price <= 0) {
          throw new Error('Invalid price: must be a positive number');
        }
        result = orderBook.placeLimitOrder(side, price, quantity);
      }

      socket.emit('order-result', {
        success: true,
        order: {
          id: result.order.id,
          side: result.order.side,
          price: result.order.price,
          quantity: result.order.quantity,
          remainingQty: result.order.remainingQty,
          status: result.order.status,
          type: result.order.type
        },
        fills: result.fills
      });

      console.log(`[Server] Order ${result.order.id} placed: ${result.order.status}`);
    } catch (err) {
      socket.emit('order-result', {
        success: false,
        error: err.message
      });
    }
  });

  socket.on('cancel-order', (data) => {
    const orderId = Number(data && data.orderId);
    if (!Number.isFinite(orderId)) {
      socket.emit('order-cancelled', { success: false, orderId: data && data.orderId });
      return;
    }

    const order = orderBook.cancelOrder(orderId);
    socket.emit('order-cancelled', {
      success: !!order,
      orderId
    });
  });

  // ── Handle symbol change ──

  socket.on('change-symbol', (data) => {
    const newSymbol = (data && typeof data.symbol === 'string') ? data.symbol.toLowerCase() : null;
    if (!newSymbol || !SUPPORTED_SYMBOLS.includes(newSymbol)) {
      socket.emit('error', { message: `Unsupported symbol: ${newSymbol || '(none provided)'}` });
      return;
    }

    console.log(`[Server] Switching to ${newSymbol.toUpperCase()}`);

    // Reset everything for the new symbol
    orderBook = new OrderBookEngine(newSymbol.toUpperCase());
    binanceFeed.changeSymbol(newSymbol);

    // Notify all clients
    io.emit('symbol-changed', { symbol: newSymbol });
  });

  socket.on('disconnect', () => {
    console.log(`[Server] Client disconnected: ${socket.id}`);
  });
});

// ─────────────────────────────────────────────────────────────
//  Start Server
// ─────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║         ORDER BOOK SIMULATOR & VISUALIZER           ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Dashboard:  http://localhost:${PORT}                  ║`);
  console.log(`║  Symbol:     ${DEFAULT_SYMBOL.toUpperCase().padEnd(40)}║`);
  console.log(`║  Update Rate: ${FRONTEND_UPDATE_INTERVAL}ms (${(1000/FRONTEND_UPDATE_INTERVAL).toFixed(0)} fps)                          ║`);
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  // Connect to Binance
  binanceFeed.connect();

  // Start the frontend update loop
  startUpdateLoop();
});

// ─────────────────────────────────────────────────────────────
//  Graceful Shutdown
// ─────────────────────────────────────────────────────────────

function shutdown() {
  console.log('\n[Server] Shutting down...');
  clearInterval(updateInterval);
  binanceFeed.disconnect();
  server.close(() => {
    console.log('[Server] Goodbye!');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
