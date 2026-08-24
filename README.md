# Ladder

![CI](https://github.com/AEdebug/ladder/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)

A real-time limit order book simulator and visualizer. Ladder connects to Binance's public market data over WebSockets, mirrors a live order book, and computes market microstructure metrics (spread, mid-price, order book imbalance, VWAP, rolling volatility) on top of it. You can also drop simulated limit and market orders onto the live book and watch them queue and fill.

<!-- TODO: add a screenshot or short GIF of the dashboard here once hosted -->
<!-- ![Dashboard screenshot](docs/screenshot.png) -->

**Live demo:** _add your hosted URL here_

## Features

*   **Live market data**: streams real-time top-20 order book depth and trade prints from Binance's public WebSocket feed.
*   **Order book engine**: maintains a sorted, price-time-priority limit order book in Node.js, with O(log n) binary-search insertion/removal per price-level update.
*   **Microstructure analytics**: spread (absolute and bps), mid-price, order book imbalance, VWAP, and rolling volatility (computed with Welford's online algorithm for O(1) updates).
*   **Simulated trading**: place mock limit and market orders against the live book; resting limit orders track a simulated queue position and fill as matching trade prints come through.
*   **Canvas-rendered charts**: depth chart and metrics history rendered on HTML5 Canvas with no charting library dependency.

## Technology Stack

*   **Backend**: Node.js, Express, Socket.IO
*   **Data feed**: Binance's public market-data WebSocket (`data-stream.binance.vision`) — no API key required. This is Binance's dedicated market-data-only endpoint (as opposed to `stream.binance.com`, which is tied to the main trading site and geo-blocks connections from most cloud hosting regions).
*   **Frontend**: Vanilla HTML/CSS/JavaScript, HTML5 Canvas rendering
*   **Tests**: Jest

## Architecture

```
Binance WebSocket (depth20@100ms, trade)
        │
        ▼
BinanceFeed (server/binance-feed.js)
  — WS client, auto-reconnect with exponential backoff, emits 'depth'/'trade'
        │
        ▼
OrderBookEngine (server/orderbook-engine.js)
  — sorted bid/ask price levels, simulated order matching, queue simulation
        │
        ├──▶ MetricsEngine (server/metrics.js)
        │      — spread, imbalance, VWAP, Welford rolling volatility
        │
        ▼
Express + Socket.IO (server/index.js)
  — throttled broadcast to browser clients (5 fps), handles order placement
        │
        ▼
Browser (public/js/*.js)
  — Canvas-rendered order book, depth chart, trade tape, order panel
```

Market data and trade prints flow one-directionally from Binance through the engine to connected browsers. Simulated orders flow the other way: a client emits `place-order` over Socket.IO, the engine matches it against the current book snapshot, and fills are pushed back to that client.

## Getting Started

1.  **Install dependencies**
    ```bash
    npm install
    ```
2.  **Run the tests**
    ```bash
    npm test
    ```
3.  **Start the server**
    ```bash
    npm start
    ```
4.  **View the dashboard**
    Open `http://localhost:3000` in your browser.

*No API keys are required — this uses Binance's public WebSocket streams.*

## Known Limitations & Design Tradeoffs

Being upfront about these because they were deliberate simplifications, not oversights:

*   **Snapshot depth, not incremental diff-stream.** The feed subscribes to Binance's `@depth20@100ms` stream, which pushes a periodic aggregated top-20 snapshot. This is simpler and self-correcting (no sequence-number bookkeeping), but it's not the same as the incremental `@depth` diff-stream + `lastUpdateId`/`U`/`u`/`pu` reconciliation that a production order book reconstruction would use to track every level with byte-level accuracy between snapshots. The tradeoff: this implementation can't see individual order-level changes between 100ms ticks, only the net result.
*   **Floating-point price/quantity arithmetic.** Prices and quantities are parsed and compared as JS floats (`parseFloat`) rather than fixed-point/integer ticks. This is fine for a visualizer at the precision Binance sends, but it's the kind of thing a production trading system avoids to prevent rounding-error drift in comparisons and aggregations.
*   **Simulated fills don't deduct from the visible book.** A simulated order matches against the *displayed* snapshot liquidity to compute its fill price, but doesn't remove that liquidity from the local book — the next 100ms snapshot from Binance overwrites it anyway. In practice this means two large simulated orders placed within the same 100ms tick can both "fill" against the same displayed size.
*   **Queue position is an approximation.** Resting simulated limit orders track a `queueAhead` counter seeded from the visible size at that price level, decremented by same-price trade prints on the opposite side. It's a reasonable approximation of price-time priority, but Binance doesn't expose per-order cancellations, so cancelled orders ahead of you in the real book aren't reflected — only trades are.

## Project Structure

*   `/server` — Node.js backend: `index.js` (Express/Socket.IO entry point), `binance-feed.js` (WebSocket ingestion + reconnect logic), `orderbook-engine.js` (order book + matching engine), `metrics.js` (analytics engine).
*   `/public` — frontend dashboard: `index.html`, `logo.svg`, `css/styles.css`, and JS modules (`orderbook-view.js`, `depth-chart.js`, `charts.js`, `trade-tape.js`, `order-panel.js`, `utils.js`).
*   `/test` — Jest unit tests for the order book engine (matching, partial fills, cancellation, queue-depletion behavior).

## License

MIT — see [LICENSE](LICENSE).
