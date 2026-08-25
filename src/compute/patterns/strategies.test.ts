import { describe, it, expect } from 'vitest';
import { detectOrderBlockContinuation } from '@/compute/patterns/order-block-continuation';
import { detectMacdDecelerationContinuation } from '@/compute/patterns/macd-deceleration-continuation';
import { detectLiquiditySweep } from '@/compute/patterns/liquidity-sweep';
import { detectLiquiditySweepReaction } from '@/compute/patterns/liquidity-sweep-reaction';
import type { Candle, MarketStructure, IndicatorSnapshot } from '@/types/domain';
import type { SmartMoneyResult } from '@/compute/indicators/smart-money';
import { detectStrongOrderBlockReaction } from '@/compute/patterns/strong-order-block-reaction';
import { detectImpulseBreakout } from '@/compute/patterns/impulse-breakout';
import { detectConsolidationBreakout } from '@/compute/patterns/consolidation-breakout';

function candle(
  time: number,
  open: number,
  close: number,
  high: number,
  low: number,
  volume = 100,
): Candle {
  return { time, open, high, low, close, volume };
}

const UP_STRUCTURE: MarketStructure = {
  trend: 'up', bos: true, choch: false, swingHigh: 130, swingLow: 97.6, provisional: false,
};

const DOWN_STRUCTURE: MarketStructure = {
  trend: 'down', bos: true, choch: false, swingHigh: 130, swingLow: 97.6, provisional: false,
};

const UP_STRUCTURE_FOR_OB: MarketStructure = {
  trend: 'up', bos: true, choch: false, swingHigh: 200, swingLow: 90, provisional: false,
};
const UP_STRUCTURE_NO_BOS: MarketStructure = {
  trend: 'up', bos: false, choch: false, swingHigh: 200, swingLow: 90, provisional: false,
};
const DOWN_STRUCTURE_FOR_OB: MarketStructure = {
  trend: 'down', bos: true, choch: false, swingHigh: 200, swingLow: 90, provisional: false,
};

const EMPTY_SMART_MONEY: SmartMoneyResult = {
  orderBlocks: [], fvgs: [], rejectionBlocks: [], bosEvents: [],
};

const NEUTRAL_SNAPSHOT: IndicatorSnapshot = {
  rsi: null, emaFast: null, emaSlow: null, macd: null, macdSignal: null, macdHistogram: null,
  atr: null, bollingerUpper: null, bollingerMiddle: null, bollingerLower: null,
  vwap: null, vwapIsProxyVolume: false, volumeProfilePoc: null, volumeProfilePocIsProxyVolume: false,
  meanReversionRsi: null, impulseVelocity: null, adx: null,
};

// Flat/ranging 30-bar warmup (constant high/low band, alternating bullish
// and bearish bodies) used as context for liquidity-sweep tests. Alternating
// bodies keep bar-level trend strength (checkTrendStrength) genuinely mixed
// (~50/50), so tests that rely on structure metadata (UP_STRUCTURE /
// DOWN_STRUCTURE) to satisfy the HTF-alignment gate aren't accidentally
// passing because of a directional bias baked into the candle bodies
// themselves. Constant high/low (99.4/100.6) gives ATR(14) a stable ~1.2
// baseline so wick-depth-in-ATR math is easy to reason about precisely.
const WARMUP_LOW = 99.4;
const WARMUP_HIGH = 100.6;

function flatWarmup(count = 30): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const bullish = i % 2 === 0;
    const open = bullish ? 99.9 : 100.1;
    const close = bullish ? 100.1 : 99.9;
    return candle(i, open, close, WARMUP_HIGH, WARMUP_LOW, 100);
  });
}

// Builds a synthetic uptrend whose MACD histogram genuinely decays in
// magnitude (same sign) over several bars and then flips sign on the final
// bar — the exact shape detectMacdDecelerationContinuation looks for.
// `tailSlopes` controls the last few bars' price deltas: the first several
// entries should be positive and shrinking (deceleration), and the last
// entry controls how sharply the final "pause/flip" bar moves — a small
// value keeps the flip subtle, a large negative value creates a deep
// pullback relative to the recent 15-bar swing (for Fibonacci-filter tests).
function macdDecelScenario(tailSlopes: number[]): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  let t = 0;
  for (let i = 0; i < 30; i++) {
    const slope = 0.3 + (2.7 * i) / 29;
    candles.push(candle(t++, price, price + slope, price + slope + 0.1, price - 0.1));
    price += slope;
  }
  for (let i = 0; i < 20; i++) {
    candles.push(candle(t++, price, price + 3.0, price + 3.1, price - 0.1));
    price += 3.0;
  }
  for (const slope of tailSlopes) {
    const open = price;
    const close = price + slope;
    const high = Math.max(open, close) + 0.1;
    const low = Math.min(open, close) - 0.1;
    candles.push(candle(t++, open, close, high, low));
    price = close;
  }
  return candles;
}

