'use strict';

const { OrderBookEngine } = require('../server/orderbook-engine');

/** Build an engine pre-populated with a market data snapshot. */
function book(bids, asks) {
  const engine = new OrderBookEngine('BTCUSDT');
  engine.updateFromBinance(bids, asks);
  return engine;
}

describe('OrderBookEngine — market data sync', () => {
  test('starts empty: best bid/ask, spread, mid price, and imbalance are all null', () => {
    const engine = new OrderBookEngine();
    expect(engine.getBestBid()).toBeNull();
    expect(engine.getBestAsk()).toBeNull();
    expect(engine.getSpread()).toBeNull();
    expect(engine.getMidPrice()).toBeNull();
    expect(engine.getSpreadBps()).toBeNull();
    expect(engine.getImbalance()).toBeNull();
  });

  test('keeps bids sorted descending and asks sorted ascending regardless of input order', () => {
    const engine = book(
      [['100', '1'], ['99', '2'], ['101', '3']],
      [['105', '1'], ['107', '2'], ['106', '3']]
    );
    const { bids, asks } = engine.getDepth();
    expect(bids.map(l => l.price)).toEqual([101, 100, 99]);
    expect(asks.map(l => l.price)).toEqual([105, 106, 107]);
  });

  test('best bid/ask, spread, mid price, and spread bps are calculated correctly', () => {
    const engine = book([['100', '1']], [['101', '1']]);
    expect(engine.getBestBid()).toBe(100);
    expect(engine.getBestAsk()).toBe(101);
    expect(engine.getSpread()).toBe(1);
    expect(engine.getMidPrice()).toBe(100.5);
    expect(engine.getSpreadBps()).toBeCloseTo((1 / 100.5) * 10000, 6);
  });

  test('a zero-quantity update removes the price level', () => {
    const engine = book([['100', '1'], ['99', '2']], [['101', '1']]);
    expect(engine.getBestBid()).toBe(100);

    engine.updateFromBinance([['100', '0']], []);
    expect(engine.getBestBid()).toBe(99);
  });

  test('a repeated update at an existing price replaces the quantity (absolute, not additive)', () => {
    const engine = book([['100', '1']], []);
    engine.updateFromBinance([['100', '5']], []);
    const { bids } = engine.getDepth();
    expect(bids[0].quantity).toBe(5);
  });

  test('getDepth returns cumulative totals per side', () => {
    const engine = book([['100', '1'], ['99', '2'], ['98', '3']], []);
    const { bids } = engine.getDepth();
    expect(bids.map(l => l.total)).toEqual([1, 3, 6]);
  });
});

describe('OrderBookEngine — order book imbalance', () => {
  test('more bid volume than ask volume gives a positive imbalance', () => {
    const engine = book([['100', '8']], [['101', '2']]);
    expect(engine.getImbalance()).toBeCloseTo(0.6, 6); // (8-2)/10
  });

  test('more ask volume than bid volume gives a negative imbalance', () => {
    const engine = book([['100', '2']], [['101', '8']]);
    expect(engine.getImbalance()).toBeCloseTo(-0.6, 6);
  });

  test('equal volume on both sides gives zero imbalance', () => {
    const engine = book([['100', '5']], [['101', '5']]);
    expect(engine.getImbalance()).toBe(0);
  });
});

describe('OrderBookEngine — simulated limit orders', () => {
  test('a non-marketable limit order rests on the book without filling', () => {
    const engine = book([['100', '1']], [['101', '5']]);
    const { order, fills } = engine.placeLimitOrder('buy', 99, 1);
    expect(fills.length).toBe(0);
    expect(order.status).toBe('open');
    expect(order.remainingQty).toBe(1);
  });

  test('a marketable limit order fills immediately against the book', () => {
    const engine = book([['100', '1']], [['101', '5']]);
    const { order, fills } = engine.placeLimitOrder('buy', 101, 2);
    expect(fills.length).toBe(1);
    expect(fills[0].price).toBe(101);
    expect(fills[0].quantity).toBe(2);
    expect(order.status).toBe('filled');
    expect(order.remainingQty).toBe(0);
  });

  test('a marketable limit order walks the book across multiple price levels', () => {
    const engine = book([['100', '1']], [['101', '1'], ['102', '1'], ['103', '5']]);
    const { order, fills } = engine.placeLimitOrder('buy', 103, 2.5);
    expect(fills.map(f => [f.price, f.quantity])).toEqual([
      [101, 1], [102, 1], [103, 0.5]
    ]);
    expect(order.status).toBe('filled');
    expect(order.avgFillPrice).toBeCloseTo((101 * 1 + 102 * 1 + 103 * 0.5) / 2.5, 6);
  });

  test('a limit order partially fills when the book runs out of liquidity at its price', () => {
    const engine = book([], [['101', '1']]);
    const { order, fills } = engine.placeLimitOrder('buy', 101, 5);
    expect(fills.length).toBe(1);
    expect(order.status).toBe('partial');
    expect(order.remainingQty).toBe(4);
  });

  test('a sell limit order only matches against bids at or above its price', () => {
    const engine = book([['100', '2'], ['99', '2']], []);
    const { order, fills } = engine.placeLimitOrder('sell', 100, 1);
    expect(fills.length).toBe(1);
    expect(fills[0].price).toBe(100);
    expect(order.status).toBe('filled');
  });

  test('queueAhead is initialized from existing same-side resting volume at that price', () => {
    const engine = book([], [['101', '7']]);
    // No bids to match against, so this rests instead of filling.
    const { order } = engine.placeLimitOrder('sell', 101, 1);
    expect(order.status).toBe('open');
    expect(order.queueAhead).toBe(7);
  });
});

