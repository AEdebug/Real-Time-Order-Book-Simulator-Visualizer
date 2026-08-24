/**
 * Charts — Canvas-based time-series chart renderers
 * 
 * Renders:
 *   - Spread history (line chart)
 *   - Imbalance history (area chart with pos/neg coloring)
 *   - Volume flow mini-chart
 * 
 * All charts use a shared mini-chart rendering pattern for consistency.
 */

class TimeSeriesChart {
  /**
   * @param {string} canvasId
   * @param {Object} options
   */
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;

    this.ctx = null;
    this.width = 0;
    this.height = 0;

    this.lineColor = options.lineColor || Utils.colors.accent;
    this.fillColor = options.fillColor || Utils.colors.accentDim;
    this.label = options.label || '';
    this.formatValue = options.formatValue || ((v) => v.toFixed(2));
    this.showZeroLine = options.showZeroLine || false;
    this.bipolar = options.bipolar || false; // true for imbalance (pos/neg)

    this.data = [];

    this._setupCanvas();
    this._setupResize();
  }

  _setupCanvas() {
    if (!this.canvas) return;
    const result = Utils.setupCanvas(this.canvas);
    this.ctx = result.ctx;
    this.width = result.width;
    this.height = result.height;
  }

  _setupResize() {
    if (!this.canvas) return;
    const resizeObserver = new ResizeObserver(() => {
      this._setupCanvas();
      this.draw();
    });
    resizeObserver.observe(this.canvas.parentElement);
  }

  /**
   * Update chart data
   * @param {Array<{value: number, timestamp: number}>} data
   */
  update(data) {
    if (!data || data.length === 0) return;
    this.data = data;
    this.draw();
  }

  draw() {
    if (!this.ctx || this.width === 0 || this.height === 0) return;

    const { ctx, width, height, data } = this;
    const padding = { top: 10, right: 8, bottom: 20, left: 8 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // Clear
    ctx.clearRect(0, 0, width, height);

    if (data.length < 2) return;

    // Calculate ranges
    const values = data.map(d => d.value);
    let minVal = Math.min(...values);
    let maxVal = Math.max(...values);

    // For bipolar charts, ensure symmetric range
    if (this.bipolar) {
      const absMax = Math.max(Math.abs(minVal), Math.abs(maxVal), 0.01);
      minVal = -absMax;
      maxVal = absMax;
    }

    // Add padding to range
    const range = maxVal - minVal || 1;
    minVal -= range * 0.05;
    maxVal += range * 0.05;
    const valRange = maxVal - minVal;

    // Scale functions
    const scaleX = (i) => padding.left + (i / (data.length - 1)) * chartW;
    const scaleY = (v) => padding.top + chartH - ((v - minVal) / valRange) * chartH;

    // Draw zero line for bipolar
    if (this.bipolar || this.showZeroLine) {
      const zeroY = scaleY(0);
      ctx.strokeStyle = Utils.colors.gridLine;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padding.left, zeroY);
      ctx.lineTo(padding.left + chartW, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw subtle grid
    ctx.strokeStyle = Utils.colors.gridLine;
    ctx.lineWidth = 0.3;
    for (let i = 1; i < 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();
    }

    if (this.bipolar) {
      this._drawBipolarArea(ctx, data, scaleX, scaleY, chartH, padding);
    } else {
      this._drawLineChart(ctx, data, scaleX, scaleY, chartH, padding);
    }

    // Draw latest value label
    const lastVal = data[data.length - 1].value;
    const lastY = scaleY(lastVal);
    ctx.fillStyle = this.lineColor;
    ctx.font = 'bold 11px "JetBrains Mono"';
    ctx.textAlign = 'right';
    ctx.fillText(this.formatValue(lastVal), width - 4, lastY - 6);

    // Draw endpoint dot
    ctx.beginPath();
    ctx.arc(scaleX(data.length - 1), lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = this.lineColor;
    ctx.fill();

    // Time axis labels
    this._drawTimeAxis(ctx, data, scaleX, padding, chartH);
  }

  _drawLineChart(ctx, data, scaleX, scaleY, chartH, padding) {
    const baseline = padding.top + chartH;

    // Fill area
    ctx.beginPath();
    ctx.moveTo(scaleX(0), baseline);
    for (let i = 0; i < data.length; i++) {
      ctx.lineTo(scaleX(i), scaleY(data[i].value));
    }
    ctx.lineTo(scaleX(data.length - 1), baseline);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, padding.top, 0, baseline);
    gradient.addColorStop(0, this.fillColor);
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      if (i === 0) ctx.moveTo(scaleX(i), scaleY(data[i].value));
      else ctx.lineTo(scaleX(i), scaleY(data[i].value));
    }
    ctx.strokeStyle = this.lineColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  _drawBipolarArea(ctx, data, scaleX, scaleY, chartH, padding) {
    const zeroY = scaleY(0);

    // Draw positive area (green)
    ctx.beginPath();
    ctx.moveTo(scaleX(0), zeroY);
    for (let i = 0; i < data.length; i++) {
      const y = Math.min(scaleY(data[i].value), zeroY);
      ctx.lineTo(scaleX(i), y);
    }
    ctx.lineTo(scaleX(data.length - 1), zeroY);
    ctx.closePath();
    const greenGrad = ctx.createLinearGradient(0, padding.top, 0, zeroY);
    greenGrad.addColorStop(0, Utils.colors.greenFill);
    greenGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = greenGrad;
    ctx.fill();

    // Draw negative area (red)
    ctx.beginPath();
    ctx.moveTo(scaleX(0), zeroY);
    for (let i = 0; i < data.length; i++) {
      const y = Math.max(scaleY(data[i].value), zeroY);
      ctx.lineTo(scaleX(i), y);
    }
    ctx.lineTo(scaleX(data.length - 1), zeroY);
    ctx.closePath();
    const redGrad = ctx.createLinearGradient(0, zeroY, 0, padding.top + chartH);
    redGrad.addColorStop(0, 'transparent');
    redGrad.addColorStop(1, Utils.colors.redFill);
    ctx.fillStyle = redGrad;
    ctx.fill();

    // Main line with color based on value
    for (let i = 1; i < data.length; i++) {
      ctx.beginPath();
      ctx.moveTo(scaleX(i - 1), scaleY(data[i - 1].value));
      ctx.lineTo(scaleX(i), scaleY(data[i].value));
      ctx.strokeStyle = data[i].value >= 0 ? Utils.colors.green : Utils.colors.red;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  _drawTimeAxis(ctx, data, scaleX, padding, chartH) {
    ctx.fillStyle = Utils.colors.textDim;
    ctx.font = '9px "JetBrains Mono"';
    ctx.textAlign = 'center';

    const labelCount = 4;
    for (let i = 0; i <= labelCount; i++) {
      const idx = Math.floor((data.length - 1) * (i / labelCount));
      if (data[idx]) {
        const x = scaleX(idx);
        ctx.fillText(Utils.formatTimeShort(data[idx].timestamp), x, padding.top + chartH + 14);
      }
    }
  }
}

/**
 * ChartsManager — creates and manages all time-series charts
 */
class ChartsManager {
  constructor() {
    this.spreadChart = new TimeSeriesChart('spread-canvas', {
      lineColor: Utils.colors.accent,
      fillColor: Utils.colors.accentDim,
      label: 'Spread (BPS)',
      formatValue: (v) => v.toFixed(2) + ' bps',
      showZeroLine: false
    });

    this.imbalanceChart = new TimeSeriesChart('imbalance-canvas', {
      lineColor: Utils.colors.accent,
      fillColor: Utils.colors.accentDim,
      label: 'Imbalance',
      formatValue: (v) => (v >= 0 ? '+' : '') + v.toFixed(3),
      bipolar: true
    });

    this.volumeChart = new TimeSeriesChart('volume-canvas', {
      lineColor: Utils.colors.accent,
      fillColor: 'rgba(217, 164, 65, 0.15)',
      label: 'Volume',
      formatValue: (v) => Utils.formatQtyShort(v)
    });

    // Gauge elements
    this.gaugeGreen = document.getElementById('gauge-green');
    this.gaugeRed = document.getElementById('gauge-red');
    this.gaugeBuyPct = document.getElementById('gauge-buy-pct');
    this.gaugeSellPct = document.getElementById('gauge-sell-pct');

    // Volume bar elements
    this.buyVolFill = document.getElementById('buy-vol-fill');
    this.sellVolFill = document.getElementById('sell-vol-fill');
    this.buyVolText = document.getElementById('buy-vol-text');
    this.sellVolText = document.getElementById('sell-vol-text');
  }

  /**
   * Update all charts with metrics history
   */
  update(metricsHistory, metrics) {
    if (!metricsHistory) return;

    // Update spread chart
    if (metricsHistory.spreadBps) {
      this.spreadChart.update(metricsHistory.spreadBps);
    }

    // Update imbalance chart
    if (metricsHistory.imbalance) {
      this.imbalanceChart.update(metricsHistory.imbalance);
    }

    // Update imbalance gauge
    if (metrics && metrics.imbalance !== null && metrics.imbalance !== undefined) {
      const imb = metrics.imbalance;
      const buyPct = ((imb + 1) / 2 * 100); // convert -1..1 to 0..100
      const sellPct = 100 - buyPct;

      if (this.gaugeGreen) {
        this.gaugeGreen.style.width = Math.max(0, imb * 50) + '%';
      }
      if (this.gaugeRed) {
        this.gaugeRed.style.width = Math.max(0, -imb * 50) + '%';
      }
      if (this.gaugeBuyPct) {
        this.gaugeBuyPct.textContent = buyPct.toFixed(1) + '%';
      }
      if (this.gaugeSellPct) {
        this.gaugeSellPct.textContent = sellPct.toFixed(1) + '%';
      }
    }

    // Update trade flow volume bars
    if (metrics && metrics.tradeFlow) {
      const tf = metrics.tradeFlow;
      const total = tf.buyVolume + tf.sellVolume;
      if (total > 0) {
        const buyPct = (tf.buyVolume / total * 100).toFixed(1);
        const sellPct = (tf.sellVolume / total * 100).toFixed(1);
        if (this.buyVolFill) this.buyVolFill.style.width = buyPct + '%';
        if (this.sellVolFill) this.sellVolFill.style.width = sellPct + '%';
        if (this.buyVolText) this.buyVolText.textContent = Utils.formatQtyShort(tf.buyVolume);
        if (this.sellVolText) this.sellVolText.textContent = Utils.formatQtyShort(tf.sellVolume);
      }
    }

    // Update volume chart with buy volume history
    if (metricsHistory.buyVolume) {
      this.volumeChart.update(metricsHistory.buyVolume);
    }
  }
}
