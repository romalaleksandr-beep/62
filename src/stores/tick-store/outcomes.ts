import type { TickState } from '../useTickStore';
import type { DecisionEngine } from '@/decision/engine';
import type { OutcomeScheduler } from '@/decision/outcome-scheduler';
import type { CalibrationModel } from '@/decision/calibration-model';
import { addBreadcrumb } from '@/lib/sentry';
import { useAnalyticsStore } from '../useAnalyticsStore';
import { updateSignalOutcome } from '@/lib/signal-persistence';
import { estimateSpread } from '@/decision/spread-estimate';
import { applySpreadToOutcome } from '@/decision/apply-spread';

// ensureEngine()/ensureScheduler() и модульный calibrationModel/triggerRetrain
// остаются в useTickStore.ts — сюда передаются явными параметрами, чтобы не
// создавать циклический импорт useTickStore.ts <-> tick-store/outcomes.ts.
export interface OutcomeDeps {
  ensureEngine: () => DecisionEngine;
  ensureScheduler: () => OutcomeScheduler;
  getCalibrationModel: () => CalibrationModel | null;
  triggerRetrain: (model: CalibrationModel) => Promise<void>;
}

export function maybeResolveOutcomes(
  get: () => TickState,
  deps: OutcomeDeps,
): void {
  const state = get();
  const sched = deps.ensureScheduler();
  const eng = deps.ensureEngine();
  const analytics = useAnalyticsStore.getState();

  sched.onCandleClosed(state.candles, (resolved, signal) => {
    analytics.updateSignalOutcome(resolved.signalId, resolved.outcome);
    void updateSignalOutcome(resolved.signalId, resolved.outcome);
    // Spread correction: the displayed outcome (win/loss/timeout) shown to the
    // user and persisted to DB is the raw resolved outcome. But the calibration
    // model must train on the same spread-adjusted outcome the backtest uses,
    // otherwise it learns on systematically optimistic results.
    const { spread } = estimateSpread(signal.symbolId, null);
    const adjusted = applySpreadToOutcome(resolved.outcome, signal, spread);
    const outcomeRecord = eng.recordOutcome(signal, adjusted.outcome);
    const calibrationModel = deps.getCalibrationModel();
    if (outcomeRecord && calibrationModel) {
      addBreadcrumb(`Outcome resolved: ${resolved.outcome} (calibration: ${adjusted.outcome})`, {
        signalId: resolved.signalId,
        samples: calibrationModel.getSampleCount(),
      });
      // Retraining (worker round-trip) and persisting the resulting weights
      // happen asynchronously via triggerRetrain — see its docstring above.
      // recordOutcome() itself already added the sample synchronously.
      void deps.triggerRetrain(calibrationModel);
    }
    analytics.recomputeStats();
  });
}
