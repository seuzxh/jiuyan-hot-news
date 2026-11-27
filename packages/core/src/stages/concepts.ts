/** 概念聚合：窗口内事件按"产业逻辑链"归成概念（LLM 归类并写逻辑卡），帖数/热度/排序由代码计算 */
import { CATEGORIES, classifyEvent, type Category } from "../taxonomy.js";

/** 催化明细：一条具体的事实或催化时点（LLM 从帖子正文提炼，逻辑线详情页逐条展示） */
export interface ConceptCatalyst {
  /** 发生/预期的时间，取自帖子（"11.26"、"2027Q1"）；帖子未给日期时为空 */
  when: string;
  /** 提炼后的事实本身，保留关键数字 */
  fact: string;
  /** 这条事实对逻辑链意味着什么；没有就留空 */
  impact: string;
  /** 尚未发生的催化时点（发布会、量产、政策生效、解禁等） */
  upcoming: boolean;
  /** 出处帖子 id；无法对应时为空串 */
  eventId: string;
}

export interface ConceptStock {
  name: string;
  /** 该标的在逻辑链中的环节/角色 */
  role: string;
  /** 入选依据：帖子给出的具体事实（订单/认证/产能/份额等）；只提了名字的留空 */
  basis: string;
  /** 帖子未点名、由 LLM 补充的公认龙头 */
  added: boolean;
}

/** LLM 产出里的催化明细（归一化前：除 fact 外都可缺省） */
export interface ConceptCatalystInput {
  when?: string;
  fact: string;
  impact?: string;
  upcoming?: boolean;
  eventId?: string;
}

/** LLM 产出里的标的（归一化前：除 name/role 外都可缺省） */
export interface ConceptStockInput {
  name: string;
  role: string;
  basis?: string;
  added?: boolean;
}

/** LLM 产出、已通过校验的单个概念 */
export interface ConceptDraft {
  title: string;
  category: string;
  takeaway: string;
  chain: string[];
  stocks: ConceptStockInput[];
  risk: string;
  eventIds: string[];
  /** 升级前的结果没有这一项，归一化后为空数组 */
  catalysts?: ConceptCatalystInput[];
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
  id: string; // '{dateKey}:{标题短哈希}'
  dateKey: string;
  rank: number;
  title: string;
  category: Category;
  takeaway: string;
  chain: string[];
  stocks: ConceptStock[];
  catalysts: ConceptCatalyst[];
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
  stockBasis: 60,
  /** 详情页列全链条上的标的；卡片/推送/日报各自截取前几个 */
  stocksMax: 20,
  catalystWhen: 14,
  catalystFact: 90,
  catalystImpact: 50,
  catalystsMax: 8,
  risk: 90,
} as const;

/** 未被任何概念覆盖的事件的兜底概念名（推送据此把"因果链"位置改按并列列出） */
export const CONCEPT_OTHER_TITLE = "其他动态";

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** 标题的 FNV-1a 短哈希：概念 id 的稳定部分 */
function titleKey(title: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < title.length; i++) {
    h ^= title.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(6, "0").slice(-6);
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

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeStocks(stocks: ConceptStockInput[]): ConceptStock[] {
  const seen = new Set<string>();
  const out: ConceptStock[] = [];
  for (const s of stocks) {
    const name = s.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name: clip(name, CONCEPT_LIMITS.stockName),
      role: clip(text(s.role), CONCEPT_LIMITS.stockRole),
      basis: clip(text(s.basis), CONCEPT_LIMITS.stockBasis),
      added: s.added === true,
    });
    if (out.length >= CONCEPT_LIMITS.stocksMax) break;
  }
  return out;
}

/** 催化明细：裁剪超长、按事实去重；出处帖不在窗口内的只去掉链接、保留事实本身 */
function normalizeCatalysts(items: ConceptCatalystInput[] | undefined, validEventIds: { has(id: string): boolean }): ConceptCatalyst[] {
  const out: ConceptCatalyst[] = [];
  const seen = new Set<string>();
  for (const c of items ?? []) {
    const fact = clip(text(c.fact), CONCEPT_LIMITS.catalystFact);
    if (!fact || seen.has(fact)) continue;
    seen.add(fact);
    const eventId = text(c.eventId);
    out.push({
      when: clip(text(c.when), CONCEPT_LIMITS.catalystWhen),
      fact,
      impact: clip(text(c.impact), CONCEPT_LIMITS.catalystImpact),
      upcoming: c.upcoming === true,
      eventId: validEventIds.has(eventId) ? eventId : "",
    });
    if (out.length >= CONCEPT_LIMITS.catalystsMax) break;
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
      catalysts: normalizeCatalysts(d.catalysts, byId),
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
      stocks: topStocksOf(uncovered).map((s) => ({ name: s.name, role: "", basis: "", added: false })),
      catalysts: [],
      risk: "",
      eventIds: uncovered.map((e) => e.id),
      eventCount: uncovered.length,
      heatTotal: uncovered.reduce((n, e) => n + e.heat, 0),
    });
  }

  // 排序：情绪/盘面与"其他"垫底；其余按"有多少帖子在讲"排——汇总帖热度高且同时属于多个概念，
  // 用热度合计排序会让它们偏置，帖数更能代表一条逻辑线的讨论广度
  const isTail = (categoryId: string) => (conceptCategoryRank(categoryId) >= 50 ? 1 : 0);
  // id 取标题哈希而不是序号：同一天多次重建排序会变，按序号编号会让已分享出去的详情链接指向别的逻辑线
  const used = new Set<string>();
  return plans
    .sort(
      (a, b) =>
        isTail(a.category.id) - isTail(b.category.id) ||
        b.eventCount - a.eventCount ||
        b.heatTotal - a.heatTotal,
    )
    .map((p, i) => {
      const base = titleKey(p.title);
      let key = base;
      for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
      used.add(key);
      return { ...p, id: `${dateKey}:${key}`, rank: i + 1, dateKey };
    });
}
