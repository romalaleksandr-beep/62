import type {
  Candle,
  IndicatorConfig,
  PatternResult,
  Signal,
  SignalDirection,
  SignalStrength,
  Snapshot,
  Timeframe,
  FeatureName,
  Tick,
  SignalComponentToggles,
} from '@/types/domain';
import { DEFAULT_SIGNAL_TOGGLES } from '@/types/domain';
import type { CalibrationModel } from './calibration-model';
import { estimateTradeLevels, fallbackAtr } from './trade-levels';
import { recommendedExpiry } from './recommended-expiry';
import { estimateSpread } from './spread-estimate';
import { computeDirectionScore } from './direction-prediction';
import { applySignalFilters } from './signal-filters';
import { selectTopPattern } from './pattern-selection';
import { getSessionRegime, type SessionRegime } from '@/compute/session-regime';

const REVISION_DELTA_THRESHOLD = 3.0;

export const FEATURE_KEYS = [
  'rsi', 'ema_cross', 'macd_hist', 'bb_width', 'atr',
  'vwap', 'impulse_vel', 'regime_trend', 'regime_vol',
  'bos', 'choch', 'pattern_conf',
] as const;

export const FEATURE_COUNT = FEATURE_KEYS.length;

export interface FeatureVector {
  values: number[];
  keys: string[];
}

export function buildFeatureVector(snapshot: Snapshot): FeatureVector {
  const ind = snapshot.indicators;
  const map = new Map<string, number>();

  if (ind.rsi !== null) map.set('rsi', ind.rsi / 100);
  if (ind.emaFast !== null && ind.emaSlow !== null) {
    map.set('ema_cross', ind.emaSlow !== 0 ? (ind.emaFast - ind.emaSlow) / ind.emaSlow : 0);
  }
  if (ind.macdHistogram !== null) map.set('macd_hist', ind.macdHistogram);
  if (ind.bollingerUpper !== null && ind.bollingerLower !== null) {
    const width = ind.bollingerUpper - ind.bollingerLower;
    map.set('bb_width', width !== 0 ? width / (ind.bollingerMiddle ?? 1) : 0);
  }
  if (ind.atr !== null) map.set('atr', ind.atr);
  if (ind.vwap !== null) map.set('vwap', ind.vwap);
  if (ind.impulseVelocity !== null) map.set('impulse_vel', ind.impulseVelocity);
  if (snapshot.regime === 'trend') map.set('regime_trend', 1);
  if (snapshot.regime === 'high-volatility') map.set('regime_vol', 1);
  if (snapshot.structure.bos) map.set('bos', 1);
  if (snapshot.structure.choch) map.set('choch', 1);

  const selection = selectTopPattern(snapshot.patterns);
  if (selection) {
    map.set('pattern_conf', selection.fusionConfidence * (selection.top.direction === 'buy' ? 1 : -1));
  }

  const values = FEATURE_KEYS.map((k) => map.get(k) ?? 0);
  return { values, keys: [...FEATURE_KEYS] };
}

function strengthFor(score: number): SignalStrength {
  if (score >= 4) return 'strong';
  if (score >= 3) return 'moderate';
  return 'weak';
}

interface EvidenceResult {
  direction: SignalDirection;
  score: number;
  reasons: string[];
  pattern: PatternResult | null;
}

function isSessionAllowed(session: SessionRegime, filter: IndicatorConfig['sessionFilter']): boolean {
  // 'closed' (weekend / no active forex session) is MarketHoursConfig's
  // concern, not this quality filter's — crypto symbols trade 24/7 with no
  // session-liquidity pattern, so we don't want this forex-oriented gate to
  // silently block them. Only the 5 named sessions are actually gated.
  if (session === 'closed') return true;
  return filter[session];
}

