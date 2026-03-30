/**
 * MetricsEngine — Real-time market microstructure analytics
 * 
 * Calculates and tracks time-series data for:
 *   - Spread (absolute and basis points)
 *   - Mid-price
 *   - Order book imbalance
 *   - VWAP (Volume Weighted Average Price)
 *   - Trade flow (buy vs sell volume)
 *   - Volatility (rolling standard deviation of mid-price returns)
 * 
 * All metrics maintain a rolling history buffer for charting.
 * 
 * @module metrics
 */

'use strict';

class MetricsEngine {
  /**
   * @param {Object} options
   * @param {number} options.historySize — max data points to keep per metric
   * @param {number} options.vwapWindow — number of trades for VWAP calculation
   * @param {number} options.volatilityWindow — number of data points for volatility
   */
  constructor(options = {}) {
    this.historySize = options.historySize || 300;    // ~30 seconds at 100ms updates
    this.vwapWindow = options.vwapWindow || 100;
    this.volatilityWindow = options.volatilityWindow || 50;

    // Time-series history buffers
    this.history = {
      midPrice: [],
      spread: [],
      spreadBps: [],
      imbalance: [],
      vwap: [],
      buyVolume: [],
      sellVolume: [],
      tradeCount: [],
      volatility: [],
      engineLatency: []
    };

    // Accumulator for trade flow metrics (reset every snapshot)
    this._tradeAccumulator = {
      buyVolume: 0,
      sellVolume: 0,
      buyCount: 0,
      sellCount: 0,
      totalValue: 0,
      totalQuantity: 0,
      lastReset: Date.now()
    };

    // Previous mid-price for return calculation
    this._prevMidPrice = null;
    this._midPriceReturns = []; // Circular buffer/queue for rolling Welford
    
    // Welford's algorithm state for O(1) rolling variance
    this._welford = { count: 0, mean: 0, m2: 0 };
  }

  /**
   * Record a new order book snapshot and calculate metrics
   * @param {Object} snapshot — from OrderBookEngine.getSnapshot()
   */
  recordSnapshot(snapshot) {
    const now = Date.now();

    // Record core metrics
    this._pushMetric('midPrice', snapshot.midPrice, now);
    this._pushMetric('spread', snapshot.spread, now);
    this._pushMetric('spreadBps', snapshot.spreadBps, now);
    this._pushMetric('imbalance', snapshot.imbalance, now);

    // Calculate volatility from mid-price returns using O(1) Welford's Method
    if (snapshot.midPrice && this._prevMidPrice) {
      const ret = (snapshot.midPrice - this._prevMidPrice) / this._prevMidPrice;
      
      // Add new return to Welford tracker
      const w = this._welford;
      w.count++;
      const delta = ret - w.mean;
      w.mean += delta / w.count;
      const delta2 = ret - w.mean;
      w.m2 += delta * delta2;

      this._midPriceReturns.push(ret);

      // Remove oldest return if over window
      if (this._midPriceReturns.length > this.volatilityWindow) {
        const oldest = this._midPriceReturns.shift();
        w.count--;
        if (w.count === 0) {
          w.mean = 0; w.m2 = 0;
        } else {
          const old_mean = w.mean;
          w.mean = (w.count * w.mean - oldest) / w.count;
          w.m2 = w.m2 - (oldest - w.mean) * (oldest - old_mean);
        }
      }

      // Safeguard against float precision issues making m2 slightly negative
      if (w.m2 < 0) w.m2 = 0;
      
      const variance = w.count > 1 ? w.m2 / (w.count - 1) : 0;
      const volatility = Math.sqrt(variance);
      
      this._pushMetric('volatility', volatility, now);
    }

    this._prevMidPrice = snapshot.midPrice;

    // Record trade flow snapshot
    this._pushMetric('buyVolume', this._tradeAccumulator.buyVolume, now);
    this._pushMetric('sellVolume', this._tradeAccumulator.sellVolume, now);

    // Calculate VWAP
    if (this._tradeAccumulator.totalQuantity > 0) {
      const vwap = this._tradeAccumulator.totalValue / this._tradeAccumulator.totalQuantity;
      this._pushMetric('vwap', vwap, now);
    }
  }

