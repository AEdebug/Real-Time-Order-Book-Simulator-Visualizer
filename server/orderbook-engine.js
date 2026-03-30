/**
 * OrderBookEngine — Core Limit Order Book Data Structure
 * 
 * This is the heart of the simulator. It maintains two sides of the book:
 *   - BIDS (buy orders) sorted by price DESCENDING (highest first)
 *   - ASKS (sell orders) sorted by price ASCENDING (lowest first)
 * 
 * Each price level contains a queue of orders following PRICE-TIME PRIORITY:
 *   1. Orders at better prices are filled first
 *   2. At the same price, earlier orders are filled first (FIFO)
 * 
 * The engine supports:
 *   - Syncing with live market data from Binance
 *   - Adding simulated limit/market orders
 *   - Matching simulated orders against the live book
 *   - Tracking fills and P&L
 * 
 * @module orderbook-engine
 */

'use strict';

// ─────────────────────────────────────────────────────────────
//  Order Class — represents a single order in the book
// ─────────────────────────────────────────────────────────────

class Order {
  static _idCounter = 0;

  /**
   * @param {'buy'|'sell'} side
   * @param {number} price
   * @param {number} quantity
   * @param {'limit'|'market'} type
   * @param {'market'|'simulated'} source — 'market' for Binance data, 'simulated' for user orders
   */
  constructor(side, price, quantity, type = 'limit', source = 'market') {
    this.id = ++Order._idCounter;
    this.side = side;
    this.price = parseFloat(price);
    this.quantity = parseFloat(quantity);
    this.remainingQty = parseFloat(quantity);
    this.type = type;
    this.source = source;
    this.timestamp = Date.now();
    this.status = 'open'; // open, partial, filled, cancelled
    this.fills = [];      // array of { price, quantity, timestamp }
    this.queueAhead = 0;  // realistic queue simulation
  }

  get filledQty() {
    return this.quantity - this.remainingQty;
  }

  get avgFillPrice() {
    if (this.fills.length === 0) return 0;
    const totalCost = this.fills.reduce((sum, f) => sum + f.price * f.quantity, 0);
    const totalQty = this.fills.reduce((sum, f) => sum + f.quantity, 0);
    return totalQty > 0 ? totalCost / totalQty : 0;
  }
}

// ─────────────────────────────────────────────────────────────
//  PriceLevel — all orders at a single price point
// ─────────────────────────────────────────────────────────────

class PriceLevel {
  /**
   * @param {number} price
   */
  constructor(price) {
    this.price = parseFloat(price);
    this.orders = [];       // FIFO queue — first in, first out
    this.totalQuantity = 0; // aggregate quantity at this level
  }

  addOrder(order) {
    this.orders.push(order);
    this.totalQuantity += order.remainingQty;
  }

  removeOrder(orderId) {
    const idx = this.orders.findIndex(o => o.id === orderId);
    if (idx === -1) return null;
    const order = this.orders.splice(idx, 1)[0];
    this.totalQuantity -= order.remainingQty;
    return order;
  }

  /**
   * Recalculate total from orders (used after matching)
   */
  recalculate() {
    this.totalQuantity = this.orders.reduce((sum, o) => sum + o.remainingQty, 0);
  }

  get isEmpty() {
    return this.orders.length === 0 || this.totalQuantity <= 0;
  }
}

// ─────────────────────────────────────────────────────────────
//  OrderBookEngine — the main engine
// ─────────────────────────────────────────────────────────────

class OrderBookEngine {
  /**
   * @param {string} symbol — trading pair, e.g. 'BTCUSDT'
   */
  constructor(symbol = 'BTCUSDT') {
    this.symbol = symbol;

    // Market order book (sorted arrays instead of maps for O(log N) updates)
    this._sortedBids = []; // descending by price (highest first)
    this._sortedAsks = []; // ascending by price (lowest first)

    // Simulated order book (user's orders)
    this.simulatedOrders = new Map(); // Map<orderId, Order>

    // Trade history
    this.trades = [];          // recent trades from the market
    this.simulatedTrades = []; // trades from simulated order matching
    this.maxTradeHistory = 500;

    // Snapshot metadata
    this.lastUpdateTime = null;
    this.updateCount = 0;
  }

