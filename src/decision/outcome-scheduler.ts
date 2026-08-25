import type { Candle, Signal, SignalOutcome } from '@/types/domain';

export interface ResolvedOutcome {
  signalId: string;
  outcome: SignalOutcome;
}

export function resolveOutcome(
  signal: Signal,
  candlesAfterSignal: Candle[],
): ResolvedOutcome | null {
  if (signal.outcome !== 'pending') return null;
  if (candlesAfterSignal.length === 0) return null;

  const barsToCheck = Math.min(candlesAfterSignal.length, signal.barsToResolve);
  const isBuy = signal.direction === 'buy';
  const { stopLoss, takeProfit } = signal;

  for (let i = 0; i < barsToCheck; i++) {
    const c = candlesAfterSignal[i];
    if (isBuy) {
      if (c.low <= stopLoss) return { signalId: signal.id, outcome: 'loss' };
      if (c.high >= takeProfit) return { signalId: signal.id, outcome: 'win' };
    } else {
      if (c.high >= stopLoss) return { signalId: signal.id, outcome: 'loss' };
      if (c.low <= takeProfit) return { signalId: signal.id, outcome: 'win' };
    }
  }

  if (candlesAfterSignal.length >= signal.barsToResolve) {
    return { signalId: signal.id, outcome: 'timeout' };
  }

  return null;
}

export function getCandlesAfterSignal(
  allCandles: Candle[],
  signalTime: number,
): Candle[] {
  const after: Candle[] = [];
  for (const c of allCandles) {
    if (c.time > signalTime) after.push(c);
  }
  return after;
}

export interface PendingSignal {
  signal: Signal;
  barsElapsed: number;
}

export class OutcomeScheduler {
  private pending: PendingSignal[] = [];

  schedule(signal: Signal): void {
    if (signal.outcome !== 'pending') return;
    // Дедуп по id: schedule() реально вызывается для одного и того же
    // сигнала (один и тот же candleTime → один и тот же id, см.
    // generateSignalId) из двух разных мест — pre-close (maybeTriggerPreClose)
    // и "подстраховки" в maybeEvaluateSignal при isClosed === true — это
    // осознанный fallback-путь (см. комментарий в useTickStore.ts).
    // Без этой проверки оба вызова кладут в `pending` ДВЕ отдельные записи
    // с одинаковым signal.id; когда исход наступает, onCandleClosed()
    // резолвит и вызывает onResolve() ОБА раза для одного и того же
    // сигнала — это удваивает обучающие сэмплы калибровки
    // (eng.recordOutcome/triggerRetrain) и лишние обновления БД, реально
    // искажая ту самую статистику, на которую жалуется пользователь.
    if (this.pending.some((p) => p.signal.id === signal.id)) return;
    this.pending.push({ signal, barsElapsed: 0 });
  }

  onCandleClosed(
    allCandles: Candle[],
    onResolve: (resolved: ResolvedOutcome, signal: Signal) => void,
  ): void {
    if (this.pending.length === 0) return;
    const stillPending: PendingSignal[] = [];

    for (const p of this.pending) {
      const candlesAfter = getCandlesAfterSignal(allCandles, p.signal.time);
      const resolved = resolveOutcome(p.signal, candlesAfter);
      if (resolved) {
        onResolve(resolved, p.signal);
      } else {
        stillPending.push({ ...p, barsElapsed: candlesAfter.length });
      }
    }

    this.pending = stillPending;
  }

  clear(): void {
    this.pending = [];
  }

  getPendingCount(): number {
    return this.pending.length;
  }

  getPendingList(): PendingSignal[] {
    return this.pending;
  }
}
