import type {
  Candle,
  IndicatorConfig,
  Signal,
  SignalOutcome,
  Snapshot,
  Timeframe,
  FeatureName,
  Tick,
  SignalComponentToggles,
} from '@/types/domain';
import { DEFAULT_SIGNAL_TOGGLES, DEFAULT_INDICATOR_CONFIG } from '@/types/domain';
import type { CalibrationModel } from './calibration-model';
import { workerClient } from '@/compute/WorkerClient';
import {
  buildSignal,
  type BuildSignalParams,
} from './signal-builder';
import { addBreadcrumb } from '@/lib/sentry';
import { TIMEFRAME_SECONDS } from '@/data/symbols';
import { PRE_CLOSE_SIGNAL_LEAD_MS } from '@/lib/constants';

const DEFAULT_BARS_TO_RESOLVE = 5;
const FROZEN_SIGNAL_MAX_AGE_MS = 60_000;

export interface OutcomeRecord {
  signalId: string;
  outcome: SignalOutcome;
  features: number[];
  score: number;
}

export interface DecisionEngineOptions {
  calibration: CalibrationModel | null;
  barsToResolve: number;
  scoreThreshold?: number;
  signalToggles?: SignalComponentToggles;
  priorityThreshold?: number;
}

export class DecisionEngine {
  private calibration: CalibrationModel | null;
  private barsToResolve: number;
  private scoreThreshold: number;
  private signalToggles: SignalComponentToggles;
  private priorityThreshold: number | null;
  private frozenSignal: Signal | null = null;
  private frozenCandleTime: number | null = null;
  private currentSignal: Signal | null = null;
  private currentSnapshot: Snapshot | null = null;
  // candleTime of the most recently *issued* snapshotRequest. Used to detect
  // and discard stale worker responses: if a newer evaluate() call is issued
  // (for a different candle) while an older one is still awaiting the worker,
  // this field will have moved on by the time the older response arrives, so
  // the older result is dropped instead of overwriting currentSignal/currentSnapshot.
  private pendingRequestCandleTime: number | null = null;

  constructor(opts: DecisionEngineOptions) {
    this.calibration = opts.calibration;
    this.barsToResolve = opts.barsToResolve > 0 ? opts.barsToResolve : DEFAULT_BARS_TO_RESOLVE;
    this.scoreThreshold = opts.scoreThreshold ?? DEFAULT_INDICATOR_CONFIG.scoreThreshold;
    this.signalToggles = opts.signalToggles ?? DEFAULT_SIGNAL_TOGGLES;
    this.priorityThreshold = opts.priorityThreshold ?? null;
  }

  snapshot(candleTime: number, serverNowMs: number, timeframeSeconds: number): { isFrozen: boolean; shouldFreeze: boolean } {
    const closeTimeMs = (candleTime + timeframeSeconds) * 1000;
    const msUntilClose = closeTimeMs - serverNowMs;
    const shouldFreeze = msUntilClose <= PRE_CLOSE_SIGNAL_LEAD_MS && msUntilClose > -PRE_CLOSE_SIGNAL_LEAD_MS;
    return { isFrozen: this.frozenSignal !== null, shouldFreeze };
  }