  // ───────────────────────────────────────────
  //  MARKET DATA SYNC (from Binance)
  // ───────────────────────────────────────────

  /**
   * Process a depth snapshot/update from Binance.
   * Binance sends arrays of [price, quantity] pairs.
   * If quantity is 0, the price level should be removed.
   * 
   * @param {Array<[string, string]>} bids — [[price, qty], ...]
   * @param {Array<[string, string]>} asks — [[price, qty], ...]
   */
  updateFromBinance(bids, asks) {
    // Update bids (descending)
    for (const [priceStr, qtyStr] of bids) {
      this._updateLevelArray(this._sortedBids, parseFloat(priceStr), parseFloat(qtyStr), true);
    }

    // Update asks (ascending)
    for (const [priceStr, qtyStr] of asks) {
      this._updateLevelArray(this._sortedAsks, parseFloat(priceStr), parseFloat(qtyStr), false);
    }

    // Check if any simulated limit orders should be filled due to price movement
    this._checkSimulatedFills();

    this.lastUpdateTime = Date.now();
    this.updateCount++;
  }

  /**
   * O(log N) Binary Search Insertion/Update/Deletion
   * @private
   */
  _updateLevelArray(array, price, qty, isBid) {
    let low = 0, high = array.length - 1;
    let mid;

    while (low <= high) {
      mid = (low + high) >>> 1;
      const cmp = isBid ? (array[mid].price - price) : (price - array[mid].price);
      
      if (cmp > 0) {
        low = mid + 1;
      } else if (cmp < 0) {
        high = mid - 1;
      } else {
        // Found exact price level
        if (qty <= 0) {
          array.splice(mid, 1); // O(N) shift, but typically very fast for small arrays
        } else {
          // Instead of modifying the phantom order, just update the level total
          array[mid].totalQuantity = qty;
        }
        return;
      }
    }

    // Not found, insert at index 'low'
    if (qty > 0) {
      const level = new PriceLevel(price);
      level.totalQuantity = qty; 
      array.splice(low, 0, level);
    }
  }

  /**
   * Record a trade from the Binance trade stream
   * @param {Object} trade — { price, quantity, isBuyerMaker, timestamp }
   */
  recordTrade(trade) {
    const price = parseFloat(trade.price);
    const quantity = parseFloat(trade.quantity);
    const side = trade.isBuyerMaker ? 'sell' : 'buy';

    this.trades.unshift({
      price, quantity, side,
      timestamp: trade.timestamp || Date.now(),
      source: 'market'
    });

    if (this.trades.length > this.maxTradeHistory) {
      this.trades.length = this.maxTradeHistory;
    }

    // Process realistic queue position execution
    this._processQueuePosition(price, quantity, side);
  }

  /**
   * Adjust queue position for waiting simulated orders
   * @private
   */
  _processQueuePosition(tradePrice, tradeQty, tradeSide) {
    for (const [, order] of this.simulatedOrders) {
      if (order.status === 'filled' || order.status === 'cancelled') continue;
      
      // If a trade happens at the exact same price and side as our resting limit order
      if (order.type === 'limit' && order.side === tradeSide && order.price === tradePrice) {
        // Reduce the queue ahead of us
        order.queueAhead -= tradeQty;

        // If queue is eaten, start filling our order
        if (order.queueAhead < 0) {
          const fillQty = Math.min(order.remainingQty, Math.abs(order.queueAhead));
          this._executeFill(order, order.price, fillQty);
          order.queueAhead = 0; // reset for remaining
        }
      }
    }
  }

  // ───────────────────────────────────────────
  //  SIMULATED ORDER PLACEMENT
  // ───────────────────────────────────────────

