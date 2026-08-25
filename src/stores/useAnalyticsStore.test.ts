import { describe, it, expect, beforeEach } from 'vitest';
import { useAnalyticsStore } from './useAnalyticsStore';
import type { Signal } from '@/types/domain';

function makeSignal(overrides?: Partial<Signal>): Signal {
  return {
    id: 'sig-1',
    symbolId: 'BTCUSDT',
    direction: 'buy',
    strength: 'moderate',
    score: 3,
    calibratedProbability: 0.6,
    entryPrice: 100,
    stopLoss: 90,
    takeProfit: 120,
    reason: 'test',
    indicators: {} as Signal['indicators'],
    pattern: null,
    time: 1000,
    timeframe: '15m',
    outcome: 'pending',
    frozenAt: null,
    isRevised: false,
    isPreClose: false,
    revisionNote: null,
    barsToResolve: 5,
    spread: null,
    spreadSource: null,
    recommendedExpiry: 900,
    featureVector: [],
    ...overrides,
  };
}

describe('useAnalyticsStore', () => {
  beforeEach(() => {
    useAnalyticsStore.getState().clearAll();
  });

  describe('addSignal', () => {
    it('adds a signal to the front of the list', () => {
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 'sig-1' }));
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 'sig-2' }));
      const signals = useAnalyticsStore.getState().signals;
      expect(signals).toHaveLength(2);
      expect(signals[0].id).toBe('sig-2');
    });

    it('caps at 20 signals', () => {
      for (let i = 0; i < 25; i++) {
        useAnalyticsStore.getState().addSignal(makeSignal({ id: `sig-${i}` }));
      }
      expect(useAnalyticsStore.getState().signals).toHaveLength(20);
    });

    it('does not add a duplicate signal with the same id', () => {
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 'sig-1', score: 3 }));
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 'sig-1', score: 5 }));
      const signals = useAnalyticsStore.getState().signals;
      expect(signals).toHaveLength(1);
      expect(signals[0].score).toBe(3);
    });

    it('does not add a duplicate even when other signals are in between', () => {
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 'sig-1' }));
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 'sig-2' }));
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 'sig-1' }));
      expect(useAnalyticsStore.getState().signals).toHaveLength(2);
    });
  });

  describe('upsertSignal', () => {
    it('inserts a new signal if id does not exist', () => {
      useAnalyticsStore.getState().upsertSignal(makeSignal({ id: 'sig-1' }));
      expect(useAnalyticsStore.getState().signals).toHaveLength(1);
    });

    it('replaces an existing signal with the same id', () => {
      useAnalyticsStore.getState().upsertSignal(makeSignal({ id: 'sig-1', score: 3 }));
      useAnalyticsStore.getState().upsertSignal(makeSignal({ id: 'sig-1', score: 5 }));
      const signals = useAnalyticsStore.getState().signals;
      expect(signals).toHaveLength(1);
      expect(signals[0].score).toBe(5);
    });
  });

  describe('setCurrentSignal', () => {
    it('sets the current signal', () => {
      const sig = makeSignal({ id: 'current' });
      useAnalyticsStore.getState().setCurrentSignal(sig);
      expect(useAnalyticsStore.getState().currentSignal?.id).toBe('current');
    });

    it('clears the current signal when passed null', () => {
      useAnalyticsStore.getState().setCurrentSignal(makeSignal());
      useAnalyticsStore.getState().setCurrentSignal(null);
      expect(useAnalyticsStore.getState().currentSignal).toBeNull();
    });
  });

  describe('updateSignalOutcome', () => {
    it('updates the outcome of a matching signal', () => {
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 'sig-1', outcome: 'pending' }));
      useAnalyticsStore.getState().updateSignalOutcome('sig-1', 'win');
      expect(useAnalyticsStore.getState().signals[0].outcome).toBe('win');
    });

    it('updates currentSignal if its id matches', () => {
      const sig = makeSignal({ id: 'sig-1', outcome: 'pending' });
      useAnalyticsStore.getState().setCurrentSignal(sig);
      useAnalyticsStore.getState().updateSignalOutcome('sig-1', 'loss');
      expect(useAnalyticsStore.getState().currentSignal?.outcome).toBe('loss');
    });

    it('does not modify signals when id does not match', () => {
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 'sig-1', outcome: 'pending' }));
      useAnalyticsStore.getState().updateSignalOutcome('nonexistent', 'win');
      expect(useAnalyticsStore.getState().signals[0].outcome).toBe('pending');
    });
  });

  describe('setCalibrationResult', () => {
    it('sets calibration ready when totalTrades > 0', () => {
      useAnalyticsStore.getState().setCalibrationResult({
        symbolId: 'BTCUSDT', timeframe: '15m', atrMultiplier: 2,
        stopLossPips: 10, takeProfitPips: 20, winRate: 0.6, totalTrades: 10, calibratedAt: Date.now(),
      });
      expect(useAnalyticsStore.getState().calibrationReady).toBe(true);
      expect(useAnalyticsStore.getState().calibrationSampleCount).toBe(10);
      expect(useAnalyticsStore.getState().winRate).toBe(0.6);
    });

    it('sets winRate to null when winRate is 0', () => {
      useAnalyticsStore.getState().setCalibrationResult({
        symbolId: 'BTCUSDT', timeframe: '15m', atrMultiplier: 2,
        stopLossPips: 10, takeProfitPips: 20, winRate: 0, totalTrades: 5, calibratedAt: Date.now(),
      });
      expect(useAnalyticsStore.getState().winRate).toBeNull();
    });

    it('resets state when passed null', () => {
      useAnalyticsStore.getState().setCalibrationResult({
        symbolId: 'BTCUSDT', timeframe: '15m', atrMultiplier: 2,
        stopLossPips: 10, takeProfitPips: 20, winRate: 0.6, totalTrades: 10, calibratedAt: Date.now(),
      });
      useAnalyticsStore.getState().setCalibrationResult(null);
      expect(useAnalyticsStore.getState().calibrationReady).toBe(false);
      expect(useAnalyticsStore.getState().calibrationResult).toBeNull();
      expect(useAnalyticsStore.getState().winRate).toBeNull();
    });
  });

  describe('setCalibrationState', () => {
    it('sets calibration ready when sampleCount >= 10', () => {
      useAnalyticsStore.getState().setCalibrationState({ weights: [1], bias: 0, sampleCount: 10 });
      expect(useAnalyticsStore.getState().calibrationReady).toBe(true);
      expect(useAnalyticsStore.getState().calibrationSampleCount).toBe(10);
    });

    it('sets calibration not ready when sampleCount < 10', () => {
      useAnalyticsStore.getState().setCalibrationState({ weights: [1], bias: 0, sampleCount: 5 });
      expect(useAnalyticsStore.getState().calibrationReady).toBe(false);
    });

    it('resets state when passed null', () => {
      useAnalyticsStore.getState().setCalibrationState({ weights: [1], bias: 0, sampleCount: 15 });
      useAnalyticsStore.getState().setCalibrationState(null);
      expect(useAnalyticsStore.getState().calibrationReady).toBe(false);
      expect(useAnalyticsStore.getState().calibrationState).toBeNull();
    });
  });

  describe('recomputeStats', () => {
    it('computes winRate from completed signals', () => {
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 's1', outcome: 'win' }));
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 's2', outcome: 'loss' }));
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 's3', outcome: 'win' }));
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 's4', outcome: 'pending' }));
      useAnalyticsStore.getState().recomputeStats();
      // 2 wins, 1 loss → 2/3
      expect(useAnalyticsStore.getState().winRate).toBeCloseTo(2 / 3, 5);
    });

    it('counts timeout as completed but excludes from winRate', () => {
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 's1', outcome: 'win' }));
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 's2', outcome: 'loss' }));
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 's3', outcome: 'timeout' }));
      useAnalyticsStore.getState().recomputeStats();
      // winRate = 1 win / (1 win + 1 loss) = 0.5, sampleCount = 3
      expect(useAnalyticsStore.getState().winRate).toBeCloseTo(0.5, 5);
      expect(useAnalyticsStore.getState().calibrationSampleCount).toBe(3);
    });

    it('sets winRate to null when only timeouts', () => {
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 's1', outcome: 'timeout' }));
      useAnalyticsStore.getState().recomputeStats();
      expect(useAnalyticsStore.getState().winRate).toBeNull();
      expect(useAnalyticsStore.getState().calibrationSampleCount).toBe(1);
    });

    it('sets winRate to null when no completed signals', () => {
      useAnalyticsStore.getState().addSignal(makeSignal({ id: 's1', outcome: 'pending' }));
      useAnalyticsStore.getState().recomputeStats();
      expect(useAnalyticsStore.getState().winRate).toBeNull();
    });

    it('sets winRate to null when no signals at all', () => {
      useAnalyticsStore.getState().recomputeStats();
      expect(useAnalyticsStore.getState().winRate).toBeNull();
    });
  });

  describe('clearAll', () => {
    it('resets everything', () => {
      useAnalyticsStore.getState().addSignal(makeSignal());
      useAnalyticsStore.getState().setCurrentSignal(makeSignal());
      useAnalyticsStore.getState().setConnectionStatus('live');
      useAnalyticsStore.getState().clearAll();
      expect(useAnalyticsStore.getState().signals).toHaveLength(0);
      expect(useAnalyticsStore.getState().currentSignal).toBeNull();
      expect(useAnalyticsStore.getState().winRate).toBeNull();
      expect(useAnalyticsStore.getState().calibrationReady).toBe(false);
    });
  });

  describe('clearSignalHistory', () => {
    it('clears signals and winRate but not connectionStatus', () => {
      useAnalyticsStore.getState().addSignal(makeSignal());
      useAnalyticsStore.getState().setConnectionStatus('live');
      useAnalyticsStore.getState().clearSignalHistory();
      expect(useAnalyticsStore.getState().signals).toHaveLength(0);
      expect(useAnalyticsStore.getState().winRate).toBeNull();
      expect(useAnalyticsStore.getState().connectionStatus).toBe('live');
    });
  });
});
