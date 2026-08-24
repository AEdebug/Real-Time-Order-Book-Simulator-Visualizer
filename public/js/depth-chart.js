/**
 * DepthChart — Canvas-based market depth visualization
 * 
 * Renders a mountain/area chart showing cumulative bid and ask volume
 * at each price level. This is one of the most iconic trading visualizations.
 * 
 * Features:
 *   - Gradient-filled area charts for bids (green) and asks (red)
 *   - Smooth animated transitions between data updates
 *   - Hover tooltip showing price/volume at cursor position
 *   - Grid lines and price axis labels
 *   - Mid-price indicator line
 */

class DepthChart {
  constructor() {
    this.canvas = document.getElementById('depth-canvas');
    this.loadingOverlay = document.getElementById('depth-loading');
    this.ctx = null;
    this.width = 0;
    this.height = 0;

    // Animation state
    this.currentBids = [];
    this.currentAsks = [];
    this.targetBids = [];
    this.targetAsks = [];
    this.animationProgress = 1;

    // Hover state
    this.mouseX = -1;
    this.mouseY = -1;
    this.isHovering = false;

    // Render loop
    this.animFrameId = null;
    this.isFirstData = true;

    this._setupCanvas();
    this._setupEvents();
    this._startRenderLoop();
  }

  _setupCanvas() {
    const result = Utils.setupCanvas(this.canvas);
    this.ctx = result.ctx;
    this.width = result.width;
    this.height = result.height;
  }

