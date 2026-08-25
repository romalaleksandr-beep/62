import type { Candle, IndicatorConfig, IndicatorSnapshot, IndicatorSeries, FeatureName } from '@/types/domain';
import { rsi as calcRsi } from '@/compute/indicators/rsi';
import { ema } from '@/compute/indicators/ema';
import { macd } from '@/compute/indicators/macd';
import { atr } from '@/compute/indicators/atr';
import { bollinger } from '@/compute/indicators/bollinger';
import { vwapLast } from '@/compute/indicators/vwap';
import { volumeProfilePocWithMeta } from '@/compute/indicators/volume-profile';
import { computeImpulseVelocity } from '@/compute/indicators/impulse-velocity';
import { adx as calcAdx } from '@/compute/indicators/adx';
import { lastNonNull, zipTime } from '@/compute/indicators/helpers';

export interface ComputeResult {
  snapshot: IndicatorSnapshot;
  series: IndicatorSeries;
}

const NULL_SNAPSHOT: IndicatorSnapshot = {
  rsi: null,
  emaFast: null,
  emaSlow: null,
  macd: null,
  macdSignal: null,
  macdHistogram: null,
  atr: null,
  bollingerUpper: null,
  bollingerMiddle: null,
  bollingerLower: null,
  vwap: null,
  vwapIsProxyVolume: false,
  volumeProfilePoc: null,
  volumeProfilePocIsProxyVolume: false,
  meanReversionRsi: null,
  impulseVelocity: null,
  adx: null,
};

const EMPTY_SERIES: IndicatorSeries = {
  rsi: [],
  emaFast: [],
  emaSlow: [],
  macd: [],
  macdSignal: [],
  macdHistogram: [],
  bollingerUpper: [],
  bollingerMiddle: [],
  bollingerLower: [],
};

export function computeIndicators(
  candles: Candle[],
  config: IndicatorConfig,
  activeFeatures: FeatureName[] = [],
): ComputeResult {
  if (activeFeatures.length === 0) {
    return computeAll(candles, config);
  }

  const has = (name: FeatureName) => activeFeatures.includes(name);
  const closes = candles.map((c) => c.close);

  const needRsi = has('rsi') || has('mean-reversion');
  const needEma = has('ema') || has('macd');
  const needMacd = has('macd');
  const needAtr = has('atr');
  const needBoll = has('bollinger');
  const needAdx = has('atr'); // ADX is used alongside ATR for trend strength

  const rsiArr = needRsi ? calcRsi(closes, config.rsiPeriod) : null;
  const emaFastArr = needEma ? ema(closes, config.emaFast) : null;
  const emaSlowArr = needEma ? ema(closes, config.emaSlow) : null;
  const macdResult = needMacd ? macd(closes, config.macdFast, config.macdSlow, config.macdSignal) : null;
  const atrArr = needAtr ? atr(candles, config.atrPeriod) : null;
  const boll = needBoll ? bollinger(closes, config.bbPeriod, config.bbStdDev) : null;
  const adxVal = needAdx ? lastNonNull(calcAdx(candles, 14)) : null;

  const vwapResult = has('vwap') ? vwapLast(candles) : { value: null, isProxyVolume: false };
  const vpResult = has('volume-profile')
    ? volumeProfilePocWithMeta(candles)
    : { poc: null, isProxyVolume: false };

  const snapshot: IndicatorSnapshot = {
    rsi: rsiArr ? lastNonNull(rsiArr) : null,
    emaFast: emaFastArr ? lastNonNull(emaFastArr) : null,
    emaSlow: emaSlowArr ? lastNonNull(emaSlowArr) : null,
    macd: macdResult ? lastNonNull(macdResult.macd) : null,
    macdSignal: macdResult ? lastNonNull(macdResult.signal) : null,
    macdHistogram: macdResult ? lastNonNull(macdResult.histogram) : null,
    atr: atrArr ? lastNonNull(atrArr) : null,
    bollingerUpper: boll ? lastNonNull(boll.upper) : null,
    bollingerMiddle: boll ? lastNonNull(boll.middle) : null,
    bollingerLower: boll ? lastNonNull(boll.lower) : null,
    vwap: vwapResult.value,
    vwapIsProxyVolume: vwapResult.isProxyVolume,
    volumeProfilePoc: vpResult.poc,
    volumeProfilePocIsProxyVolume: vpResult.isProxyVolume,
    meanReversionRsi: has('mean-reversion') ? lastNonNull(calcRsi(closes, 7)) : null,
    impulseVelocity: has('impulse-velocity') ? computeImpulseVelocity(candles, config.atrPeriod) : null,
    adx: adxVal,
  };

  const series: IndicatorSeries = {
    rsi: rsiArr ? zipTime(candles, rsiArr) : [],
    emaFast: emaFastArr ? zipTime(candles, emaFastArr) : [],
    emaSlow: emaSlowArr ? zipTime(candles, emaSlowArr) : [],
    macd: macdResult ? zipTime(candles, macdResult.macd) : [],
    macdSignal: macdResult ? zipTime(candles, macdResult.signal) : [],
    macdHistogram: macdResult ? zipTime(candles, macdResult.histogram) : [],
    bollingerUpper: boll ? zipTime(candles, boll.upper) : [],
    bollingerMiddle: boll ? zipTime(candles, boll.middle) : [],
    bollingerLower: boll ? zipTime(candles, boll.lower) : [],
  };

  return { snapshot, series };
}