function evaluateEvidence(
  candles: Candle[],
  snapshot: Snapshot,
  entryPrice: number,
  toggles: SignalComponentToggles,
  activeFeatures: FeatureName[],
  atrPeriod: number,
  rsiOverbought: number,
  rsiOversold: number,
): EvidenceResult {
  const ind = snapshot.indicators;
  const { direction, score: dirScore, reasons: dirReasons } = computeDirectionScore(candles, snapshot, toggles, activeFeatures, atrPeriod, rsiOverbought, rsiOversold);

  const topPattern = toggles.trigger ? selectTopPattern(snapshot.patterns)?.top ?? null : null;

  // Collect additional indicator evidence for the score
  const extraReasons: string[] = [];
  let indicatorBonus = 0;

  // RSI/Bollinger are already counted in dirScore via direction-prediction components.
  // This small bonus rewards explicit double-confirmation only — not a full second count.
  if (toggles.indicator && ind.rsi !== null) {
    if (ind.rsi < rsiOversold && direction === 'buy') { indicatorBonus += 0.1; extraReasons.push(`RSI oversold (${ind.rsi.toFixed(1)})`); }
    else if (ind.rsi > rsiOverbought && direction === 'sell') { indicatorBonus += 0.1; extraReasons.push(`RSI overbought (${ind.rsi.toFixed(1)})`); }
  }

  if (toggles.meanReversion && ind.bollingerLower !== null && ind.bollingerUpper !== null) {
    if (entryPrice <= ind.bollingerLower && direction === 'buy') { indicatorBonus += 0.1; extraReasons.push('Price at lower Bollinger band'); }
    else if (entryPrice >= ind.bollingerUpper && direction === 'sell') { indicatorBonus += 0.1; extraReasons.push('Price at upper Bollinger band'); }
  }

  // Strategy bonuses for OBC and MDM patterns — additive evidence on top of
  // the base dirScore, scaled by each pattern's confidence.
  if (topPattern) {
    if (topPattern.name === 'order-block-continuation') {
      indicatorBonus += 0.55 * topPattern.confidence;
      extraReasons.push(`OBC strategy (+${(0.55 * topPattern.confidence).toFixed(2)})`);
    } else if (topPattern.name === 'macd-deceleration-continuation') {
      indicatorBonus += 0.35 * topPattern.confidence;
      extraReasons.push(`MDM strategy (+${(0.35 * topPattern.confidence).toFixed(2)})`);
    }
  }

  // Apply false-signal filters
  const filterResult = applySignalFilters(candles, snapshot, direction, dirScore, toggles, activeFeatures);
  const filteredScore = (dirScore + indicatorBonus) * filterResult.scoreMultiplier;

  if (filterResult.invalidated) {
    return { direction, score: 0, reasons: [...dirReasons, ...filterResult.reasons], pattern: topPattern };
  }

  const allReasons = [...dirReasons, ...extraReasons, ...filterResult.reasons];

  return { direction, score: filteredScore, reasons: allReasons, pattern: topPattern };
}

export function sigmoidFallback(score: number): number {
  return 1 / (1 + Math.exp(-score / 5));
}

export interface BuildSignalParams {
  symbolId: string;
  timeframe: Timeframe;
  candles: Candle[];
  config: IndicatorConfig;
  atrMultiplier: number;
  activeFeatures: FeatureName[];
  snapshot: Snapshot;
  calibration: CalibrationModel | null;
  tick: Tick | null;
  barsToResolve: number;
  scoreThreshold?: number;
  signalToggles?: SignalComponentToggles;
  priorityThreshold?: number;
}

