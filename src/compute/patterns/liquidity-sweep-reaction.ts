import type { Candle, PatternResult, SignalStrength, MarketStructure } from '@/types/domain';
import { detectLiquiditySweep } from './liquidity-sweep';
import { lastNonNull, volumeRatio } from '@/compute/indicators/helpers';
import { atr } from '@/compute/indicators/atr';
import type { SessionRegime } from '@/compute/session-regime';
import type { SmartMoneyResult } from '@/compute/indicators/smart-money';
import { sessionBoost, obFvgConfluenceBonus, intervalSeconds } from './pattern-context';

function strengthForConfidence(confidence: number): SignalStrength {
  if (confidence >= 0.75) return 'strong';
  if (confidence >= 0.5) return 'moderate';
  return 'weak';
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

const ENTRY_THRESHOLD = 0.70;
const SWEEP_LOOKBACK = 20;

// Same recentHigh/recentLow window detectLiquiditySweep() uses internally,
// re-derived here (ending exclusive at `sweepIdx`) purely to sanity-check
// that an intermediate bar between the sweep and the displacement bar
// didn't re-invalidate the swept level (retest-and-fail).
function sweptLevel(candles: Candle[], sweepIdx: number, direction: 'buy' | 'sell'): number | null {
  const start = sweepIdx - SWEEP_LOOKBACK;
  if (start < 0) return null;
  const slice = candles.slice(start, sweepIdx);
  if (slice.length === 0) return null;
  return direction === 'buy'
    ? Math.min(...slice.map((c) => c.low))
    : Math.max(...slice.map((c) => c.high));
}

interface SweepFind {
  sweepIdx: number;
  sweepResult: PatternResult;
}

function findSweep(
  candles: Candle[],
  structure: MarketStructure,
  session: SessionRegime,
  smartMoney: SmartMoneyResult,
  atrPeriod: number,
): SweepFind | null {
  // Try sweep 1 bar back (bar N-1 relative to the current last bar N).
  const oneBarBack = candles.slice(0, -1);
  const sweep1 = detectLiquiditySweep(oneBarBack, structure, session, smartMoney, 20, atrPeriod);
  if (sweep1) {
    return { sweepIdx: candles.length - 2, sweepResult: sweep1 };
  }

  // Try sweep 2 bars back — displacement is allowed within 1–2 bars per
  // the strategy document. The intermediate bar (candles.length - 2) must
  // not have re-invalidated (closed back through) the swept level.
  if (candles.length < 3) return null;
  const twoBarsBack = candles.slice(0, -2);
  const sweep2 = detectLiquiditySweep(twoBarsBack, structure, session, smartMoney, 20, atrPeriod);
  if (!sweep2) return null;

  const sweepIdx = candles.length - 3;
  const intermediate = candles[candles.length - 2];
  const level = sweptLevel(candles, sweepIdx, sweep2.direction);
  if (level !== null) {
    const reinvalidated = sweep2.direction === 'buy' ? intermediate.close < level : intermediate.close > level;
    if (reinvalidated) return null;
  }

  return { sweepIdx, sweepResult: sweep2 };
}

// Liquidity sweep reaction: sweep followed by a displacement/confirmation
// candle (within 1–2 bars) in the reversal direction, with volume and
// structural (MSS/CHoCH) confirmation — see
// bolt-prompt-8-strategies-replacement.md Phase 1.2.
export function detectLiquiditySweepReaction(
  candles: Candle[],
  structure: MarketStructure,
  session: SessionRegime,
  smartMoney: SmartMoneyResult,
  atrPeriod: number = 14,
): PatternResult | null {
  if (candles.length < 22) return null;

  const found = findSweep(candles, structure, session, smartMoney, atrPeriod);
  if (!found) return null;
  const { sweepIdx, sweepResult } = found;
  const sweepBar = candles[sweepIdx];
  const direction = sweepResult.direction;

  const last = candles[candles.length - 1];
  const lastIdx = candles.length - 1;

  const atrArr = atr(candles, atrPeriod);
  const atrValue = lastNonNull(atrArr);
  if (atrValue === null || atrValue <= 0) return null;

  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low || 1e-9;

  // Displacement must break beyond the sweep bar's extreme in the direction
  // of the reversal, with a body dominating the bar's own range.
  const brokeExtreme = direction === 'buy' ? last.close > sweepBar.high : last.close < sweepBar.low;
  if (!brokeExtreme) return null;
  if (body < atrValue) return null;
  if (body < range * 0.6) return null;

  // Volume tiering: <1.5x is a hard block; 1.5x-2.0x is allowed but
  // penalized; >=2.0x is full weight.
  const volRatio = volumeRatio(candles, lastIdx, 20);
  if (volRatio < 1.5) return null;
  const volumeMultiplier = volRatio < 2.0 ? 0.7 : 1.0;

  // MSS/CHoCH confirmation in the direction of the reversal.
  const mssConfirmed = structure.bos;
  const chochOnly = !structure.bos && structure.choch;

  const displacementConfidence = clamp01((body / atrValue) / 2.0);
  let confidence = (sweepResult.confidence + displacementConfidence) / 2;

  if (body >= atrValue * 1.5 && volRatio >= 2.5) confidence *= 1.3;
  if (mssConfirmed) confidence *= 1.25;
  else if (!chochOnly) confidence *= 0.75;

  const intervalSec = intervalSeconds(candles);
  const confluenceBonus = obFvgConfluenceBonus(smartMoney, last, direction, atrValue, intervalSec);
  confidence *= 1 + confluenceBonus;
  confidence *= sessionBoost(session);
  confidence *= volumeMultiplier;

  confidence = clamp01(confidence);
  if (confidence < ENTRY_THRESHOLD) return null;

  return {
    name: 'liquidity-sweep-reaction',
    direction,
    confidence,
    strength: strengthForConfidence(confidence),
    time: last.time,
    volumeConfirmed: true,
  };
}