  /**
   * Place a simulated limit order
   * @param {'buy'|'sell'} side
   * @param {number} price
   * @param {number} quantity
   * @returns {Order} the created order
   */
  placeLimitOrder(side, price, quantity) {
    const parsedPrice = parseFloat(price);
    const order = new Order(side, parsedPrice, parseFloat(quantity), 'limit', 'simulated');
    
    // Determine realistic queue position
    const oppositeArray = side === 'buy' ? this._sortedBids : this._sortedAsks;
    const existingLevel = oppositeArray.find(l => l.price === parsedPrice);
    order.queueAhead = existingLevel ? existingLevel.totalQuantity : 0;

    this.simulatedOrders.set(order.id, order);

    // Try immediate matching if marketable
    const fills = this._tryMatchOrder(order);

    return { order, fills };
  }

  /**
   * Place a simulated market order (executes immediately against the book)
   * @param {'buy'|'sell'} side
   * @param {number} quantity
   * @returns {Object} { order, fills }
   */
  placeMarketOrder(side, quantity) {
    const order = new Order(side, 0, parseFloat(quantity), 'market', 'simulated');
    this.simulatedOrders.set(order.id, order);

    const fills = this._tryMatchOrder(order);

    return { order, fills };
  }

  /**
   * Cancel a simulated order
   * @param {number} orderId
   * @returns {Order|null}
   */
  cancelOrder(orderId) {
    const order = this.simulatedOrders.get(orderId);
    if (!order || order.status === 'filled' || order.status === 'cancelled') {
      return null;
    }
    order.status = 'cancelled';
    return order;
  }

  // ───────────────────────────────────────────
  //  MATCHING ENGINE
  // ───────────────────────────────────────────

  /**
   * Try to match a simulated order against the market book.
   * 
   * For a BUY order: match against asks (lowest first)
   * For a SELL order: match against bids (highest first)
   * 
   * Market orders match at any price.
   * Limit orders only match at their limit price or better.
   * 
   * @param {Order} order
   * @returns {Array<Object>} fills
   * @private
   */
  _tryMatchOrder(order) {
    const fills = [];
    const oppositeSide = order.side === 'buy' ? this._sortedAsks : this._sortedBids;

    for (const level of oppositeSide) {
      if (order.remainingQty <= 0) break;

      // Marketable limit check
      if (order.type === 'limit') {
        if (order.side === 'buy' && level.price > order.price) break;
        if (order.side === 'sell' && level.price < order.price) break;
      }

      // Calculate fill quantity
      const fillQty = Math.min(order.remainingQty, level.totalQuantity);
      if (fillQty > 0) {
        fills.push(this._executeFill(order, level.price, fillQty));
      }
    }

    return fills;
  }

  /**
   * Internal helper to record a fill
   * @private
   */
  _executeFill(order, fillPrice, fillQty) {
    const fill = {
      price: fillPrice,
      quantity: fillQty,
      timestamp: Date.now(),
      orderId: order.id
    };

    order.fills.push(fill);
    order.remainingQty -= fillQty;

    this.simulatedTrades.unshift({
      price: fillPrice,
      quantity: fillQty,
      side: order.side,
      timestamp: Date.now(),
      source: 'simulated',
      orderId: order.id
    });

    if (order.remainingQty <= 0) {
      order.remainingQty = 0;
      order.status = 'filled';
    } else {
      order.status = 'partial';
    }

    return fill;
  }

  /**
   * Check if any resting simulated limit orders should be filled
   * based on current market prices.
   * Called after each market data update.
   * @private
   */
  _checkSimulatedFills() {
    for (const [, order] of this.simulatedOrders) {
      if (order.status === 'filled' || order.status === 'cancelled') continue;
      if (order.type !== 'limit') continue;

      // Check if the market has moved through the order's price
      if (order.side === 'buy') {
        const bestAsk = this.getBestAsk();
        if (bestAsk && bestAsk <= order.price) {
          this._tryMatchOrder(order);
        }
      } else {
        const bestBid = this.getBestBid();
        if (bestBid && bestBid >= order.price) {
          this._tryMatchOrder(order);
        }
      }
    }
  }



  // ───────────────────────────────────────────
  //  GETTERS — Book State
  // ───────────────────────────────────────────