describe('detectOrderBlockContinuation', () => {
  it('returns null for insufficient candles', () => {
    expect(detectOrderBlockContinuation([])).toBeNull();
    expect(detectOrderBlockContinuation(Array.from({ length: 29 }, (_, i) => candle(i, 10, 11, 12, 9)))).toBeNull();
  });

  it('returns null when no untested order blocks exist', () => {
    const candles: Candle[] = Array.from({ length: 40 }, (_, i) =>
      candle(i, 100, 100.1, 100.2, 99.9),
    );
    expect(detectOrderBlockContinuation(candles)).toBeNull();
  });

  it('detects bullish OBC when fresh untested block aligns with MACD extreme', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      candles.push(candle(i, 100 + i * 0.5, 101 + i * 0.5, 102 + i * 0.5, 99 + i * 0.5));
    }
    for (let i = 40; i < 45; i++) {
      const base = 120 + (i - 40) * 3;
      candles.push(candle(i, base, base + 3, base + 4, base - 1));
    }
    const obIdx = 45;
    candles.push(candle(obIdx, 135, 132, 136, 131));
    candles.push(candle(obIdx + 1, 132, 137, 138, 131.5));
    candles.push(candle(obIdx + 2, 137, 139, 140, 136));

    const result = detectOrderBlockContinuation(candles);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('order-block-continuation');
    expect(result?.direction).toBe('buy');
  });

  it('returns null when RSI is already in an extreme reading (red flag, not a bonus miss)', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      candles.push(candle(i, 100 + i * 0.5, 101 + i * 0.5, 102 + i * 0.5, 99 + i * 0.5));
    }
    for (let i = 40; i < 45; i++) {
      const base = 120 + (i - 40) * 3;
      candles.push(candle(i, base, base + 3, base + 4, base - 1));
    }
    const obIdx = 45;
    candles.push(candle(obIdx, 135, 132, 136, 131));
    candles.push(candle(obIdx + 1, 132, 137, 138, 131.5));
    candles.push(candle(obIdx + 2, 137, 139, 140, 136));

    const extremeSnapshot: IndicatorSnapshot = { ...NEUTRAL_SNAPSHOT, rsi: 80 };
    // Without the RSI filter this scenario is the same as the happy-path
    // test above and would be detected — demonstrating the filter actually
    // blocks it, not just that it happens to return null anyway.
    expect(detectOrderBlockContinuation(candles, extremeSnapshot)).toBeNull();

    const normalSnapshot: IndicatorSnapshot = { ...NEUTRAL_SNAPSHOT, rsi: 50 };
    expect(detectOrderBlockContinuation(candles, normalSnapshot)).not.toBeNull();
  });

  it('boosts confidence in a Kill Zone session vs a non-Kill-Zone session', () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      candles.push(candle(i, 100 + i * 0.5, 101 + i * 0.5, 102 + i * 0.5, 99 + i * 0.5));
    }
    for (let i = 40; i < 45; i++) {
      const base = 120 + (i - 40) * 3;
      candles.push(candle(i, base, base + 3, base + 4, base - 1));
    }
    const obIdx = 45;
    candles.push(candle(obIdx, 135, 132, 136, 131));
    candles.push(candle(obIdx + 1, 132, 137, 138, 131.5));
    candles.push(candle(obIdx + 2, 137, 139, 140, 136));

    const withKillZone = detectOrderBlockContinuation(candles, NEUTRAL_SNAPSHOT, 'london');
    const withoutKillZone = detectOrderBlockContinuation(candles, NEUTRAL_SNAPSHOT, 'sydney');
    expect(withKillZone).not.toBeNull();
    expect(withoutKillZone).not.toBeNull();
    expect(withKillZone!.confidence).toBeGreaterThan(withoutKillZone!.confidence);
  });
});

