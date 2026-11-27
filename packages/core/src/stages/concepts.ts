/** 概念聚合：窗口内事件按"产业逻辑链"归成概念（LLM 归类并写逻辑卡），帖数/热度/排序由代码计算 */
import { CATEGORIES, classifyEvent, type Category } from "../taxonomy.js";

export interface ConceptStock {
  name: string;
  role: string;
}

/** LLM 产出、已通过校验的单个概念 */
export interface ConceptDraft {
  title: string;
  category: string;
  takeaway: string;
  chain: string[];
  stocks: ConceptStock[];
  risk: string;
  eventIds: string[];
}

export interface ConceptEvent {
  id: string;
  title: string;
  heat: number;
  repScore: number | null;
  stocks: string[];
  tags: string[];
  repIndustry: string | null;
  repDriver: string | null;
}

export interface ConceptPlan {
  id: string; // '{dateKey}:c{nn}'
  dateKey: string;
  rank: number;
  title: string;
  category: Category;
  takeaway: string;
  chain: string[];
  stocks: ConceptStock[];
  risk: string;
  eventIds: string[];
  eventCount: number;
  heatTotal: number;
}

/** 各字段长度上限（超出裁剪而非报错：超长不影响归位，坏 id 才需要人工修） */
export const CONCEPT_LIMITS = {
  title: 16,
  takeaway: 64,
  chainStep: 40,
  chainMax: 6,
  stockName: 12,
  stockRole: 16,
  stocksMax: 8,
  risk: 90,
} as const;

/** 未被任何概念覆盖的事件的兜底概念名（推送据此把"因果链"位置改按并列列出） */
export const CONCEPT_OTHER_TITLE = "其他动态";

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** 个股得分 = Σ(所在事件热度 + 代表帖评分×0.5)，按得分降序 */
export function topStocksOf(events: ConceptEvent[], limit = 5): Array<{ name: string; score: number; mentions: number }> {
  const acc = new Map<string, { name: string; score: number; mentions: number }>();
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

/** 分类展示顺序：产业类按 taxonomy 顺序，情绪/盘面与"其他"垫底 */
export function conceptCategoryRank(categoryId: string): number {
  const idx = CATEGORIES.findIndex((c) => c.id === categoryId);
  const base = idx === -1 ? CATEGORIES.length : idx;
  return categoryId === "other" ? 100 : categoryId === "sentiment" ? 50 : base;
}

function normalizeStocks(stocks: ConceptStock[]): ConceptStock[] {
  const seen = new Set<string>();
  const out: ConceptStock[] = [];
  for (const s of stocks) {
    const name = s.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name: clip(name, CONCEPT_LIMITS.stockName), role: clip(s.role.trim(), CONCEPT_LIMITS.stockRole) });
    if (out.length >= CONCEPT_LIMITS.stocksMax) break;
  }
  return out;
}

/**
 * 把 LLM 的概念草稿归一化为落库计划：
 * 裁剪超长字段、剔除非法 eventId、未被任何概念覆盖的事件兜底成"其他动态"，最后排序编号。
 */
export function planConcepts(dateKey: string, drafts: ConceptDraft[], events: ConceptEvent[]): ConceptPlan[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const covered = new Set<string>();
  const plans: Array<Omit<ConceptPlan, "id" | "rank" | "dateKey">> = [];

  for (const d of drafts) {
    const eventIds = [...new Set(d.eventIds)].filter((id) => byId.has(id));
    if (eventIds.length === 0) continue;
    eventIds.forEach((id) => covered.add(id));
    const members = eventIds.map((id) => byId.get(id)!);
    // 类目非法/缺失时，用成员事件的标签、驱动、行业兜底分类
    const category =
      CATEGORIES.find((c) => c.id === d.category) ??
      classifyEvent({
        tags: [...new Set(members.flatMap((e) => e.tags))],
        repIndustry: members[0]?.repIndustry ?? null,
        repDriver: members.find((e) => e.repDriver)?.repDriver ?? null,
      });
    plans.push({
      title: clip(d.title.trim(), CONCEPT_LIMITS.title) || CONCEPT_OTHER_TITLE,
      category,
      takeaway: clip(d.takeaway.trim(), CONCEPT_LIMITS.takeaway),
      chain: d.chain.map((s) => s.trim()).filter(Boolean).slice(0, CONCEPT_LIMITS.chainMax).map((s) => clip(s, CONCEPT_LIMITS.chainStep)),
      stocks: normalizeStocks(d.stocks),
      risk: clip(d.risk.trim(), CONCEPT_LIMITS.risk),
      eventIds,
      eventCount: eventIds.length,
      heatTotal: members.reduce((n, e) => n + e.heat, 0),
    });
  }

  // 未覆盖事件兜底：逻辑链位置上列出帖子标题，保证推送/站点不丢信息
  const uncovered = events.filter((e) => !covered.has(e.id));
  if (uncovered.length > 0) {
    plans.push({
      title: CONCEPT_OTHER_TITLE,
      category: CATEGORIES[CATEGORIES.length - 1]!,
      takeaway: `未归入上述概念的 ${uncovered.length} 条零散信息`,
      chain: uncovered.map((e) => clip(e.title, CONCEPT_LIMITS.chainStep)),
      stocks: topStocksOf(uncovered).map((s) => ({ name: s.name, role: "" })),
      risk: "",
      eventIds: uncovered.map((e) => e.id),
      eventCount: uncovered.length,
      heatTotal: uncovered.reduce((n, e) => n + e.heat, 0),
    });
  }

  // 排序：情绪/盘面与"其他"垫底；其余按"有多少帖子在讲"排——汇总帖热度高且同时属于多个概念，
  // 用热度合计排序会让它们偏置，帖数更能代表一条逻辑线的讨论广度
  const isTail = (categoryId: string) => (conceptCategoryRank(categoryId) >= 50 ? 1 : 0);
  return plans
    .sort(
      (a, b) =>
        isTail(a.category.id) - isTail(b.category.id) ||
        b.eventCount - a.eventCount ||
        b.heatTotal - a.heatTotal,
    )
    .map((p, i) => ({ ...p, id: `${dateKey}:c${String(i + 1).padStart(2, "0")}`, rank: i + 1, dateKey }));
}
