import { describe, it, expect } from 'vitest';
import { selectTopPattern } from './pattern-selection';
import type { PatternResult } from '@/types/domain';

function pattern(name: string, direction: 'buy' | 'sell', confidence: number): PatternResult {
  return { name: name as PatternResult['name'], direction, confidence, strength: 'moderate', time: 1000 };
}

describe('selectTopPattern', () => {
  it('returns null for empty array', () => {
    expect(selectTopPattern([])).toBeNull();
  });

  it('selects the pattern with highest confidence', () => {
    const patterns = [
      pattern('hammer', 'buy', 0.5),
      pattern('morning-star', 'buy', 0.8),
      pattern('doji', 'buy', 0.3),
    ];
    const result = selectTopPattern(patterns);
    expect(result).not.toBeNull();
    expect(result!.top.name).toBe('morning-star');
    expect(result!.top.confidence).toBe(0.8);
  });

  it('returns the top confidence unchanged when only one pattern in that direction', () => {
    const patterns = [pattern('hammer', 'buy', 0.7)];
    const result = selectTopPattern(patterns);
    expect(result!.fusionConfidence).toBe(0.7);
  });

  it('boosts confidence when multiple patterns agree in direction', () => {
    const patterns = [
      pattern('hammer', 'buy', 0.7),
      pattern('morning-star', 'buy', 0.6),
    ];
    const result = selectTopPattern(patterns);
    // 2 patterns → 0.7 + 0.1 * 1 = 0.8
    expect(result!.fusionConfidence).toBeCloseTo(0.8, 5);
  });

  it('boosts confidence further with 3 same-direction patterns', () => {
    const patterns = [
      pattern('hammer', 'buy', 0.7),
      pattern('morning-star', 'buy', 0.6),
      pattern('bullish-engulfing', 'buy', 0.5),
    ];
    const result = selectTopPattern(patterns);
    // 3 patterns → 0.7 + 0.1 * 2 = 0.9
    expect(result!.fusionConfidence).toBeCloseTo(0.9, 5);
  });

  it('caps fusion confidence at 1.0', () => {
    const patterns = [
      pattern('hammer', 'buy', 0.95),
      pattern('morning-star', 'buy', 0.9),
      pattern('bullish-engulfing', 'buy', 0.85),
    ];
    const result = selectTopPattern(patterns);
    // 0.95 + 0.1 * 2 = 1.15 → capped at 1.0
    expect(result!.fusionConfidence).toBe(1);
  });

  it('filters sameDir to only patterns matching the top direction', () => {
    const patterns = [
      pattern('hammer', 'buy', 0.8),
      pattern('shooting-star', 'sell', 0.7),
      pattern('morning-star', 'buy', 0.6),
      pattern('doji', 'sell', 0.3),
    ];
    const result = selectTopPattern(patterns);
    expect(result!.top.direction).toBe('buy');
    expect(result!.sameDir).toHaveLength(2);
    expect(result!.sameDir.every((p) => p.direction === 'buy')).toBe(true);
  });

  it('does not apply fusion boost when only one pattern in top direction', () => {
    const patterns = [
      pattern('hammer', 'buy', 0.8),
      pattern('shooting-star', 'sell', 0.7),
    ];
    const result = selectTopPattern(patterns);
    // Only 1 buy pattern → no fusion
    expect(result!.fusionConfidence).toBe(0.8);
  });

  it('handles patterns with equal confidence (picks first by sort stability)', () => {
    const patterns = [
      pattern('hammer', 'buy', 0.7),
      pattern('doji', 'buy', 0.7),
    ];
    const result = selectTopPattern(patterns);
    expect(result).not.toBeNull();
    expect(result!.top.confidence).toBe(0.7);
    // Two same-dir patterns → fusion boost
    expect(result!.fusionConfidence).toBeCloseTo(0.8, 5);
  });
});