describe('detectMacdDecelerationContinuation', () => {
  it('returns null for insufficient candles', () => {
    expect(detectMacdDecelerationContinuation([])).toBeNull();
    expect(detectMacdDecelerationContinuation(Array.from({ length: 34 }, (_, i) => candle(i, 10, 11, 12, 9)))).toBeNull();
  });

  it('returns null in range market', () => {
    const candles: Candle[] = Array.from({ length: 50 }, (_, i) =>
      candle(i, 100, 100.1, 100.5, 99.5),
    );
    expect(detectMacdDecelerationContinuation(candles)).toBeNull();
  });

  it('detects continuation signal in uptrend with MACD deceleration pattern', () => {
    const candles = macdDecelScenario([2.6, 2.2, 1.7, 1.1, 0.4]);
    const result = detectMacdDecelerationContinuation(candles);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('macd-deceleration-continuation');
    expect(result?.direction).toBe('buy');
  });

  it('returns null when RSI has not crossed 50 in the direction of the trend (red flag)', () => {
    const candles = macdDecelScenario([2.6, 2.2, 1.7, 1.1, 0.4]);
    // Without the RSI filter this is the same scenario as the happy-path
    // test above and would be detected — demonstrating the filter actually
    // blocks it.
    expect(detectMacdDecelerationContinuation(candles, { ...NEUTRAL_SNAPSHOT, rsi: 40 })).toBeNull();
    expect(detectMacdDecelerationContinuation(candles, { ...NEUTRAL_SNAPSHOT, rsi: 55 })).not.toBeNull();
  });

  it('boosts confidence in a Kill Zone session vs no session', () => {
    const candles = macdDecelScenario([2.6, 2.2, 1.7, 1.1, 0.4]);
    const withKillZone = detectMacdDecelerationContinuation(candles, NEUTRAL_SNAPSHOT, 'london');
    const withoutSession = detectMacdDecelerationContinuation(candles, NEUTRAL_SNAPSHOT);
    expect(withKillZone).not.toBeNull();
    expect(withoutSession).not.toBeNull();
    expect(withKillZone!.confidence).toBeGreaterThan(withoutSession!.confidence);
  });

  it('returns null when the pullback into the pause has retraced past 78.6% of the recent swing', () => {
    // Same shape as the happy path, but the final bar is a much deeper
    // decline relative to the recent 15-bar swing range, pushing the
    // Fibonacci retracement ratio past the 78.6% invalidation line.
    const deepCandles = macdDecelScenario([2.6, 2.2, 1.7, 1.1, -30]);
    expect(detectMacdDecelerationContinuation(deepCandles)).toBeNull();

    // A shallower (but still notable, ~69%) retracement stays under the
    // 78.6% line and is still allowed through (with the 0.618-0.786 soft
    // penalty applied internally).
    const shallowerCandles = macdDecelScenario([2.6, 2.2, 1.7, 1.1, -26]);
    expect(detectMacdDecelerationContinuation(shallowerCandles)).not.toBeNull();
  });
});