describe('OrderBookEngine — simulated market orders', () => {
  test('a market order fills immediately across levels regardless of price', () => {
    const engine = book([], [['101', '1'], ['102', '1']]);
    const { order, fills } = engine.placeMarketOrder('buy', 1.5);
    expect(fills.map(f => [f.price, f.quantity])).toEqual([[101, 1], [102, 0.5]]);
    expect(order.status).toBe('filled');
  });

  test('a market order partially fills when the book is thin, leaving quantity unfilled', () => {
    const engine = book([], [['101', '1']]);
    const { order } = engine.placeMarketOrder('buy', 5);
    expect(order.status).toBe('partial');
    expect(order.remainingQty).toBe(4);
  });

  test('a market order against an empty opposite book fills nothing', () => {
    const engine = new OrderBookEngine();
    const { order, fills } = engine.placeMarketOrder('buy', 1);
    expect(fills.length).toBe(0);
    expect(order.status).toBe('open');
  });
});

describe('OrderBookEngine — order cancellation', () => {
  test('cancelling an open order marks it cancelled', () => {
    const engine = book([['100', '1']], [['105', '1']]);
    const { order } = engine.placeLimitOrder('buy', 99, 1);
    const cancelled = engine.cancelOrder(order.id);
    expect(cancelled.status).toBe('cancelled');
  });

  test('cancelling an unknown order id returns null', () => {
    const engine = new OrderBookEngine();
    expect(engine.cancelOrder(999999)).toBeNull();
  });

  test('cancelling an already-filled order returns null', () => {
    const engine = book([], [['101', '5']]);
    const { order } = engine.placeLimitOrder('buy', 101, 1);
    expect(order.status).toBe('filled');
    expect(engine.cancelOrder(order.id)).toBeNull();
  });
});

describe('OrderBookEngine — resting order queue depletion from trade prints', () => {
  test('a resting buy order is only eaten by opposite-side (sell) trade prints at its price', () => {
    const engine = book([['100', '10']], [['101', '1']]);
    const { order } = engine.placeLimitOrder('buy', 100, 1); // rests behind existing 10 qty
    expect(order.queueAhead).toBe(10);

    // Same-side ('buy') prints at our price must NOT eat our queue.
    engine.recordTrade({ price: '100', quantity: '10', isBuyerMaker: false }); // -> side 'buy'
    expect(order.queueAhead).toBe(10);
    expect(order.status).toBe('open');

    // Opposite-side ('sell') prints at our price deplete the queue ahead of us.
    engine.recordTrade({ price: '100', quantity: '9', isBuyerMaker: true }); // -> side 'sell'
    expect(order.queueAhead).toBe(1);
    expect(order.status).toBe('open');

    engine.recordTrade({ price: '100', quantity: '2', isBuyerMaker: true }); // eats through and fills us
    expect(order.status).toBe('filled');
    expect(order.remainingQty).toBe(0);
  });

  test('trade prints at a different price do not affect a resting order', () => {
    const engine = book([['100', '10']], [['101', '1']]);
    const { order } = engine.placeLimitOrder('buy', 100, 1);

    engine.recordTrade({ price: '99', quantity: '50', isBuyerMaker: true });
    expect(order.queueAhead).toBe(10);
    expect(order.status).toBe('open');
  });
});

describe('OrderBookEngine — snapshot', () => {
  test('getSnapshot returns a well-formed object for the frontend', () => {
    const engine = book([['100', '1']], [['101', '1']]);
    const snapshot = engine.getSnapshot();

    expect(snapshot.symbol).toBe('BTCUSDT');
    expect(snapshot.bestBid).toBe(100);
    expect(snapshot.bestAsk).toBe(101);
    expect(snapshot.spread).toBe(1);
    expect(Array.isArray(snapshot.bids)).toBe(true);
    expect(Array.isArray(snapshot.asks)).toBe(true);
    expect(Array.isArray(snapshot.recentTrades)).toBe(true);
    expect(Array.isArray(snapshot.simulatedOrders)).toBe(true);
  });
});
