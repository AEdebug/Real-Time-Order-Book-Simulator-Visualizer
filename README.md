# Real-Time Order Book Simulator & Visualizer

A stunning, highly-performant trading terminal and limit order book (LOB) engine that connects to Binance's live market data via WebSockets. It calculates real-time market microstructure metrics (spread, imbalance, VWAP) and allows you to simulate placing limit and market orders directly into the live order book.

Built for **High-Frequency Trading (HFT)** and quantitative development demonstration.

## Features

*   **Live Market Data**: Streams real-time top-20 order book depth and live trades from Binance WebSockets.
*   **Custom Matching Engine**: Maintains a fully-sorted, price-time priority Limit Order Book engine in Node.js. 
*   **Performance First**: Real-time rendering via HTML5 Canvas for silky smooth charts running at 60 FPS under heavy data loads.
*   **Microstructure Analytics**: Real-time calculation and visualization of order book imbalance, spread BPS, and trade flow volume.
*   **Simulated Trading**: Place mock LIMIT and MARKET orders directly onto the live book and watch them get matched via the simulated backend matching engine.
*   **Professional UI**: Glassmorphic, dark-terminal aesthetic with responsive grid layout and neon accents. 

## Technology Stack

*   **Backend Engine**: Node.js, Express, Socket.IO
*   **Data Feed**: Binance public WebSockets (`stream.binance.com`)
*   **Frontend**: Vanilla HTML/CSS/JavaScript
*   **Charts Visualization**: HTML5 Canvas Rendering (Zero heavyweight dependencies)

## Project Structure

*   **/server**: The core Node.js backend. Includes `Index.js` (Express/Socket.io), `binance-feed.js` (WebSocket ingestion), `orderbook-engine.js` (Core limit order book), and `metrics.js` (Analytics engine).
*   **/public**: The frontend visualization. Includes `css/styles.css`, `index.html`, and several JS modules like `orderbook-view.js` and `depth-chart.js`.

## Getting Started

1.  **Install Dependencies**
    ```bash
    npm install
    ```
2.  **Start the Server**
    ```bash
    npm start
    ```
3.  **View the Dashboard**
    Open `http://localhost:3000` in your web browser. 

*No API keys are required as this uses the public Binance WebSocket streams.*

## Technical Highlights for Quant/HFT Roles

*   **Custom Data Structures**: `server/orderbook-engine.js` implements a bespoke price-time priority matching engine rather than relying on out-of-the-box libraries.
*   **Event-Driven Architecture**: Fast asynchronous data pipelines passing data from Binance WS -> Node Event Emitters -> Engine Processing -> Express/Socket.IO emit -> Frontend receive.
*   **Microstructure Signals**: Includes raw implementations for common HFT signals like the Order Book Imbalance ratio (`(bidVol - askVol) / (bidVol + askVol)`). 