  /**
   * Record a trade for metrics calculation
   * @param {Object} trade — { price, quantity, side }
   */
  recordTrade(trade) {
    const price = parseFloat(trade.price);
    const qty = parseFloat(trade.quantity);
    const value = price * qty;

    if (trade.side === 'buy') {
      this._tradeAccumulator.buyVolume += qty;
      this._tradeAccumulator.buyCount++;
    } else {
      this._tradeAccumulator.sellVolume += qty;
      this._tradeAccumulator.sellCount++;
    }

    this._tradeAccumulator.totalValue += value;
    this._tradeAccumulator.totalQuantity += qty;
  }

  /**
   * Get the latest metrics for dashboard display
   * @returns {Object}
   */
  getLatestMetrics() {
    return {
      midPrice: this._getLatest('midPrice'),
      spread: this._getLatest('spread'),
      spreadBps: this._getLatest('spreadBps'),
      imbalance: this._getLatest('imbalance'),
      vwap: this._getLatest('vwap'),
      volatility: this._getLatest('volatility'),
      engineLatencyUs: this._getLatest('engineLatency'),
      tradeFlow: {
        buyVolume: this._tradeAccumulator.buyVolume,
        sellVolume: this._tradeAccumulator.sellVolume,
        buyCount: this._tradeAccumulator.buyCount,
        sellCount: this._tradeAccumulator.sellCount,
        ratio: this._tradeAccumulator.buyVolume + this._tradeAccumulator.sellVolume > 0
          ? this._tradeAccumulator.buyVolume / (this._tradeAccumulator.buyVolume + this._tradeAccumulator.sellVolume)
          : 0.5
      }
    };
  }

  /**
   * Track processing latency
   * @param {number} latencyUs — Latency in microseconds
   */
  recordLatency(latencyUs) {
    if (!this.history['engineLatency']) this.history['engineLatency'] = [];
    this._pushMetric('engineLatency', latencyUs, Date.now());
  }

  /**
   * Get time-series data for charting
   * @param {string} metric — metric name
   * @param {number} points — number of data points to return
   * @returns {Array<{value: number, timestamp: number}>}
   */
  getHistory(metric, points = 100) {
    if (!this.history[metric]) return [];
    return this.history[metric].slice(-points);
  }

  /**
   * Get all history for the frontend charts
   * @param {number} points
   * @returns {Object}
   */
  getAllHistory(points = 100) {
    const result = {};
    for (const key of Object.keys(this.history)) {
      result[key] = this.history[key].slice(-points);
    }
    return result;
  }

  /**
   * Reset trade accumulator (call periodically)
   */
  resetTradeAccumulator() {
    this._tradeAccumulator = {
      buyVolume: 0,
      sellVolume: 0,
      buyCount: 0,
      sellCount: 0,
      totalValue: 0,
      totalQuantity: 0,
      lastReset: Date.now()
    };
  }

  // ─── Private Helpers ───────────────────────────

  /**
   * Push a metric value to its history buffer
   * @private
   */
  _pushMetric(name, value, timestamp) {
    if (value === null || value === undefined || isNaN(value)) return;

    this.history[name].push({
      value: value,
      timestamp: timestamp
    });

    // Keep buffer bounded
    if (this.history[name].length > this.historySize) {
      this.history[name].shift();
    }
  }

  /**
   * Get the latest value of a metric
   * @private
   */
  _getLatest(name) {
    const arr = this.history[name];
    return arr.length > 0 ? arr[arr.length - 1].value : null;
  }

  /**
   * O(1) standard deviation logic moved to inline Welford tracking above
   */
}

module.exports = { MetricsEngine };
