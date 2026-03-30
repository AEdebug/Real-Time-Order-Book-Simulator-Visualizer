/**
 * OrderPanel — Simulated order placement UI
 * 
 * Allows users to:
 *   - Place limit and market orders (buy/sell)
 *   - View active simulated orders
 *   - See fill notifications
 *   - Track simple P&L from simulated trades
 */

class OrderPanel {
  constructor(socket) {
    this.socket = socket;
    this.activeOrders = new Map();
    this.fills = [];
    this.totalPnL = 0;
    this.netPosition = 0; // Net crypto exposure
    this.cashBalance = 100000; // Starting simulated capital
    this.startBalance = 100000;
    this.currentMidPrice = 0;

    // DOM references
    this.panel = document.getElementById('order-panel');
    if (!this.panel) return;

    this.sideButtons = this.panel.querySelectorAll('.side-btn');
    this.typeButtons = this.panel.querySelectorAll('.type-btn');
    this.priceInput = document.getElementById('order-price');
    this.qtyInput = document.getElementById('order-qty');
    this.priceGroup = document.getElementById('price-group');
    this.submitBtn = document.getElementById('submit-order');
    this.ordersContainer = document.getElementById('active-orders');
    this.fillsContainer = document.getElementById('recent-fills');
    this.pnlDisplay = document.getElementById('pnl-display');

    this.selectedSide = 'buy';
    this.selectedType = 'limit';

    this._setupEvents();
    this._setupSocketEvents();
  }