function computeAll(candles: Candle[], config: IndicatorConfig): ComputeResult {
  const closes = candles.map((c) => c.close);

  const rsiArr = calcRsi(closes, config.rsiPeriod);
  const emaFastArr = ema(closes, config.emaFast);
  const emaSlowArr = ema(closes, config.emaSlow);
  const macdResult = macd(closes, config.macdFast, config.macdSlow, config.macdSignal);
  const atrArr = atr(candles, config.atrPeriod);
  const boll = bollinger(closes, config.bbPeriod, config.bbStdDev);

  const snapshot: IndicatorSnapshot = {
    rsi: lastNonNull(rsiArr),
    emaFast: lastNonNull(emaFastArr),
    emaSlow: lastNonNull(emaSlowArr),
    macd: lastNonNull(macdResult.macd),
    macdSignal: lastNonNull(macdResult.signal),
    macdHistogram: lastNonNull(macdResult.histogram),
    atr: lastNonNull(atrArr),
    bollingerUpper: lastNonNull(boll.upper),
    bollingerMiddle: lastNonNull(boll.middle),
    bollingerLower: lastNonNull(boll.lower),
    vwap: null,
    vwapIsProxyVolume: false,
    volumeProfilePoc: null,
    volumeProfilePocIsProxyVolume: false,
    meanReversionRsi: null,
    impulseVelocity: null,
    adx: lastNonNull(calcAdx(candles, 14)),
  };

  const series: IndicatorSeries = {
    rsi: zipTime(candles, rsiArr),
    emaFast: zipTime(candles, emaFastArr),
    emaSlow: zipTime(candles, emaSlowArr),
    macd: zipTime(candles, macdResult.macd),
    macdSignal: zipTime(candles, macdResult.signal),
    macdHistogram: zipTime(candles, macdResult.histogram),
    bollingerUpper: zipTime(candles, boll.upper),
    bollingerMiddle: zipTime(candles, boll.middle),
    bollingerLower: zipTime(candles, boll.lower),
  };

  return { snapshot, series };
}

export function computeSnapshot(
  candles: Candle[],
  config: IndicatorConfig,
  activeFeatures: FeatureName[] = [],
): IndicatorSnapshot {
  if (candles.length === 0) return { ...NULL_SNAPSHOT };
  return computeIndicators(candles, config, activeFeatures).snapshot;
}
