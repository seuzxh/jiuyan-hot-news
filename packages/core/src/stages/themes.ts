/** 题材聚合：同分类事件归为一题，聚合热度与 Top 概念股（催化逻辑由 LLM 综述） */
import { classifyEvent, groupByCategory, type Category } from "../taxonomy.js";

export interface ThemeEvent {
  id: string;
  title: string;
  summary: string | null;
  heat: number;
  repScore: number | null;
  stocks: string[];
  /** 分类三要素（与 classifyEvent 对齐） */
  tags: string[];
  repIndustry: string | null;
  repDriver: string | null;
}

export interface StockScore {
  name: string;
  score: number;
  mentions: number;
}

export interface ThemePlan {
  id: string; // '{dateKey}:{categoryId}'
  dateKey: string;
  category: Category;
  eventIds: string[];
  eventCount: number;
  heatTotal: number;
  topStocks: StockScore[];
  /** 事件数 ≥2 时需要 LLM 写催化逻辑 */
  needsLogic: boolean;
}

/**
 * Top 概念股计分：股票得分 = Σ(所在事件热度 + 代表帖评分×0.5)，按得分降序取前 5。
 */
export function topStocksOf(events: ThemeEvent[], limit = 5): StockScore[] {
  const acc = new Map<string, StockScore>();
  for (const e of events) {
    const weight = e.heat + (e.repScore ?? 0) * 0.5;
    for (const s of e.stocks) {
      const cur = acc.get(s) ?? { name: s, score: 0, mentions: 0 };
      cur.score += weight;
      cur.mentions += 1;
      acc.set(s, cur);
    }
  }
  return [...acc.values()].sort((a, b) => b.score - a.score || b.mentions - a.mentions).slice(0, limit);
}

/** 把时间窗内的事件按 taxonomy 分类聚成题材 */
export function buildThemes(dateKey: string, events: ThemeEvent[]): ThemePlan[] {
  const groups = groupByCategory(events);
  return groups.map(({ category, events: evts }) => ({
    id: `${dateKey}:${category.id}`,
    dateKey,
    category,
    eventIds: evts.map((e) => e.id),
    eventCount: evts.length,
    heatTotal: evts.reduce((n, e) => n + e.heat, 0),
    topStocks: topStocksOf(evts),
    needsLogic: evts.length >= 2,
  }));
}