export function buildSignal(params: BuildSignalParams): Signal | null {
  const { symbolId, timeframe, candles, config, atrMultiplier, activeFeatures, snapshot, calibration, tick, barsToResolve, scoreThreshold, signalToggles = DEFAULT_SIGNAL_TOGGLES, priorityThreshold } = params;

  const hasEnabledSource = signalToggles.structure || signalToggles.zones || signalToggles.liquidity || signalToggles.trigger || signalToggles.indicator || signalToggles.bos || signalToggles.macd || signalToggles.meanReversion;
  if (!hasEnabledSource) return null;

  const warmup = Math.max(config.emaSlow, config.bbPeriod, config.macdSlow, config.rsiPeriod, config.atrPeriod) + 5;
  if (candles.length < warmup) return null;

  const lastCandle = candles[candles.length - 1];

  // Задача 1.2 — session/kill-zone gate. Applied BEFORE any score
  // computation: outside an enabled trading window, no signal is built at
  // all (not a DirectionComponents penalty, a hard pre-filter).
  const sessionRegime = getSessionRegime(lastCandle.time * 1000);
  if (!isSessionAllowed(sessionRegime, config.sessionFilter)) return null;

  const entryPrice = lastCandle.close;
  const evidence = evaluateEvidence(candles, snapshot, entryPrice, signalToggles, activeFeatures, config.atrPeriod, config.rsiOverbought, config.rsiOversold);
  const threshold = scoreThreshold ?? config.scoreThreshold;
  if (evidence.score < threshold) return null;

  const atrValue = fallbackAtr(snapshot.indicators, candles, config.atrPeriod);
  if (atrValue <= 0) return null;

  // Задача 1.3 — pre-entry spread gate. estimateSpread() was previously only
  // consulted post-factum (apply-spread.ts, when resolving win/loss/timeout)
  // — an abnormally wide spread (e.g. around a news spike) could never stop
  // a signal from being created, only make it lose after the fact. Moving
  // the same estimate earlier lets an anomalous spread block entry outright.
  const spreadInfo = estimateSpread(symbolId, tick);
  if (spreadInfo.spread > atrValue * config.spreadGateMultiplier) return null;

  const levels = estimateTradeLevels(entryPrice, atrValue, atrMultiplier, evidence.direction);
  if (!levels) return null;
  const featureVec = buildFeatureVector(snapshot);
  const expiry = recommendedExpiry(timeframe, atrValue, entryPrice);

  let calibratedProbability: number | null;
  if (calibration && calibration.isReady()) {
    calibratedProbability = calibration.predict(featureVec.values);
  } else {
    calibratedProbability = sigmoidFallback(evidence.score);
  }

  // Приоритетный фильтр: если задан priorityThreshold, сигнал создаётся
  // только если его вероятность >= порога. Все сигналы, прошедшие этот
  // фильтр, гарантированно вызывают приоритетный баннер и звук —
  // см. notifySignal в tick-store/shared.ts.
  if (priorityThreshold !== undefined && calibratedProbability !== null && calibratedProbability < priorityThreshold) {
    return null;
  }

  return {
    id: generateSignalId(symbolId, timeframe, lastCandle.time),
    symbolId,
    direction: evidence.direction,
    strength: strengthFor(evidence.score),
    score: evidence.score,
    calibratedProbability,
    entryPrice: levels.entry,
    stopLoss: levels.stopLoss,
    takeProfit: levels.takeProfit,
    reason: evidence.reasons.join('; '),
    indicators: snapshot.indicators,
    pattern: evidence.pattern?.name ?? null,
    time: lastCandle.time,
    timeframe,
    outcome: 'pending',
    frozenAt: null,
    isRevised: false,
    isPreClose: false,
    revisionNote: null,
    barsToResolve,
    spread: spreadInfo.spread,
    spreadSource: spreadInfo.source,
    recommendedExpiry: expiry,
    featureVector: featureVec.values,
  };
}

export function generateSignalId(symbolId: string, timeframe: Timeframe, candleTime: number): string {
  return `${symbolId}:${timeframe}:${candleTime}`;
}

export function shouldRevise(currentScore: number, previousScore: number): boolean {
  return Math.abs(currentScore - previousScore) > REVISION_DELTA_THRESHOLD;
}

export function reviseSignal(
  signal: Signal,
  newScore: number,
  newReasons: string,
  newSnapshot: Snapshot,
  calibration: CalibrationModel | null,
): Signal {
  const featureVec = buildFeatureVector(newSnapshot);
  const calibratedProbability = calibration && calibration.isReady()
    ? calibration.predict(featureVec.values)
    : sigmoidFallback(newScore);

  return {
    ...signal,
    score: newScore,
    reason: newReasons,
    indicators: newSnapshot.indicators,
    calibratedProbability,
    isRevised: true,
    revisionNote: `Score changed from ${signal.score} to ${newScore}`,
  };
}
