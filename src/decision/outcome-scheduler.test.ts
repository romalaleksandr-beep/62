import { describe, it, expect } from 'vitest';
import type { Candle, Signal } from '@/types/domain';
import { OutcomeScheduler } from './outcome-scheduler';

function makeSignal(overrides: Partial<Signal> & { id: string; time: number }): Signal {
  return {
    symbolId: 'A', timeframe: '5m', direction: 'buy', strength: 'moderate',
    score: 3, calibratedProbability: null, entryPrice: 100, stopLoss: 95,
    takeProfit: 110, reason: 'test', indicators: {} as unknown as Signal['indicators'],
    pattern: null, outcome: 'pending', frozenAt: null, isRevised: false,
    isPreClose: false, revisionNote: null, barsToResolve: 5, spread: null,
    spreadSource: null, recommendedExpiry: 300, featureVector: [0],
    ...overrides,
  };
}

function candle(time: number, close: number, high: number, low: number): Candle {
  return { time, open: close, high, low, close, volume: 100 };
}

describe('OutcomeScheduler.schedule — dedup by signal.id', () => {
  it('only tracks one pending entry when schedule() is called twice for the same signal.id', () => {
    // Воспроизводит реальный сценарий: pre-close (maybeTriggerPreClose)
    // и подстраховка в maybeEvaluateSignal (isClosed === true) для одной и
    // той же свечи оба вызывают scheduler.schedule(signal) с одинаковым
    // signal.id (см. generateSignalId — id детерминирован по
    // symbolId:timeframe:candleTime).
    const scheduler = new OutcomeScheduler();
    const signal = makeSignal({ id: 'A:5m:1000', time: 1000 });
    const signalCopy = makeSignal({ id: 'A:5m:1000', time: 1000 }); // другой объект, тот же id

    scheduler.schedule(signal);
    scheduler.schedule(signalCopy);

    expect(scheduler.getPendingCount()).toBe(1);
  });

  it('does not call onResolve twice for the same signal.id once outcome is reached', () => {
    const scheduler = new OutcomeScheduler();
    const signal = makeSignal({ id: 'A:5m:1000', time: 1000, direction: 'buy', takeProfit: 110, stopLoss: 95, barsToResolve: 3 });
    const signalCopy = makeSignal({ id: 'A:5m:1000', time: 1000, direction: 'buy', takeProfit: 110, stopLoss: 95, barsToResolve: 3 });

    scheduler.schedule(signal);
    scheduler.schedule(signalCopy);

    const resolvedCalls: Array<{ signalId: string; outcome: string }> = [];
    const allCandles = [candle(1000, 100, 101, 99), candle(1300, 111, 112, 108)];

    scheduler.onCandleClosed(allCandles, (resolved) => {
      resolvedCalls.push({ signalId: resolved.signalId, outcome: resolved.outcome });
    });

    expect(resolvedCalls).toHaveLength(1);
    expect(resolvedCalls[0]).toEqual({ signalId: 'A:5m:1000', outcome: 'win' });
    expect(scheduler.getPendingCount()).toBe(0);
  });

  it('still tracks two distinct signals with different ids independently', () => {
    const scheduler = new OutcomeScheduler();
    scheduler.schedule(makeSignal({ id: 'A:5m:1000', time: 1000 }));
    scheduler.schedule(makeSignal({ id: 'A:5m:1300', time: 1300 }));

    expect(scheduler.getPendingCount()).toBe(2);
  });
});
