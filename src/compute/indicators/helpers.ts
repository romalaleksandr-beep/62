export function nullArray(len: number): (number | null)[] {
  return Array.from({ length: len }, () => null);
}

export function zeroArray(len: number): number[] {
  return Array.from({ length: len }, () => 0);
}

export function lastNonNull(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) return values[i];
  }
  return null;
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function averageVolume(candles: { volume: number }[], period: number, endExclusive: number): number {
  const start = Math.max(0, endExclusive - period);
  const slice = candles.slice(start, endExclusive);
  if (slice.length === 0) return 0;
  return slice.reduce((sum, c) => sum + c.volume, 0) / slice.length;
}

export function averageBody(candles: { open: number; close: number }[], period: number, endExclusive: number): number {
  const start = Math.max(0, endExclusive - period);
  const slice = candles.slice(start, endExclusive);
  if (slice.length === 0) return 0;
  return slice.reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / slice.length;
}

// Ratio of a single candle's volume to the average volume of the preceding
// `period` bars (tick-volume proxy for forex, same convention as elsewhere
// in this module). Used by the 8 M1 strategy detectors as a shared volume
// filter instead of each one re-deriving its own average-volume math.
export function volumeRatio(candles: { volume: number }[], index: number, period: number = 20): number {
  const avg = averageVolume(candles, period, index);
  if (avg <= 0) return 1;
  return candles[index].volume / avg;
}

export function zipTime(
  candles: { time: number }[],
  values: (number | null)[],
): Array<{ time: number; value: number | null }> {
  return candles.map((c, i) => ({ time: c.time, value: values[i] ?? null }));
}