  async evaluate(
    symbolId: string,
    timeframe: Timeframe,
    candles: Candle[],
    config: IndicatorConfig,
    atrMultiplier: number,
    activeFeatures: FeatureName[],
    tick: Tick | null,
    serverNowMs: number,
    isClosed: boolean = true,
  ): Promise<Signal | null> {
    if (candles.length === 0) return null;
    const hasEnabledSource = this.signalToggles.structure || this.signalToggles.zones || this.signalToggles.liquidity || this.signalToggles.trigger || this.signalToggles.indicator || this.signalToggles.bos || this.signalToggles.macd || this.signalToggles.meanReversion;
    if (!hasEnabledSource) {
      this.currentSignal = null;
      this.frozenSignal = null;
      this.frozenCandleTime = null;
      return null;
    }
    const lastCandle = candles[candles.length - 1];
    const tfSeconds = TIMEFRAME_SECONDS[timeframe];
    const { shouldFreeze } = this.snapshot(lastCandle.time, serverNowMs, tfSeconds);

    // Fast path: this MUST resolve synchronously, before we ever go to the
    // worker, so a valid frozen signal keeps being returned immediately on
    // every call (up to 5x/sec via maybeTriggerPreClose) instead of paying
    // worker round-trip latency for a result we already have.
    if (this.frozenSignal && this.frozenCandleTime === lastCandle.time) {
      const age = serverNowMs - (this.frozenSignal.frozenAt ?? 0);
      if (age > FROZEN_SIGNAL_MAX_AGE_MS) {
        this.frozenSignal = null;
        this.frozenCandleTime = null;
      } else {
        return this.frozenSignal;
      }
    }

    const requestCandleTime = lastCandle.time;
    this.pendingRequestCandleTime = requestCandleTime;

    const { snapshot, series } = await workerClient.snapshotRequest(
      symbolId,
      timeframe,
      candles,
      config,
      activeFeatures,
      isClosed,
    );
    void series;

    // Race condition guard: if a newer evaluate() call (different candle) was
    // issued while we were awaiting the worker, pendingRequestCandleTime will
    // no longer match requestCandleTime — this response is stale, so it must
    // not overwrite currentSignal/currentSnapshot (or frozenSignal) with
    // outdated data. Just drop it; the newer in-flight call will produce the
    // up-to-date result.
    if (this.pendingRequestCandleTime !== requestCandleTime) {
      return null;
    }

    const signal = buildSignal({
      symbolId,
      timeframe,
      candles,
      config,
      atrMultiplier,
      activeFeatures,
      snapshot,
      calibration: this.calibration,
      tick,
      barsToResolve: this.barsToResolve,
      scoreThreshold: this.scoreThreshold,
      signalToggles: this.signalToggles,
      priorityThreshold: this.priorityThreshold ?? undefined,
    } satisfies BuildSignalParams);

    this.currentSignal = signal;
    this.currentSnapshot = snapshot;

    if (shouldFreeze && signal) {
      this.frozenSignal = { ...signal, frozenAt: serverNowMs };
      this.frozenCandleTime = lastCandle.time;
      return this.frozenSignal;
    }

    return signal;
  }

  onCandleClosed(): Signal | null {
    const sig = this.frozenSignal ?? this.currentSignal;
    this.frozenSignal = null;
    this.frozenCandleTime = null;
    return sig;
  }

  recordOutcome(signal: Signal, outcome: SignalOutcome): OutcomeRecord | null {
    if (outcome === 'pending') return null;
    if (!this.calibration) return null;

    const outcomeValue: 1 | 0 = outcome === 'win' ? 1 : 0;
    const sample = {
      features: signal.featureVector,
      score: signal.score,
      outcome: outcomeValue,
    };

    // Only the (cheap) sample bookkeeping happens here. Retraining the
    // logistic regression is comparatively expensive (500-epoch full-batch
    // gradient descent) and is the calling code's responsibility (see
    // useTickStore.ts, triggerRetrain — it offloads to the worker via
    // workerClient.retrainCalibration()). recordOutcome() itself stays a
    // plain synchronous method that doesn't await anything.
    this.calibration.addSample(sample);
    addBreadcrumb(`Calibration sample added: ${this.calibration.getSampleCount()} samples`, {
      outcome,
      score: signal.score,
    });

    return {
      signalId: signal.id,
      outcome,
      features: signal.featureVector,
      score: signal.score,
    };
  }

  getFrozenSignal(): Signal | null {
    return this.frozenSignal;
  }

  shouldEmitPreClose(serverNowMs: number, candleTime: number, timeframeSeconds: number): boolean {
    const closeTimeMs = (candleTime + timeframeSeconds) * 1000;
    const msUntilClose = closeTimeMs - serverNowMs;
    return msUntilClose <= PRE_CLOSE_SIGNAL_LEAD_MS && msUntilClose > 0;
  }

  getLastSnapshot(): Snapshot | null {
    return this.currentSnapshot;
  }

  setScoreThreshold(threshold: number): void {
    this.scoreThreshold = threshold;
  }

  setSignalToggles(toggles: SignalComponentToggles): void {
    this.signalToggles = toggles;
  }

  setPriorityThreshold(threshold: number): void {
    this.priorityThreshold = threshold;
  }
}
