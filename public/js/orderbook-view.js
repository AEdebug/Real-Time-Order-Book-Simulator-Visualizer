/**
 * OrderBookView — Renders the order book ladder (bid/ask table)
 * 
 * Features:
 *   - Bid/ask price levels with volume bars
 *   - Cumulative total column
 *   - Price change flash animations
 *   - Auto-scroll to keep spread centered
 */

class OrderBookView {
  constructor() {
    this.asksContainer = document.getElementById('ladder-asks');
    this.bidsContainer = document.getElementById('ladder-bids');
    this.spreadContainer = document.getElementById('ladder-spread');
    this.scrollContainer = document.getElementById('ladder-scroll');
    this.loadingOverlay = document.getElementById('book-loading');

    this.previousBids = new Map();
    this.previousAsks = new Map();
    this.isFirstUpdate = true;
    this.hasScrolledToCenter = false;
  }

  /**
   * Update the order book ladder with new data
   * @param {Object} data — { bids, asks, spread, spreadBps }
   */
  update(data) {
    if (!data.bids || !data.asks) return;

    // Hide loading overlay on first data
    if (this.isFirstUpdate) {
      this.loadingOverlay.style.display = 'none';
      this.isFirstUpdate = false;
    }

    // Render asks (reversed — lowest ask at bottom, closest to spread)
    this._renderSide(this.asksContainer, data.asks, 'ask');

    // Render spread bar
    this._renderSpread(data);

    // Render bids (highest bid at top, closest to spread)
    this._renderSide(this.bidsContainer, data.bids, 'bid');

    // Center scroll on spread
    if (!this.hasScrolledToCenter) {
      this._scrollToSpread();
      this.hasScrolledToCenter = true;
    }

    // Track previous prices for flash detection
    this._updatePreviousPrices(data);
  }

  /**
   * Render one side of the order book
   */
  _renderSide(container, levels, side) {
    const maxTotal = levels.length > 0 ? levels[levels.length - 1].total : 1;
    const previousPrices = side === 'bid' ? this.previousBids : this.previousAsks;

    // Build HTML
    let html = '';
    for (const level of levels) {
      const barWidth = (level.total / maxTotal * 100).toFixed(1);
      const priceStr = Utils.formatPrice(level.price);
      const qtyStr = Utils.formatQty(level.quantity);
      const totalStr = Utils.formatQty(level.total);

      // Check for price change flash
      let flashClass = '';
      const prevQty = previousPrices.get(level.price);
      if (prevQty !== undefined && prevQty !== level.quantity) {
        flashClass = level.quantity > prevQty ? 'flash-green' : 'flash-red';
      }

      html += `<div class="ladder-row ${side} ${flashClass}">
        <div class="depth-bar" style="width: ${barWidth}%"></div>
        <span class="col-qty">${qtyStr}</span>
        <span class="col-price">${priceStr}</span>
        <span class="col-total">${totalStr}</span>
      </div>`;
    }

    container.innerHTML = html;
  }

  /**
   * Render the spread section between bids and asks
   */
  _renderSpread(data) {
    const spreadVal = data.spread !== null ? Utils.formatPrice(data.spread) : '—';
    const bpsVal = data.spreadBps !== null ? data.spreadBps.toFixed(2) + ' bps' : '';

    this.spreadContainer.innerHTML = `
      <span class="spread-value">$${spreadVal}</span>
      <span class="spread-label">${bpsVal}</span>
    `;
  }

  /**
   * Scroll so the spread section is visible and centered
   */
  _scrollToSpread() {
    requestAnimationFrame(() => {
      const spread = this.spreadContainer;
      if (spread) {
        spread.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    });
  }

  /**
   * Track previous quantities for flash animations
   */
  _updatePreviousPrices(data) {
    this.previousBids.clear();
    for (const level of data.bids) {
      this.previousBids.set(level.price, level.quantity);
    }
    this.previousAsks.clear();
    for (const level of data.asks) {
      this.previousAsks.set(level.price, level.quantity);
    }
  }
}