  /** @returns {number|null} highest bid price */
  getBestBid() {
    return this._sortedBids.length > 0 ? this._sortedBids[0].price : null;
  }

  /** @returns {number|null} lowest ask price */
  getBestAsk() {
    return this._sortedAsks.length > 0 ? this._sortedAsks[0].price : null;
  }

  /** @returns {number|null} difference between best ask and best bid */
  getSpread() {
    const bid = this.getBestBid();
    const ask = this.getBestAsk();
    if (bid === null || ask === null) return null;
    return ask - bid;
  }

  /** @returns {number|null} spread as basis points (1 bp = 0.01%) */
  getSpreadBps() {
    const spread = this.getSpread();
    const mid = this.getMidPrice();
    if (spread === null || mid === null || mid === 0) return null;
    return (spread / mid) * 10000;
  }

  /** @returns {number|null} average of best bid and best ask */
  getMidPrice() {
    const bid = this.getBestBid();
    const ask = this.getBestAsk();
    if (bid === null || ask === null) return null;
    return (bid + ask) / 2;
  }

  /**
   * Get the top N price levels on each side
   * @param {number} depth — number of levels per side
   * @returns {{ bids: Array, asks: Array }}
   */
  getDepth(depth = 20) {
    const bids = this._sortedBids.slice(0, depth).map(level => ({
      price: level.price,
      quantity: level.totalQuantity,
      total: 0 // will be filled below
    }));

    const asks = this._sortedAsks.slice(0, depth).map(level => ({
      price: level.price,
      quantity: level.totalQuantity,
      total: 0
    }));

    // Calculate cumulative totals
    let bidCumulative = 0;
    for (const level of bids) {
      bidCumulative += level.quantity;
      level.total = bidCumulative;
    }

    let askCumulative = 0;
    for (const level of asks) {
      askCumulative += level.quantity;
      level.total = askCumulative;
    }

    return { bids, asks };
  }

  /**
   * Order book imbalance ratio.
   * Positive = more buying pressure, Negative = more selling pressure.
   * Range: [-1, 1]
   * 
   * Formula: (totalBidVolume - totalAskVolume) / (totalBidVolume + totalAskVolume)
   * 
   * This is a real signal used in HFT to predict short-term price direction.
   * 
   * @param {number} levels — number of top levels to include
   * @returns {number|null}
   */
  getImbalance(levels = 5) {
    const topBids = this._sortedBids.slice(0, levels);
    const topAsks = this._sortedAsks.slice(0, levels);

    const bidVol = topBids.reduce((sum, l) => sum + l.totalQuantity, 0);
    const askVol = topAsks.reduce((sum, l) => sum + l.totalQuantity, 0);

    const total = bidVol + askVol;
    if (total === 0) return null;

    return (bidVol - askVol) / total;
  }

  /**
   * Get all open simulated orders
   * @returns {Array<Order>}
   */
  getSimulatedOrders() {
    return Array.from(this.simulatedOrders.values())
      .filter(o => o.status === 'open' || o.status === 'partial');
  }

  /**
   * Get complete snapshot of the order book state for the frontend
   * @returns {Object}
   */
  getSnapshot() {
    const depth = this.getDepth(20);
    return {
      symbol: this.symbol,
      timestamp: this.lastUpdateTime,
      updateCount: this.updateCount,
      bids: depth.bids,
      asks: depth.asks,
      bestBid: this.getBestBid(),
      bestAsk: this.getBestAsk(),
      spread: this.getSpread(),
      spreadBps: this.getSpreadBps(),
      midPrice: this.getMidPrice(),
      imbalance: this.getImbalance(),
      recentTrades: this.trades.slice(0, 50),
      simulatedOrders: this.getSimulatedOrders().map(o => ({
        id: o.id,
        side: o.side,
        price: o.price,
        quantity: o.quantity,
        remainingQty: o.remainingQty,
        status: o.status,
        filledQty: o.filledQty,
        avgFillPrice: o.avgFillPrice,
        timestamp: o.timestamp
      }))
    };
  }
}

module.exports = { OrderBookEngine, Order, PriceLevel };
