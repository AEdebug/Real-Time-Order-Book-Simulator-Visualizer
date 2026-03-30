/**
 * TradeTape — Live scrolling trade feed
 * 
 * Features:
 *   - Color-coded buy (green) / sell (red) trades
 *   - Whale trade highlighting for large trades
 *   - Smooth slide-in animation for new trades
 *   - Auto-scroll with new trades
 *   - Trade counter in header badge
 */

class TradeTape {
  constructor() {
    this.container = document.getElementById('trade-scroll');
    this.countBadge = document.getElementById('trade-count');
    
    this.trades = [];
    this.maxTrades = 100;
    this.tradeCount = 0;
    
    // Whale detection threshold (will be calibrated from data)
    this.whaleThreshold = 0;
    this.recentVolumes = [];
  }

  /**
   * Add a single trade (called on real-time 'trade' events)
   * @param {Object} trade — { price, quantity, side, timestamp }
   */
  addTrade(trade) {
    this.tradeCount++;
    this.countBadge.textContent = this.tradeCount.toLocaleString();

    // Track recent volumes for whale detection
    this.recentVolumes.push(trade.quantity);
    if (this.recentVolumes.length > 200) this.recentVolumes.shift();
    this._recalcWhaleThreshold();

    // Create trade row element
    const row = document.createElement('div');
    const isWhale = trade.quantity * trade.price > this.whaleThreshold;
    row.className = `trade-row ${trade.side}${isWhale ? ' whale' : ''}`;

    row.innerHTML = `
      <span class="trade-time">${Utils.formatTime(trade.timestamp)}</span>
      <span class="trade-price">${Utils.formatPrice(trade.price)}</span>
      <span class="trade-qty">${Utils.formatQty(trade.quantity)}</span>
      <span class="trade-side">${trade.side.toUpperCase()}</span>
    `;

    // Prepend (newest on top)
    this.container.prepend(row);

    // Keep DOM bounded
    while (this.container.children.length > this.maxTrades) {
      this.container.removeChild(this.container.lastChild);
    }
  }

  /**
   * Bulk update trades from snapshot (initial load)
   * @param {Array} trades
   */
  bulkUpdate(trades) {
    if (!trades || trades.length === 0) return;

    // Only do bulk update if container is empty
    if (this.container.children.length > 0) return;

    const fragment = document.createDocumentFragment();
    for (const trade of trades.slice(0, 50)) {
      const row = document.createElement('div');
      row.className = `trade-row ${trade.side}`;
      row.innerHTML = `
        <span class="trade-time">${Utils.formatTime(trade.timestamp)}</span>
        <span class="trade-price">${Utils.formatPrice(trade.price)}</span>
        <span class="trade-qty">${Utils.formatQty(trade.quantity)}</span>
        <span class="trade-side">${trade.side.toUpperCase()}</span>
      `;
      fragment.appendChild(row);
    }
    this.container.appendChild(fragment);
    this.tradeCount = trades.length;
    this.countBadge.textContent = this.tradeCount.toLocaleString();
  }

  /**
   * Recalculate whale threshold (top 5% by notional value)
   * @private
   */
  _recalcWhaleThreshold() {
    if (this.recentVolumes.length < 20) {
      this.whaleThreshold = Infinity;
      return;
    }
    const sorted = [...this.recentVolumes].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    this.whaleThreshold = sorted[p95Index] * 50000; // rough notional estimate
  }

  /**
   * Clear all trades (on symbol change)
   */
  clear() {
    this.container.innerHTML = '';
    this.trades = [];
    this.tradeCount = 0;
    this.recentVolumes = [];
    this.countBadge.textContent = '0';
  }
}
