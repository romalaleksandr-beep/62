import type { Candle, PatternResult, SignalStrength, IndicatorSnapshot } from '@/types/domain';
import { computeStructure } from '@/compute/indicators/trend-structure';
import { superOrderBlocks } from '@/compute/indicators/super-order-block';
import { macd } from '@/compute/indicators/macd';
import type { SessionRegime } from '@/compute/session-regime';
import { isHighLiquiditySession } from '@/compute/session-regime';

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function strengthForConfidence(confidence: number): SignalStrength {
  if (confidence >= 0.75) return 'strong';
  if (confidence >= 0.5) return 'moderate';
  return 'weak';
}

const MIN_SERIES_LENGTH = 4;
const LOOKBACK_BARS = 15;

// MACD Deceleration in Medium Trend: after a sustained same-color histogram run
// that monotonically decays, a "pause" candle (small body) appears, then the
// histogram flips color — but the first bar of the new color is smaller in
// magnitude than the last bar of the old color. Signal direction follows the
// prevailing trend (continuation, not reversal).
export function detectMacdDecelerationContinuation(
  candles: Candle[],
  snapshot?: IndicatorSnapshot,
  session?: SessionRegime,
): PatternResult | null {
  if (candles.length < 35) return null;

  const closes = candles.map((c) => c.close);
  const { histogram } = macd(closes, 12, 26, 9);

  const struct = computeStructure(candles, LOOKBACK_BARS);
  if (struct.trend === 'range') return null;

  const direction: 'buy' | 'sell' = struct.trend === 'up' ? 'buy' : 'sell';

  const windowStart = Math.max(0, histogram.length - 15);
  const histWindow: (number | null)[] = histogram.slice(windowStart);

  const valid = histWindow.filter((h): h is number => h !== null);
  if (valid.length < MIN_SERIES_LENGTH + 2) return null;

  const lastIdx = histWindow.length - 1;
  const flipIdx = lastIdx - 1;
  if (flipIdx < MIN_SERIES_LENGTH) return null;

  const flipValue = histWindow[flipIdx];
  const lastValue = histWindow[lastIdx];
  if (flipValue === null || lastValue === null) return null;

  const flipSign = Math.sign(flipValue);
  const lastSign = Math.sign(lastValue);
  if (flipSign === 0 || lastSign === 0) return null;
  if (flipSign === lastSign) return null;

  // Last bar(s) of the old (pre-flip) color series — walk backward while the
  // sign still matches flipSign (the decaying same-color run), stopping the
  // moment the sign changes. NOTE: this condition was previously inverted
  // (`=== flipSign` as the break condition instead of `!== flipSign`), which
  // made oldSeries empty in every realistic decaying-then-flip scenario and
  // silently disabled the entire pattern's primary detection path — fixed
  // here as part of the Phase 3 audit (bolt-prompt-8-strategies-replacement.md).
  const oldSeries: number[] = [];
  for (let i = flipIdx - 1; i >= 0; i--) {
    const h = histWindow[i];
    if (h === null) break;
    if (Math.sign(h) !== flipSign) break;
    oldSeries.unshift(h);
  }
  if (oldSeries.length < MIN_SERIES_LENGTH) return null;

  // Monotonically decaying magnitude (|h[i]| <= |h[i-1]|, allowing flat)
  for (let i = 1; i < oldSeries.length; i++) {
    if (Math.abs(oldSeries[i]) > Math.abs(oldSeries[i - 1])) return null;
  }

  // New color's first bar must be smaller in magnitude than old series' last bar
  if (Math.abs(flipValue) >= Math.abs(oldSeries[oldSeries.length - 1])) return null;

  // "Pause" candle: body smaller than 10-bar average body
  const pauseIdx = candles.length - 2;
  if (pauseIdx < 10) return null;
  const pauseCandle = candles[pauseIdx];
  const pauseBody = Math.abs(pauseCandle.close - pauseCandle.open);
  let avgBody = 0;
  for (let i = pauseIdx - 10; i < pauseIdx; i++) {
    avgBody += Math.abs(candles[i].close - candles[i].open);
  }
  avgBody /= 10;
  if (pauseBody >= avgBody) return null;

  // RSI не пересёк 50 во время коррекции (TIER 2, п.11) — документ относит
  // это к красным флагам («слабость тренда»), поэтому это hard-инвалидатор,
  // а не мультипликатор.
  if (snapshot?.rsi != null) {
    if (direction === 'buy' && snapshot.rsi < 50) return null;
    if (direction === 'sell' && snapshot.rsi > 50) return null;
  }

  let correctionMultiplier = 1;
  if (struct.swingHigh !== null && struct.swingLow !== null) {
    const swingRange = struct.swingHigh - struct.swingLow;
    if (swingRange > 0) {
      const last = candles[candles.length - 1];
      const retracement =
        direction === 'buy'
          ? (struct.swingHigh - last.close) / swingRange
          : (last.close - struct.swingLow) / swingRange;
      // Коррекция превысила 78.6% Fibonacci — вероятен разворот, а не пауза
      // перед продолжением (TIER 2, п.12).
      if (retracement > 0.786) return null;
      if (retracement > 0.618) correctionMultiplier = 0.85;
    }
  }

  let confidence = 0.4 + clamp01(Math.abs(lastValue) / (Math.abs(oldSeries[0]) + 1e-9)) * 0.15;
  confidence = clamp01(confidence) * correctionMultiplier;

  // Bonus if there's an unbroken OB/level in the trend direction. `struct`
  // is already computed above; reuse it here (informational only — no hard
  // gate) instead of leaving the detector to fall back on its own defaults.
  const blocks = superOrderBlocks(candles, 100, { structure: struct, atrValue: snapshot?.atr ?? undefined });
  const last = candles[candles.length - 1];
  const hasTrendBlock = blocks.some((b) =>
    b.status !== 'broken' &&
    b.direction === (direction === 'buy' ? 'bullish' : 'bearish') &&
    Math.abs(last.close - (direction === 'buy' ? b.low : b.high)) <= (b.high - b.low) * 3,
  );
  if (hasTrendBlock) confidence = clamp01(confidence + 0.15);

  // Kill Zone bonus (London/New York session).
  if (session && isHighLiquiditySession(session)) confidence = clamp01(confidence * 1.15);

  return {
    name: 'macd-deceleration-continuation',
    direction,
    confidence,
    strength: strengthForConfidence(confidence),
    time: last.time,
  };
}