describe('detectStrongOrderBlockReaction', () => {
  function buildScenario(): Candle[] {
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) candles.push(candle(i, 100, 100.2, 101, 99, 100));
    candles.push(candle(20, 106, 101, 107, 100, 100)); // bearish block candle
    candles.push(candle(21, 101, 115, 116, 100.5, 150)); // impulse, displacement >> 2xATR
    for (let i = 22; i < 28; i++) {
      const base = 115 + (i - 22) * 4;
      candles.push(candle(i, base, base + 4, base + 5, base - 1, 100));
    }
    // prev: wicks into the block zone. close is 136, not lower — 135 would
    // close below candle 27's low (134), which (correctly, after the
    // high/low break-condition fix in super-order-block.ts) makes candles
    // 27→28 themselves qualify as a *second*, incidental bearish OB whose
    // direction happens to satisfy DOWN_STRUCTURE_FOR_OB below, unrelated to
    // the bullish reaction this fixture is actually testing.
    candles.push(candle(28, 139, 136, 140, 106, 100));
    candles.push(candle(29, 107.2, 109, 109.2, 107, 120)); // last: reaction, closes above block.high
    return candles;
  }

  it('detects a bullish reaction with a high score (HTF bias + strong displacement + BOS + Kill Zone)', () => {
    const candles = buildScenario();
    const result = detectStrongOrderBlockReaction(candles, UP_STRUCTURE_FOR_OB, 'london');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('strong-order-block-reaction');
    expect(result?.direction).toBe('buy');
    expect(result?.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('returns null against the HTF bias (block direction conflicts with structure.trend)', () => {
    const candles = buildScenario();
    expect(detectStrongOrderBlockReaction(candles, DOWN_STRUCTURE_FOR_OB, 'london')).toBeNull();
  });

  it('scores lower without BOS confirmation and outside a Kill Zone session', () => {
    const candles = buildScenario();
    const full = detectStrongOrderBlockReaction(candles, UP_STRUCTURE_FOR_OB, 'london');
    const reduced = detectStrongOrderBlockReaction(candles, UP_STRUCTURE_NO_BOS, 'sydney');
    expect(full).not.toBeNull();
    // Both may or may not clear the entry threshold depending on the other
    // scored factors, but the reduced-factor case must never score higher.
    if (reduced) {
      expect(reduced.confidence).toBeLessThan(full!.confidence);
    }
  });
});

describe('detectImpulseBreakout', () => {
  function buildScenario(): Candle[] {
    const candles: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      const bullish = i % 2 === 0;
      candles.push(candle(i, bullish ? 99.9 : 100.1, bullish ? 100.1 : 99.9, 101, 99, 100));
    }
    candles.push(candle(25, 100, 104, 104.3, 99.8, 200)); // breakout bar, 2x avg volume
    return candles;
  }

  it('detects a bullish breakout with volume confirmation', () => {
    const result = detectImpulseBreakout(buildScenario(), undefined, UP_STRUCTURE_FOR_OB, 'london');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('impulse-breakout');
    expect(result?.direction).toBe('buy');
  });

  it('returns null without volume confirmation (hard block, not just a lower score)', () => {
    const candles = buildScenario().slice(0, -1);
    candles.push(candle(25, 100, 104, 104.3, 99.8, 100)); // same geometry, avg volume only
    // Without the volume floor this is the same breakout geometry as the
    // happy-path test above and would be detected — demonstrating the
    // filter actually blocks it.
    expect(detectImpulseBreakout(candles, undefined, UP_STRUCTURE_FOR_OB, 'london')).toBeNull();
  });

  it('scores lower against the HTF trend than when aligned with it', () => {
    const candles = buildScenario();
    const aligned = detectImpulseBreakout(candles, undefined, UP_STRUCTURE_FOR_OB, 'london');
    const against = detectImpulseBreakout(candles, undefined, DOWN_STRUCTURE_FOR_OB, 'london');
    expect(aligned).not.toBeNull();
    expect(against).not.toBeNull();
    expect(against!.confidence).toBeLessThan(aligned!.confidence);
  });
});

describe('detectConsolidationBreakout', () => {
  function buildScenario(): Candle[] {
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) candles.push(candle(i, 99.5, 100.5, 101.5, 98.5, 100));
    for (let i = 20; i < 30; i++) {
      const bullish = i % 2 === 0;
      candles.push(candle(i, bullish ? 99.9 : 100.1, bullish ? 100.1 : 99.9, 100.3, 99.7, 100));
    }
    candles.push(candle(30, 100.2, 101.5, 101.6, 100.1, 200)); // breakout bar, 2x avg volume
    return candles;
  }

  it('detects a bullish breakout out of a tight consolidation', () => {
    const result = detectConsolidationBreakout(buildScenario(), UP_STRUCTURE_FOR_OB, 'london');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('consolidation-breakout');
    expect(result?.direction).toBe('buy');
  });

  it('returns null without volume confirmation (hard block)', () => {
    const candles = buildScenario().slice(0, -1);
    candles.push(candle(30, 100.2, 101.5, 101.6, 100.1, 100));
    expect(detectConsolidationBreakout(candles, UP_STRUCTURE_FOR_OB, 'london')).toBeNull();
  });

  it('returns null when the breakout bar body is under 60% of its own range (doji-like)', () => {
    const candles = buildScenario().slice(0, -1);
    candles.push(candle(30, 100.5, 100.6, 101.6, 100.1, 200)); // tiny body, big range
    expect(detectConsolidationBreakout(candles, UP_STRUCTURE_FOR_OB, 'london')).toBeNull();
  });
});

