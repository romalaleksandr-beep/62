import type { Candle, PatternResult, SignalStrength, IndicatorSnapshot, MarketStructure } from '@/types/domain';
import { lastNonNull, volumeRatio } from '@/compute/indicators/helpers';
import { atr } from '@/compute/indicators/atr';
import type { SessionRegime } from '@/compute/session-regime';
import { sessionBoost } from './pattern-context';

function strengthForConfidence(confidence: number): SignalStrength {
  if (confidence >= 0.75) return 'strong';
  if (confidence >= 0.5) return 'moderate';
  return 'weak';
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

const ENTRY_THRESHOLD = 0.6;
const MIN_VOLUME_RATIO = 1.5;

// Impulse breakout: candle breaks a recent 20-bar range with a body larger
// than ATR — see bolt-prompt-8-strategies-replacement.md Phase 4.1
// ("Стратегия «Импульсный прорыв»"). `snapshot`/`structure`/`session` are
// optional so existing direct unit-test call sites without that context
// keep compiling, but the production pipeline (index.ts) always supplies
// them.
export function detectImpulseBreakout(
  candles: Candle[],
  snapshot?: IndicatorSnapshot,
  structure?: MarketStructure,
  session?: SessionRegime,
  lookback: number = 20,
  atrPeriod: number = 14,
): PatternResult | null {
  if (candles.length < lookback + 1) return null;

  const atrArr = atr(candles, atrPeriod);
  const atrValue = lastNonNull(atrArr);
  if (atrValue === null || atrValue <= 0) return null;

  const slice = candles.slice(-lookback - 1, -1);
  const rangeHigh = Math.max(...slice.map((c) => c.high));
  const rangeLow = Math.min(...slice.map((c) => c.low));
  const last = candles[candles.length - 1];
  const lastIdx = candles.length - 1;
  const body = Math.abs(last.close - last.open);

  if (body < atrValue) return null;

  let direction: 'buy' | 'sell' | null = null;
  if (last.close > rangeHigh && last.close > last.open) direction = 'buy';
  else if (last.close < rangeLow && last.close < last.open) direction = 'sell';
  if (direction === null) return null;

  // Объёмный фильтр — обязательное условие; при отсутствии объёмного
  // подтверждения (<1.5x среднего) документ требует полного отказа от
  // сделки, а не просто понижения confidence.
  const volRatio = volumeRatio(candles, lastIdx, 20);
  if (volRatio < MIN_VOLUME_RATIO) return null;

  let confidence = clamp01(body / (atrValue * 2));

  // BB squeeze перед пробоем — approximation: IndicatorSnapshot хранит
  // только текущее значение полос (нет исторического ряда ширины), поэтому
  // "сжатие" аппроксимируется как узкие полосы относительно текущего ATR,
  // а не сравнением с шириной N баров назад.
  if (snapshot?.bollingerUpper != null && snapshot?.bollingerLower != null) {
    const bandWidth = snapshot.bollingerUpper - snapshot.bollingerLower;
    if (bandWidth < atrValue * 2) confidence *= 1.3;
  }

  if (volRatio >= 2.0) confidence *= 1.25;

  if (session) confidence *= sessionBoost(session);

  // Структурное подтверждение (BOS/MSB старшего ТФ) в направлении пробоя —
  // не hard-блок (в отличие от объёма), а понижающий мультипликатор.
  if (structure && !(structure.bos && structure.trend === (direction === 'buy' ? 'up' : 'down'))) {
    confidence *= 0.7;
  }

  confidence = clamp01(confidence);
  if (confidence < ENTRY_THRESHOLD) return null;

  return {
    name: 'impulse-breakout',
    direction,
    confidence,
    strength: strengthForConfidence(confidence),
    time: last.time,
    volumeConfirmed: true,
  };
}
