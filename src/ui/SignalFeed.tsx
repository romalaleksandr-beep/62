import { Zap, Clock, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useAnalyticsStore } from '@/stores/useAnalyticsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { findSymbol } from '@/data/symbols';
import { SignalCard } from '@/ui/SignalCard';
import { clsx } from '@/lib/utils';

export function SignalFeed() {
  const current = useAnalyticsStore((s) => s.currentSignal);
  const signals = useAnalyticsStore((s) => s.signals);
  const clearSignalHistory = useAnalyticsStore((s) => s.clearSignalHistory);
  const symbolId = useSettingsStore((s) => s.symbolId);
  const symbol = findSymbol(symbolId);
  const pipSize = symbol?.pipSize ?? 0.01;
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {current ? (
        <SignalCard signal={current} pipSize={pipSize} />
      ) : (
        <div className="rounded-xl border border-base-800 bg-base-900 p-4 text-center">
          <Zap size={20} className="mx-auto mb-1 text-base-500" />
          <p className="text-xs text-base-400">Нет активного сигнала</p>
          <p className="mt-0.5 text-2xs text-base-500">Ожидание конfluence индикаторов</p>
        </div>
      )}

      {signals.length > 0 && (
        <div className="rounded-xl border border-base-800 bg-base-900 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-2xs font-semibold text-base-400">
              <Clock size={12} />
              ИСТОРИЯ СИГНАЛОВ
            </div>
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { clearSignalHistory(); setConfirmDelete(false); }}
                  className="flex items-center gap-1 rounded-md bg-error-700/30 px-1.5 py-0.5 text-2xs font-bold uppercase text-error-400 transition hover:bg-error-700/50"
                >
                  <Trash2 size={10} />
                  Очистить
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex items-center gap-1 rounded-md bg-base-800 px-1.5 py-0.5 text-2xs font-bold uppercase text-base-400 transition hover:text-base-200"
                >
                  <X size={10} />
                  Отмена
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-semibold text-base-500 transition hover:text-error-400"
                title="Очистить всю историю сигналов"
              >
                <Trash2 size={10} />
                Удалить все
              </button>
            )}
          </div>
          <div className={clsx('flex flex-col gap-1.5 transition', confirmDelete && 'opacity-60')}>
            {signals.map((sig) => (
              <SignalCard key={sig.id} signal={sig} pipSize={pipSize} compact />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