describe('detectLiquiditySweep', () => {
  it('detects a bullish sweep: deep wick + volume + swing-level confluence', () => {
    const candles = flatWarmup(30);
    // Sweep bar: wick spikes ~1.5x ATR below the 20-bar low (WARMUP_LOW),
    // closes back above it, high stays under the 20-bar high, volume 2.6x
    // the warmup average.
    candles.push(candle(30, 99.5, 99.6, 100.5, 97.6, 260));

    const result = detectLiquiditySweep(candles, UP_STRUCTURE, 'london', EMPTY_SMART_MONEY);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('liquidity-sweep');
    expect(result?.direction).toBe('buy');
  });

  it('returns null without volume confirmation', () => {
    const candles = flatWarmup(30);
    // Same wick geometry as the passing case above, but volume stays at the
    // warmup average (100) instead of the required >=1.5x.
    candles.push(candle(30, 99.5, 99.6, 100.5, 97.6, 100));

    expect(detectLiquiditySweep(candles, UP_STRUCTURE, 'london', EMPTY_SMART_MONEY)).toBeNull();
  });

  it('returns null when the wick pierces more than 2x ATR (likely a real breakout, not a sweep)', () => {
    const candles = flatWarmup(30);
    candles.push(candle(30, 99.5, 99.6, 100.5, 96.4, 260));

    expect(detectLiquiditySweep(candles, UP_STRUCTURE, 'london', EMPTY_SMART_MONEY)).toBeNull();
  });

  it('returns null against the HTF trend without sufficient bar-level trend strength', () => {
    const candles = flatWarmup(30);
    candles.push(candle(30, 99.5, 99.6, 100.5, 97.6, 260));

    // Same bullish sweep geometry, but structure says 'down' and the flat
    // warmup candles are a genuine ~50/50 mix, so bar-level trend strength
    // for 'up' stays far below the 5/7 threshold.
    expect(detectLiquiditySweep(candles, DOWN_STRUCTURE, 'london', EMPTY_SMART_MONEY)).toBeNull();
  });

  it('returns null in the Asian/closed session (heavily penalized confidence)', () => {
    const candles = flatWarmup(30);
    candles.push(candle(30, 99.5, 99.6, 100.5, 97.6, 260));

    expect(detectLiquiditySweep(candles, UP_STRUCTURE, 'tokyo', EMPTY_SMART_MONEY)).toBeNull();
  });
});

describe('detectLiquiditySweepReaction', () => {
  it('detects a reaction when displacement follows immediately (1 bar after sweep)', () => {
    const candles = flatWarmup(30);
    candles.push(candle(30, 99.5, 99.6, 100.5, 97.6, 260)); // sweep bar
    // Displacement bar: strong bullish body breaking above the sweep bar's
    // high (100.5), with volume well over the 2.5x floor for the extra bonus.
    candles.push(candle(31, 100.5, 103.5, 103.7, 100.4, 300));

    const result = detectLiquiditySweepReaction(candles, UP_STRUCTURE, 'london', EMPTY_SMART_MONEY);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('liquidity-sweep-reaction');
    expect(result?.direction).toBe('buy');
  });

  it('returns null when displacement volume is below the 1.5x hard floor', () => {
    const candles = flatWarmup(30);
    candles.push(candle(30, 99.5, 99.6, 100.5, 97.6, 260));
    candles.push(candle(31, 100.5, 103.5, 103.7, 100.4, 100));

    expect(detectLiquiditySweepReaction(candles, UP_STRUCTURE, 'london', EMPTY_SMART_MONEY)).toBeNull();
  });

  it('finds displacement 2 bars after the sweep when the intermediate bar holds the level', () => {
    const candles = flatWarmup(30);
    candles.push(candle(30, 99.5, 99.6, 100.5, 97.6, 260)); // sweep bar
    // Intermediate bar: small, holds above the swept level (WARMUP_LOW),
    // doesn't itself qualify as a fresh sweep or re-break anything.
    candles.push(candle(31, 100.5, 100.6, 100.7, 100.4, 100));
    candles.push(candle(32, 100.6, 104, 104.2, 100.5, 300));

    const result = detectLiquiditySweepReaction(candles, UP_STRUCTURE, 'london', EMPTY_SMART_MONEY);
    expect(result).not.toBeNull();
    expect(result?.direction).toBe('buy');
  });

  it('returns null when the intermediate bar re-invalidates the swept level', () => {
    const candles = flatWarmup(30);
    candles.push(candle(30, 99.5, 99.6, 100.5, 97.6, 260)); // sweep bar
    // Intermediate bar closes back below the originally-swept level
    // (WARMUP_LOW = 99.4), negating the reclaim before displacement happens.
    candles.push(candle(31, 99.3, 99.0, 99.5, 98.8, 100));
    candles.push(candle(32, 99.0, 102, 102.2, 98.9, 300));

    expect(detectLiquiditySweepReaction(candles, UP_STRUCTURE, 'london', EMPTY_SMART_MONEY)).toBeNull();
  });
});