  _setupEvents() {
    if (!this.panel) return;

    // Side toggle (buy/sell)
    this.sideButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.sideButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedSide = btn.dataset.side;
        this._updateSubmitButton();
      });
    });

    // Type toggle (limit/market)
    this.typeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.typeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedType = btn.dataset.type;
        // Hide price input for market orders
        this.priceGroup.style.display = this.selectedType === 'market' ? 'none' : 'flex';
        this._updateSubmitButton();
      });
    });

    // Submit order
    this.submitBtn.addEventListener('click', () => this._submitOrder());

    // Enter key to submit
    this.qtyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._submitOrder();
    });
    this.priceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._submitOrder();
    });
  }

  _setupSocketEvents() {
    // Order result from server
    this.socket.on('order-result', (result) => {
      if (result.success) {
        this._onOrderPlaced(result.order, result.fills);
      } else {
        this._showNotification('Order failed: ' + result.error, 'error');
      }
    });

    // Order cancelled
    this.socket.on('order-cancelled', (result) => {
      if (result.success) {
        this.activeOrders.delete(result.orderId);
        this._renderActiveOrders();
        this._showNotification(`Order #${result.orderId} cancelled`, 'info');
      }
    });
  }

  updateMidPrice(midPrice) {
    this.currentMidPrice = midPrice;
    
    // Auto-fill price input if empty
    if (this.priceInput && !this.priceInput.value) {
      this.priceInput.value = Utils.formatPrice(midPrice).replace(/,/g, '');
    }

    // Update real-time Mark-to-Market P&L
    this._updatePnLDisplay();
  }

  _updatePnLDisplay() {
    if (!this.pnlDisplay) return;
    
    // MTM Value = Cash + (Net Position * Current Market Price)
    const mtmValue = this.cashBalance + (this.netPosition * this.currentMidPrice);
    this.totalPnL = mtmValue - this.startBalance;

    this.pnlDisplay.textContent = (this.totalPnL >= 0 ? '+$' : '-$') + Math.abs(this.totalPnL).toFixed(2);
    this.pnlDisplay.style.color = this.totalPnL > 0 ? 'var(--green)' 
      : this.totalPnL < 0 ? 'var(--red)' 
      : 'var(--text-secondary)';
  }

  _submitOrder() {
    const qty = parseFloat(this.qtyInput.value);
    if (!qty || qty <= 0) {
      this._showNotification('Enter a valid quantity', 'error');
      return;
    }

    const orderData = {
      side: this.selectedSide,
      type: this.selectedType,
      quantity: qty
    };

    if (this.selectedType === 'limit') {
      let price = parseFloat(this.priceInput.value);
      if (!price || price <= 0) {
        this._showNotification('Enter a valid price', 'error');
        return;
      }
      // Enforce realistic tick size (0.01 for BTCUSDT)
      price = Math.round(price * 100) / 100;
      orderData.price = price;
    }

    this.socket.emit('place-order', orderData);

    // Visual feedback
    this.submitBtn.textContent = 'Sending...';
    setTimeout(() => this._updateSubmitButton(), 500);
  }

  _onOrderPlaced(order, fills) {
    if (order.status === 'filled') {
      this._showNotification(
        `${order.side.toUpperCase()} ${order.quantity} filled @ ${Utils.formatPrice(order.price || fills[0]?.price)}`,
        order.side === 'buy' ? 'success-buy' : 'success-sell'
      );
    } else if (order.status === 'partial') {
      this.activeOrders.set(order.id, order);
      this._showNotification(`Order #${order.id} partially filled`, 'info');
    } else {
      this.activeOrders.set(order.id, order);
      this._showNotification(`Order #${order.id} placed`, 'info');
    }

    // Record fills and update P&L
    for (const fill of fills) {
      this.fills.unshift(fill);

      const fillVal = fill.price * fill.quantity;
      if (order.side === 'buy') {
        this.netPosition += fill.quantity;
        this.cashBalance -= fillVal;
      } else {
        this.netPosition -= fill.quantity;
        this.cashBalance += fillVal;
      }
    }
    
    if (this.fills.length > 20) this.fills.length = 20;

    this._updatePnLDisplay();
    this._renderActiveOrders();
    this._renderFills();

    // Clear inputs
    this.qtyInput.value = '';
  }

  _renderActiveOrders() {
    if (!this.ordersContainer) return;

    const orders = Array.from(this.activeOrders.values())
      .filter(o => o.status === 'open' || o.status === 'partial');

    if (orders.length === 0) {
      this.ordersContainer.innerHTML = '<div class="empty-state">No active orders</div>';
      return;
    }

    this.ordersContainer.innerHTML = orders.map(o => `
      <div class="active-order ${o.side}">
        <span class="order-side">${o.side.toUpperCase()}</span>
        <span class="order-detail">${Utils.formatQty(o.remainingQty)} @ ${Utils.formatPrice(o.price)}</span>
        <button class="cancel-btn" data-id="${o.id}">✕</button>
      </div>
    `).join('');

    // Attach cancel handlers
    this.ordersContainer.querySelectorAll('.cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.socket.emit('cancel-order', { orderId: parseInt(btn.dataset.id) });
      });
    });
  }

  _renderFills() {
    if (!this.fillsContainer) return;

    if (this.fills.length === 0) {
      this.fillsContainer.innerHTML = '<div class="empty-state">No fills yet</div>';
      return;
    }

    this.fillsContainer.innerHTML = this.fills.slice(0, 8).map(f => `
      <div class="fill-row">
        <span class="fill-price">${Utils.formatPrice(f.price)}</span>
        <span class="fill-qty">${Utils.formatQty(f.quantity)}</span>
        <span class="fill-time">${Utils.formatTime(f.timestamp)}</span>
      </div>
    `).join('');
  }

  _updateSubmitButton() {
    if (!this.submitBtn) return;
    const isBuy = this.selectedSide === 'buy';
    const label = this.selectedType === 'market' ? 'Market' : 'Limit';
    this.submitBtn.textContent = `${isBuy ? 'BUY' : 'SELL'} ${label}`;
    this.submitBtn.className = `submit-btn ${this.selectedSide}`;
  }

  _showNotification(message, type) {
    // Create floating notification
    const notif = document.createElement('div');
    notif.className = `order-notification ${type}`;
    notif.textContent = message;
    document.body.appendChild(notif);

    // Auto-remove
    setTimeout(() => {
      notif.classList.add('fade-out');
      setTimeout(() => notif.remove(), 300);
    }, 2500);
  }

  /**
   * Update from order book snapshot (track simulated orders)
   */
  updateFromSnapshot(data) {
    if (data.simulatedOrders) {
      this.activeOrders.clear();
      for (const o of data.simulatedOrders) {
        this.activeOrders.set(o.id, o);
      }
      this._renderActiveOrders();
    }
  }
}
