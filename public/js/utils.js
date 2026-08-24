/**
 * Utility functions used across all dashboard modules.
 */

const Utils = {
  /**
   * Format a price for display with appropriate decimal places
   */
  formatPrice(price, decimals) {
    if (price === null || price === undefined || isNaN(price)) return '—';
    const p = parseFloat(price);
    if (decimals !== undefined) {
      return p.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    // Auto-detect decimals based on magnitude
    if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (p >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    return p.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
  },

  /**
   * Format quantity (volume)
   */
  formatQty(qty, decimals = 5) {
    if (qty === null || qty === undefined || isNaN(qty)) return '—';
    const q = parseFloat(qty);
    if (q >= 1000) return q.toFixed(2);
    if (q >= 1) return q.toFixed(4);
    return q.toFixed(decimals);
  },

  /**
   * Format a short quantity for compact display
   */
  formatQtyShort(qty) {
    const q = parseFloat(qty);
    if (q >= 1000000) return (q / 1000000).toFixed(2) + 'M';
    if (q >= 1000) return (q / 1000).toFixed(2) + 'K';
    if (q >= 1) return q.toFixed(2);
    return q.toFixed(4);
  },

  /**
   * Format basis points
   */
  formatBps(bps) {
    if (bps === null || bps === undefined || isNaN(bps)) return '—';
    return parseFloat(bps).toFixed(2) + ' bps';
  },

  /**
   * Format timestamp to HH:MM:SS.ms
   */
  formatTime(ts) {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ms = String(Math.floor(d.getMilliseconds() / 100));
    return `${h}:${m}:${s}.${ms}`;
  },

  /**
   * Format time for chart axis (HH:MM:SS)
   */
  formatTimeShort(ts) {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  },

  /**
   * Lerp (linear interpolation) for smooth animations
   */
  lerp(start, end, factor) {
    return start + (end - start) * factor;
  },

  /**
   * Clamp a value between min and max
   */
  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  },

  /**
   * Setup a canvas for high-DPI (retina) displays
   */
  setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, width: rect.width, height: rect.height, dpr };
  },

  /**
   * Throttle function calls
   */
  throttle(fn, delay) {
    let lastCall = 0;
    return function (...args) {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        return fn.apply(this, args);
      }
    };
  },

  /** CSS variable color getters */
  colors: {
    green: '#3fb950',
    greenDim: 'rgba(63, 185, 80, 0.4)',
    greenFill: 'rgba(63, 185, 80, 0.12)',
    red: '#f85149',
    redDim: 'rgba(248, 81, 73, 0.4)',
    redFill: 'rgba(248, 81, 73, 0.12)',
    accent: '#d9a441',
    accentDim: 'rgba(217, 164, 65, 0.4)',
    textPrimary: '#e6e8eb',
    textSecondary: '#8b93a1',
    textMuted: '#565d68',
    textDim: '#33373f',
    bgPrimary: '#0a0d12',
    bgSecondary: '#10141b',
    bgTertiary: '#161b24',
    gridLine: 'rgba(139, 147, 161, 0.15)',
  }
};
