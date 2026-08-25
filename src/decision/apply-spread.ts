import type { Signal, SignalOutcome } from '@/types/domain';

export interface SpreadAdjustedOutcome {
  outcome: SignalOutcome;
  spreadCostR: number;
}

export function applySpreadToOutcome(
  outcome: SignalOutcome,
  signal: Signal,
  spread: number,
): SpreadAdjustedOutcome {
  const risk = Math.abs(signal.entryPrice - signal.stopLoss);
  const spreadCostR = risk > 0 ? spread / risk : 0;

  if (outcome === 'win') {
    const originalReward = Math.abs(signal.takeProfit - signal.entryPrice);
    const adjustedReward = originalReward - spread;
    if (adjustedReward <= 0) return { outcome: 'timeout', spreadCostR };
    return { outcome: 'win', spreadCostR };
  }
  if (outcome === 'loss') {
    return { outcome: 'loss', spreadCostR };
  }
  return { outcome, spreadCostR };
}
