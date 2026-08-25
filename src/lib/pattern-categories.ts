import type { PatternName } from '@/types/domain';

/**
 * Комплексные многофакторные детекторы, которые по своей сути являются
 * торговыми стратегиями (в отличие от классических свечных паттернов).
 * Список должен быть подмножеством ALL_PATTERNS из src/stores/settingsStore.ts.
 */
export const STRATEGY_PATTERNS: readonly PatternName[] = [
  'impulse-breakout',
  'consolidation-breakout',
  'liquidity-sweep',
  'liquidity-sweep-reaction',
  'mean-reversion',
  'strong-order-block-reaction',
  'order-block-continuation',
  'macd-deceleration-continuation',
];

export type PatternCategory = 'pattern' | 'strategy';

/**
 * Всё, что не входит в STRATEGY_PATTERNS, но есть в PatternName
 * (то есть классические свечные паттерны), автоматически считается
 * категорией 'pattern'.
 */
export function patternCategory(name: PatternName): PatternCategory {
  return STRATEGY_PATTERNS.includes(name) ? 'strategy' : 'pattern';
}

/** Русский словарь имён паттернов/стратегий для отображения в UI. */
export const PATTERN_LABELS_RU: Record<PatternName, string> = {
  // классические свечные паттерны
  hammer: 'Молот',
  'shooting-star': 'Падающая звезда',
  doji: 'Доджи',
  'pin-bar': 'Пин-бар',
  'bullish-engulfing': 'Бычье поглощение',
  'bearish-engulfing': 'Медвежье поглощение',
  'bullish-harami': 'Бычье харами',
  'bearish-harami': 'Медвежье харами',
  'inside-bar': 'Внутренний бар',
  'morning-star': 'Утренняя звезда',
  'evening-star': 'Вечерняя звезда',
  'inverted-hammer': 'Перевёрнутый молот',
  'hanging-man': 'Повешенный',
  'marubozu-bullish': 'Бычий марубозу',
  'marubozu-bearish': 'Медвежий марубозу',
  'spinning-top': 'Волчок',
  'piercing-line': 'Просвет в облаках',
  'dark-cloud-cover': 'Завеса из тёмных облаков',
  'tweezer-bottom': 'Пинцет (дно)',
  'tweezer-top': 'Пинцет (вершина)',
  'three-white-soldiers': 'Три белых солдата',
  'three-black-crows': 'Три чёрные вороны',
  'abandoned-baby-bottom': 'Брошенный ребёнок (дно)',
  'abandoned-baby-top': 'Брошенный ребёнок (вершина)',
  'rising-three-methods': 'Растущие три метода',
  'falling-three-methods': 'Падающие три метода',
  // стратегии (STRATEGY_PATTERNS)
  'impulse-breakout': 'Импульсный пробой',
  'consolidation-breakout': 'Пробой консолидации',
  'liquidity-sweep': 'Снятие ликвидности',
  'liquidity-sweep-reaction': 'Реакция на снятие ликвидности',
  'mean-reversion': 'Возврат к среднему',
  'strong-order-block-reaction': 'Сильная реакция от ордер-блока',
  'order-block-continuation': 'Продолжение от ордер-блока',
  'macd-deceleration-continuation': 'Замедление MACD с продолжением',
};
