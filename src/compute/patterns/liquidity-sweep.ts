import type { Candle, PatternResult, SignalStrength, MarketStructure } from '@/types/domain';
import { lastNonNull, volumeRatio } from '@/compute/indicators/helpers';
import { atr } from '@/compute/indicators/atr';
import type { SessionRegime } from '@/compute/session-regime';
import type { SmartMoneyResult } from '@/compute/indicators/smart-money';
import { checkTrendStrength } from './trend-utils';
import {
  sessionBoost,
  htfAlignment,
  isAsiaOrClosed,
  isNearSwingLevel,
  obFvgConfluenceBonus,
  intervalSeconds,
} from './pattern-context';

function strengthForConfidence(confidence: number): SignalStrength {
  if (confidence >= 0.75) return 'strong';
  if (confidence >= 0.5) return 'moderate';
  return 'weak';
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

const ENTRY_THRESHOLD = 0.65;
const MIN_VOLUME_RATIO = 1.5;
const MIN_DEPTH_ATR = 0.3;
const MAX_DEPTH_ATR = 2.0;

// Liquidity sweep (ICT): price spikes beyond a recent extreme, on volume,
// then closes back inside the range — see bolt-prompt-8-strategies-replacement.md
// Phase 1.1 ("СТРАТЕГИЯ «LIQUIDITY SWEEP (ICT)»").
export function detectLiquiditySweep(
  candles: Candle[],
  structure: MarketStructure,
  session: SessionRegime,
  smartMoney: SmartMoneyResult,
  lookback: number = 20,
  atrPeriod: number = 14,
): PatternResult | null {
  if (candles.length < lookback + 1) return null;

  const atrArr = atr(candles, atrPeriod);
  const atrValue = lastNonNull(atrArr);
  if (atrValue === null || atrValue <= 0) return null;

  const slice = candles.slice(-lookback - 1, -1);
  const recentHigh = Math.max(...slice.map((c) => c.high));
  const recentLow = Math.min(...slice.map((c) => c.low));
  const last = candles[candles.length - 1];
  const lastIdx = candles.length - 1;

  let direction: 'buy' | 'sell' | null = null;
  let depth = 0;

  // Bullish sweep: spikes below recent low then closes back above it
  if (last.low < recentLow && last.close > recentLow) {
    direction = 'buy';
    depth = recentLow - last.low;
  } else if (last.high > recentHigh && last.close < recentHigh) {
    // Bearish sweep: spikes above recent high then closes back below it
    direction = 'sell';
    depth = last.high - recentHigh;
  }

  if (direction === null) return null;

  // 1. Обязательный тренд-контекст перед sweep (HTF-аппроксимация на M1,
  //    см. правило 0.4 промта): либо structure.trend уже указывает нужное
  //    направление, либо минимум 5 из последних 7 баров — свечи в сторону
  //    движения (checkTrendStrength из trend-utils.ts).
  const trendDirection = direction === 'buy' ? 'up' : 'down';
  const structureAligned = structure.trend === trendDirection;
  const barTrendStrength = checkTrendStrength(candles, trendDirection, 7);
  if (!structureAligned && barTrendStrength < 5 / 7) return null;

  // 4. Глубина прокола в единицах ATR — вне диапазона 0.3–2.0 ATR это уже
  //    не убедительный sweep (либо слишком мелкий шум, либо настоящий пробой).
  const depthInAtr = depth / atrValue;
  if (depthInAtr > MAX_DEPTH_ATR) return null;
  if (depthInAtr < MIN_DEPTH_ATR) return null;

  // 5. Объёмный фильтр — обязательное условие по чек-листу документа.
  const volRatio = volumeRatio(candles, lastIdx, 20);
  if (volRatio < MIN_VOLUME_RATIO) return null;

  // 6. Конфлюэнс с OB/FVG старшего ТФ либо со swing-уровнем структуры —
  //    не hard-блок, а понижающий/повышающий мультипликатор confidence.
  const intervalSec = intervalSeconds(candles);
  const confluenceBonus = obFvgConfluenceBonus(smartMoney, last, direction, atrValue, intervalSec);
  const nearSwing = isNearSwingLevel(structure, last, atrValue);

  let confidence = clamp01(depthInAtr / 1.5);

  if (isAsiaOrClosed(session)) {
    confidence *= 0.6;
  } else {
    confidence *= sessionBoost(session);
  }

  confidence *= 1 + confluenceBonus;
  if (confluenceBonus === 0 && !nearSwing) confidence *= 0.8;

  confidence *= htfAlignment(structure, direction);

  confidence = clamp01(confidence);
  if (confidence < ENTRY_THRESHOLD) return null;

  return {
    name: 'liquidity-sweep',
    direction,
    confidence,
    strength: strengthForConfidence(confidence),
    time: last.time,
    volumeConfirmed: true,
  };
}