  _setupEvents() {
    // Resize handling
    const resizeObserver = new ResizeObserver(() => {
      this._setupCanvas();
    });
    resizeObserver.observe(this.canvas.parentElement);

    // Mouse events for tooltip
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      this.isHovering = true;
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.isHovering = false;
      this.mouseX = -1;
      this.mouseY = -1;
    });
  }

  /**
   * Update with new order book data
   * @param {Object} data — { bids: [{price, quantity, total}], asks: [...] }
   */
  update(data) {
    if (!data.bids || !data.asks || data.bids.length === 0) return;

    if (this.isFirstData) {
      this.loadingOverlay.style.display = 'none';
      this.isFirstData = false;
    }

    this.targetBids = data.bids.slice().reverse(); // lowest price first for drawing
    this.targetAsks = data.asks.slice(); // lowest price first

    // If first update, snap immediately
    if (this.currentBids.length === 0) {
      this.currentBids = JSON.parse(JSON.stringify(this.targetBids));
      this.currentAsks = JSON.parse(JSON.stringify(this.targetAsks));
    }

    this.animationProgress = 0;
  }

  _startRenderLoop() {
    const render = () => {
      this._animate();
      this._draw();
      this.animFrameId = requestAnimationFrame(render);
    };
    render();
  }

  _animate() {
    if (this.animationProgress >= 1) return;
    this.animationProgress = Math.min(1, this.animationProgress + 0.15);

    const t = this._easeOutCubic(this.animationProgress);

    // Interpolate bids
    for (let i = 0; i < this.targetBids.length && i < this.currentBids.length; i++) {
      this.currentBids[i].total = Utils.lerp(this.currentBids[i].total, this.targetBids[i].total, t);
      this.currentBids[i].price = Utils.lerp(this.currentBids[i].price, this.targetBids[i].price, t);
    }

    // Interpolate asks
    for (let i = 0; i < this.targetAsks.length && i < this.currentAsks.length; i++) {
      this.currentAsks[i].total = Utils.lerp(this.currentAsks[i].total, this.targetAsks[i].total, t);
      this.currentAsks[i].price = Utils.lerp(this.currentAsks[i].price, this.targetAsks[i].price, t);
    }

    if (this.animationProgress >= 1) {
      this.currentBids = JSON.parse(JSON.stringify(this.targetBids));
      this.currentAsks = JSON.parse(JSON.stringify(this.targetAsks));
    }
  }

  _easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  _draw() {
    const { ctx, width, height } = this;
    if (width === 0 || height === 0) return;

    const padding = { top: 20, right: 60, bottom: 30, left: 20 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // Clear
    ctx.clearRect(0, 0, width, height);

    if (this.currentBids.length === 0 || this.currentAsks.length === 0) return;

    // Calculate ranges
    const allPrices = [...this.currentBids.map(l => l.price), ...this.currentAsks.map(l => l.price)];
    const minPrice = Math.min(...allPrices);
    const maxPrice = Math.max(...allPrices);
    const priceRange = maxPrice - minPrice || 1;

    const maxTotal = Math.max(
      ...this.currentBids.map(l => l.total),
      ...this.currentAsks.map(l => l.total)
    );

    // Scale functions
    const scaleX = (price) => padding.left + ((price - minPrice) / priceRange) * chartW;
    const scaleY = (total) => padding.top + chartH - (total / maxTotal) * chartH;

    // Draw grid lines
    this._drawGrid(ctx, padding, chartW, chartH, minPrice, maxPrice, maxTotal);

    // Draw bid area (green, left side)
    this._drawArea(ctx, this.currentBids, scaleX, scaleY, chartH, padding,
      Utils.colors.green, Utils.colors.greenFill, 'bid');

    // Draw ask area (red, right side)
    this._drawArea(ctx, this.currentAsks, scaleX, scaleY, chartH, padding,
      Utils.colors.red, Utils.colors.redFill, 'ask');

    // Draw mid-price line
    const midPrice = (this.currentBids[this.currentBids.length - 1]?.price +
                      this.currentAsks[0]?.price) / 2;
    if (midPrice) {
      const midX = scaleX(midPrice);
      ctx.strokeStyle = Utils.colors.accentDim;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(midX, padding.top);
      ctx.lineTo(midX, padding.top + chartH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Mid price label
      ctx.fillStyle = Utils.colors.accent;
      ctx.font = '10px "JetBrains Mono"';
      ctx.textAlign = 'center';
      ctx.fillText(Utils.formatPrice(midPrice), midX, padding.top - 6);
    }

    // Draw hover tooltip
    if (this.isHovering) {
      this._drawTooltip(ctx, scaleX, scaleY, minPrice, priceRange, maxTotal, padding, chartW, chartH);
    }

    // Price axis labels
    this._drawPriceAxis(ctx, padding, chartW, chartH, minPrice, maxPrice);

    // Volume axis labels
    this._drawVolumeAxis(ctx, padding, chartW, chartH, maxTotal);
  }

  _drawArea(ctx, levels, scaleX, scaleY, chartH, padding, lineColor, fillColor, side) {
    if (levels.length < 2) return;

    const baseline = padding.top + chartH;

    // Build path points
    const points = levels.map(l => ({ x: scaleX(l.price), y: scaleY(l.total) }));

    // Draw filled area
    ctx.beginPath();

    if (side === 'bid') {
      ctx.moveTo(points[0].x, baseline);
      // Step-style line (horizontal then vertical) for bid side
      for (let i = 0; i < points.length; i++) {
        if (i === 0) {
          ctx.lineTo(points[i].x, points[i].y);
        } else {
          ctx.lineTo(points[i].x, points[i - 1].y); // horizontal
          ctx.lineTo(points[i].x, points[i].y);       // vertical
        }
      }
      ctx.lineTo(points[points.length - 1].x, baseline);
    } else {
      ctx.moveTo(points[0].x, baseline);
      for (let i = 0; i < points.length; i++) {
        if (i === 0) {
          ctx.lineTo(points[i].x, points[i].y);
        } else {
          ctx.lineTo(points[i].x, points[i - 1].y);
          ctx.lineTo(points[i].x, points[i].y);
        }
      }
      ctx.lineTo(points[points.length - 1].x, baseline);
    }

    ctx.closePath();

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, padding.top, 0, baseline);
    gradient.addColorStop(0, fillColor);
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw line on top
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      if (i === 0) {
        ctx.moveTo(points[i].x, points[i].y);
      } else {
        ctx.lineTo(points[i].x, points[i - 1].y);
        ctx.lineTo(points[i].x, points[i].y);
      }
    }
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  _drawGrid(ctx, padding, chartW, chartH, minPrice, maxPrice, maxTotal) {
    ctx.strokeStyle = Utils.colors.gridLine;
    ctx.lineWidth = 0.5;

    // Horizontal grid lines (4 lines)
    for (let i = 1; i <= 4; i++) {
      const y = padding.top + (chartH / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();
    }

    // Vertical grid lines (6 lines)
    for (let i = 1; i <= 5; i++) {
      const x = padding.left + (chartW / 6) * i;
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + chartH);
      ctx.stroke();
    }
  }

  _drawPriceAxis(ctx, padding, chartW, chartH, minPrice, maxPrice) {
    ctx.fillStyle = Utils.colors.textMuted;
    ctx.font = '10px "JetBrains Mono"';
    ctx.textAlign = 'center';

    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const price = minPrice + (maxPrice - minPrice) * (i / steps);
      const x = padding.left + (chartW / steps) * i;
      ctx.fillText(Utils.formatPrice(price), x, padding.top + chartH + 16);
    }
  }

  _drawVolumeAxis(ctx, padding, chartW, chartH, maxTotal) {
    ctx.fillStyle = Utils.colors.textMuted;
    ctx.font = '10px "JetBrains Mono"';
    ctx.textAlign = 'left';

    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const vol = maxTotal * (1 - i / steps);
      const y = padding.top + (chartH / steps) * i;
      ctx.fillText(Utils.formatQtyShort(vol), padding.left + chartW + 6, y + 4);
    }
  }

  _drawTooltip(ctx, scaleX, scaleY, minPrice, priceRange, maxTotal, padding, chartW, chartH) {
    // Determine which price level the cursor is near
    const cursorPrice = minPrice + ((this.mouseX - padding.left) / chartW) * priceRange;

    // Find closest level
    const allLevels = [...this.currentBids, ...this.currentAsks];
    let closest = null;
    let closestDist = Infinity;
    for (const level of allLevels) {
      const dist = Math.abs(level.price - cursorPrice);
      if (dist < closestDist) {
        closestDist = dist;
        closest = level;
      }
    }

    if (!closest) return;

    const x = scaleX(closest.price);
    const y = scaleY(closest.total);

    // Crosshair lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartH);
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartW, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dot
    const isBid = this.currentBids.includes(closest);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = isBid ? Utils.colors.green : Utils.colors.red;
    ctx.fill();

    // Tooltip box
    const tooltipText = `${Utils.formatPrice(closest.price)} | Vol: ${Utils.formatQtyShort(closest.total)}`;
    ctx.font = '11px "JetBrains Mono"';
    const textWidth = ctx.measureText(tooltipText).width;
    const tipX = Math.min(x + 10, padding.left + chartW - textWidth - 16);
    const tipY = Math.max(y - 30, padding.top + 4);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.strokeStyle = isBid ? Utils.colors.greenDim : Utils.colors.redDim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(tipX, tipY, textWidth + 12, 22, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = Utils.colors.textPrimary;
    ctx.textAlign = 'left';
    ctx.fillText(tooltipText, tipX + 6, tipY + 15);
  }
}
