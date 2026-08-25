import type { PatternResult } from '@/types/domain';

export interface PatternSelection {
  top: PatternResult;
  sameDir: PatternResult[];
  fusionConfidence: number;
}

export function selectTopPattern(patterns: PatternResult[]): PatternSelection | null {
  if (patterns.length === 0) return null;
  const top = [...patterns].sort((a, b) => b.confidence - a.confidence)[0];
  const sameDir = patterns.filter((p) => p.direction === top.direction);
  const fusionConfidence = sameDir.length >= 2
    ? Math.min(1, top.confidence + 0.1 * (sameDir.length - 1))
    : top.confidence;
  return { top, sameDir, fusionConfidence };
}
