/**
 * App — Main application entry point
 * 
 * Connects to the server via Socket.IO and distributes
 * real-time data to all visualization modules.
 */

(function () {
  'use strict';

  // ── Initialize modules ──
  const orderBookView = new OrderBookView();
  const depthChart = new DepthChart();
  const tradeTape = new TradeTape();
  const charts = new ChartsManager();

  // ── DOM References ──
  const symbolSelect = document.getElementById('symbol-select');
  const connectionStatus = document.getElementById('connection-status');
  const statusText = document.getElementById('status-text');
  const hMidPrice = document.getElementById('h-mid-price');
  const hSpread = document.getElementById('h-spread');
  const hSpreadBps = document.getElementById('h-spread-bps');
  const hImbalance = document.getElementById('h-imbalance');
  const hUpdates = document.getElementById('h-updates');
  const hLatency = document.getElementById('h-latency');

  // ── Price tracking for up/down coloring ──
  let previousMidPrice = null;

  // ── Socket.IO Connection ──
  const socket = io({
    reconnection: true,
    reconnectionAttempts: 50,
    reconnectionDelay: 1000
  });

  // ── Initialize Simulation Panel ──
  const orderPanel = new OrderPanel(socket);

  // ── Connection Events ──
  socket.on('connect', () => {
    console.log('✓ Connected to server');
    connectionStatus.className = 'connection-status connected';
    statusText.textContent = 'Connected';
  });

  socket.on('disconnect', () => {
    console.log('✗ Disconnected');
    connectionStatus.className = 'connection-status disconnected';
    statusText.textContent = 'Disconnected';
  });

  socket.on('feed-status', (data) => {
    if (data.connected) {
      connectionStatus.className = 'connection-status connected';
      statusText.textContent = 'LIVE · ' + data.symbol.toUpperCase();
    } else {
      connectionStatus.className = 'connection-status disconnected';
      statusText.textContent = data.error || 'Feed offline';
    }
  });

  // ── Main Order Book Update ──
  socket.on('orderbook-update', (data) => {
    // Update header stats
    updateHeaderStats(data);

    // Update order book ladder
    orderBookView.update(data);

    // Update depth chart
    depthChart.update(data);

    // Bulk update trades on initial load
    if (data.recentTrades) {
      tradeTape.bulkUpdate(data.recentTrades);
    }

    // Update simulation
    if (data.midPrice) orderPanel.updateMidPrice(data.midPrice);
    orderPanel.updateFromSnapshot(data);

    // Update analytics charts
    if (data.metricsHistory || data.metrics) {
      charts.update(data.metricsHistory, data.metrics);
    }

    // Update page title
    if (data.midPrice) {
      document.title = `${Utils.formatPrice(data.midPrice)} · ${data.symbol} · OrderBook`;
    }
  });

  // ── Real-time Trade Events ──
  socket.on('trade', (trade) => {
    tradeTape.addTrade(trade);
  });

  // ── Symbol Change ──
  symbolSelect.addEventListener('change', (e) => {
    const newSymbol = e.target.value;
    console.log(`Switching to ${newSymbol.toUpperCase()}`);
    socket.emit('change-symbol', { symbol: newSymbol });

    // Reset UI
    tradeTape.clear();
    previousMidPrice = null;

    connectionStatus.className = 'connection-status disconnected';
    statusText.textContent = 'Switching...';
  });

  socket.on('symbol-changed', (data) => {
    console.log(`Symbol changed to ${data.symbol}`);
    symbolSelect.value = data.symbol;
  });

  // ── Header Stats Update ──
  function updateHeaderStats(data) {
    // Mid price with up/down coloring
    if (data.midPrice !== null && data.midPrice !== undefined) {
      const formatted = Utils.formatPrice(data.midPrice);
      hMidPrice.textContent = '$' + formatted;

      if (previousMidPrice !== null) {
        if (data.midPrice > previousMidPrice) {
          hMidPrice.className = 'header-stat-value price-up';
        } else if (data.midPrice < previousMidPrice) {
          hMidPrice.className = 'header-stat-value price-down';
        } else {
          hMidPrice.className = 'header-stat-value price-neutral';
        }
      }
      previousMidPrice = data.midPrice;
    }

    // Spread
    if (data.spread !== null && data.spread !== undefined) {
      hSpread.textContent = '$' + Utils.formatPrice(data.spread);
    }

    // Spread BPS
    if (data.spreadBps !== null && data.spreadBps !== undefined) {
      hSpreadBps.textContent = data.spreadBps.toFixed(2) + ' bps';
    }

    // Imbalance
    if (data.imbalance !== null && data.imbalance !== undefined) {
      const imb = data.imbalance;
      hImbalance.textContent = (imb >= 0 ? '+' : '') + imb.toFixed(4);
      hImbalance.style.color = imb > 0.05 ? Utils.colors.green
        : imb < -0.05 ? Utils.colors.red
        : Utils.colors.textSecondary;
    }

    // Update count
    if (data.updateCount !== undefined) {
      hUpdates.textContent = data.updateCount.toLocaleString();
    }

    // Engine Latency
    if (data.metrics && data.metrics.engineLatencyUs !== undefined) {
      hLatency.textContent = data.metrics.engineLatencyUs.toFixed(1) + ' μs';
    }
  }

  // ── Error handling ──
  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });

  console.log('📊 Order Book Simulator — Dashboard loaded');
  console.log('Connecting to server...');
})();
