/** Web 端数据访问：直接读管线 SQLite（只读查询，与 CLI 共用 @jyc/core） */
import { join } from "node:path";
import { findRepoRoot, groupByCategory, openDb, topStocksOf, type Db } from "@jyc/core";
import { groupConcepts } from "./grouping";

let dbSingleton: Db | undefined;

export function db(): Db {
  if (!dbSingleton) {
    const root = findRepoRoot();
    // JYC_DB_PATH：托管部署时把数据库快照拷到可写目录（SQLite WAL 需要写权限），本地默认走仓库内路径
    const dbPath = process.env.JYC_DB_PATH ?? join(root, "data", "jycgs.db");
    dbSingleton = openDb(dbPath, join(root, "database", "migrations"));
  }
  return dbSingleton;
}

export interface EventView {
  id: string;
  title: string;
  summary: string | null;
  reason: string | null;
  tags: string[];
  stocks: string[];
  heat: number;
  prev_heat: number;
  member_count: number;
  first_item_at: string | null;
  last_item_at: string | null;
  created_at: string;
  /** 代表帖 */
  rep_id: string | null;
  rep_title: string | null;
  rep_url: string | null;
  rep_score: number | null;
  rep_author: string | null;
  rep_badge: string | null;
  rep_industry: string | null;
  rep_driver: string | null;
}

interface EventRaw {
  id: string;
  title: string;
  summary: string | null;
  reason: string | null;
  tags_json: string;
  stocks_json: string;
  heat: number;
  prev_heat: number;
  member_count: number;
  first_item_at: string | null;
  last_item_at: string | null;
  created_at: string;
}

const EVENT_COLS = `e.id, e.title, e.summary, e.reason, e.tags_json, e.stocks_json, e.heat, e.prev_heat,
  e.member_count, e.first_item_at, e.last_item_at, e.created_at`;

function toView(
  r: EventRaw,
  rep?: { id: string; title: string; url: string; score: number | null; author: string; badge: string | null; industry: string | null; driver: string | null },
): EventView {
  return {
    ...r,
    tags: JSON.parse(r.tags_json) as string[],
    stocks: JSON.parse(r.stocks_json) as string[],
    rep_id: rep?.id ?? null,
    rep_title: rep?.title ?? null,
    rep_url: rep?.url ?? null,
    rep_score: rep?.score ?? null,
    rep_author: rep?.author ?? null,
    rep_badge: rep?.badge ?? null,
    rep_industry: rep?.industry ?? null,
    rep_driver: rep?.driver ?? null,
  };
}

/** 事件 + 代表帖（代表帖 = event_members 中 role=representative，或最高分成员） */
function withReps(rows: EventRaw[]): EventView[] {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const ph = ids.map(() => "?").join(",");
  const reps = db()
    .prepare(
      `SELECT m.event_id, i.id, i.title, i.url, i.score_avg, i.author_name, i.author_badge, i.tags_json
       FROM event_members m JOIN items i ON i.id = m.item_id
       WHERE m.event_id IN (${ph})
       ORDER BY m.role = 'representative' DESC, i.score_avg DESC`,
    )
    .all(...ids) as Array<{
      event_id: string;
      id: string;
      title: string;
      url: string;
      score_avg: number | null;
      author_name: string;
      author_badge: string | null;
      tags_json: string | null;
    }>;
  const repByEvent = new Map<string, (typeof reps)[number]>();
  for (const r of reps) if (!repByEvent.has(r.event_id)) repByEvent.set(r.event_id, r);
  return rows.map((r) => {
    const rep = repByEvent.get(r.id);
    let industry: string | null = null;
    let driver: string | null = null;
    if (rep?.tags_json) {
      try {
        const t = JSON.parse(rep.tags_json) as { industry?: string; driver?: string };
        industry = t.industry ?? null;
        driver = t.driver ?? null;
      } catch {
        /* 忽略坏 tags */
      }
    }
    return toView(
      r,
      rep
        ? { id: rep.id, title: rep.title, url: rep.url, score: rep.score_avg, author: rep.author_name, badge: rep.author_badge, industry, driver }
        : undefined,
    );
  });
}

// ---------- 概念逻辑卡 ----------

export interface ConceptStockView {
  name: string;
  /** 该标的在逻辑链中的环节/角色 */
  role: string;
}

export interface ConceptSource {
  id: string;
  title: string;
  heat: number;
  /** 最新帖子时间 */
  lastItemAt: string | null;
  url: string | null;
}

export interface ConceptView {
  id: string;
  rank: number;
  title: string;
  categoryId: string;
  categoryLabel: string;
  emoji: string;
  /** 一句话结论 */
  takeaway: string;
  /** 因果链环节 */
  chain: string[];
  stocks: ConceptStockView[];
  risk: string;
  eventIds: string[];
  eventCount: number;
  heatTotal: number;
  sources: ConceptSource[];
}

/** 某北京日期的概念逻辑卡（按 rank；无数据返回空数组，页面回退到帖子视图） */
export function conceptsOnDate(date: string): ConceptView[] {
  const rows = db()
    .prepare("SELECT * FROM concepts WHERE date_key = ? ORDER BY rank")
    .all(date) as unknown as Array<{
    id: string;
    rank: number;
    title: string;
    category_id: string;
    category_label: string;
    emoji: string;
    takeaway: string;
    chain_json: string;
    stocks_json: string;
    risk: string | null;
    event_ids_json: string;
    event_count: number;
    heat_total: number;
  }>;
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.flatMap((r) => JSON.parse(r.event_ids_json) as string[]))];
  const ph = ids.map(() => "?").join(",");
  const evts = db()
    .prepare(
      `SELECT e.id, e.title, e.heat, e.last_item_at,
        (SELECT i.url FROM event_members m JOIN items i ON i.id = m.item_id
          WHERE m.event_id = e.id ORDER BY m.role = 'representative' DESC, i.score_avg DESC LIMIT 1) AS url
       FROM events e WHERE e.id IN (${ph})`,
    )
    .all(...ids) as unknown as Array<{ id: string; title: string; heat: number; last_item_at: string | null; url: string | null }>;
  const byId = new Map(evts.map((e) => [e.id, e]));
  return rows.map((r) => {
    const eventIds = (JSON.parse(r.event_ids_json) as string[]).filter((id) => byId.has(id));
    return {
      id: r.id,
      rank: r.rank,
      title: r.title,
      categoryId: r.category_id,
      categoryLabel: r.category_label,
      emoji: r.emoji,
      takeaway: r.takeaway,
      chain: JSON.parse(r.chain_json) as string[],
      stocks: JSON.parse(r.stocks_json) as ConceptStockView[],
      risk: r.risk ?? "",
      eventIds,
      eventCount: eventIds.length,
      heatTotal: r.heat_total,
      sources: eventIds.map((id) => {
        const e = byId.get(id)!;
        return { id: e.id, title: e.title, heat: e.heat, lastItemAt: e.last_item_at, url: e.url };
      }),
    };
  });
}

// ---------- 日报：题材 × 核心个股 ----------

export interface ReportRow {
  title: string;
  takeaway: string;
  chain: string[];
  risk: string;
  stocks: ConceptStockView[];
  eventCount: number;
  sources: ConceptSource[];
}

export interface ReportGroup {
  /** 空串 = 不显示分区标题（自动汇总模式下每行本身就是一个题材分类） */
  label: string;
  emoji: string;
  rows: ReportRow[];
}

export interface DailyReport {
  /** concept = 来自逻辑卡；auto = 该日未做逻辑梳理，按展示分类把当日帖子自动汇总 */
  source: "concept" | "auto";
  groups: ReportGroup[];
  stockCount: number;
}

/** 某北京日期的日报数据：一行一个题材（逻辑线），右侧是它的核心个股 */
export function dailyReport(date: string): DailyReport {
  const concepts = conceptsOnDate(date);
  if (concepts.length > 0) {
    return {
      source: "concept",
      groups: groupConcepts(concepts).map((g) => ({
        label: g.label,
        emoji: g.emoji,
        rows: g.concepts.map((c) => ({
          title: c.title,
          takeaway: c.takeaway,
          chain: c.chain,
          risk: c.risk,
          stocks: c.stocks,
          eventCount: c.sources.length,
          sources: c.sources,
        })),
      })),
      stockCount: new Set(concepts.flatMap((c) => c.stocks.map((s) => s.name))).size,
    };
  }

  // 回退：没有逻辑卡的日期，题材 = 展示分类，核心个股按"帖子热度 + 评分"聚合，角色位置显示提及帖数
  const events = eventsOnDate(latestEvents(300), date);
  const rows = groupByCategory(events.map((e) => ({ event: e, tags: e.tags, repIndustry: e.rep_industry, repDriver: e.rep_driver }))).map(
    (g): ReportRow => {
      const evts = g.events.map((x) => x.event);
      const stocks = topStocksOf(
        evts.map((e) => ({
          id: e.id,
          title: e.title,
          heat: e.heat,
          repScore: e.rep_score,
          stocks: e.stocks,
          tags: e.tags,
          repIndustry: e.rep_industry,
          repDriver: e.rep_driver,
        })),
        10,
      );
      return {
        title: g.category.label,
        takeaway: "",
        chain: [],
        risk: "",
        // 只有一帖提及时不标计数，避免每只个股后面都挂着"1 帖提及"
        stocks: stocks.map((s) => ({ name: s.name, role: s.mentions > 1 ? `${s.mentions} 帖提及` : "" })),
        eventCount: evts.length,
        sources: evts.map((e) => ({ id: e.id, title: e.title, heat: e.heat, lastItemAt: e.last_item_at, url: e.rep_url })),
      };
    },
  );
  return {
    source: "auto",
    groups: [{ label: "", emoji: "", rows }],
    stockCount: new Set(rows.flatMap((r) => r.stocks.map((s) => s.name))).size,
  };
}

/** 精选事件流：按北京日期分组 */
export function latestEvents(limit = 300): EventView[] {
  const rows = db()
    .prepare(`SELECT ${EVENT_COLS} FROM events e ORDER BY e.first_item_at DESC LIMIT ?`)
    .all(limit) as unknown as EventRaw[];
  return withReps(rows);
}

function bjDay(iso: string): string {
  return new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 可选日期列表（北京日期，含当日事件数，倒序） */
export function availableDates(events: EventView[]): Array<{ date: string; count: number }> {
  const counter = new Map<string, number>();
  for (const e of events) {
    if (!e.first_item_at) continue;
    const d = bjDay(e.first_item_at);
    counter.set(d, (counter.get(d) ?? 0) + 1);
  }
  return [...counter.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** 取某北京日期的事件（热度降序） */
export function eventsOnDate(events: EventView[], date: string): EventView[] {
  return events.filter((e) => e.first_item_at && bjDay(e.first_item_at) === date).sort((a, b) => b.heat - a.heat);
}

/** 热点榜：近 24 小时有新帖的事件，按热度降序（窗口比热度计算的 48h 更短，只留当天还在讨论的） */
export function hotEvents(limit = 20): EventView[] {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rows = db()
    .prepare(
      `SELECT ${EVENT_COLS} FROM events e WHERE e.last_item_at >= ?
       ORDER BY e.heat DESC LIMIT ?`,
    )
    .all(since, limit) as unknown as EventRaw[];
  return withReps(rows);
}

/** 按 id 批量取事件（逻辑卡的来源帖可能落在所选日期之外） */
export function eventsByIds(ids: string[]): EventView[] {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const ph = unique.map(() => "?").join(",");
  const rows = db()
    .prepare(`SELECT ${EVENT_COLS} FROM events e WHERE e.id IN (${ph})`)
    .all(...unique) as unknown as EventRaw[];
  return withReps(rows);
}

export function getEvent(id: string): EventView | undefined {
  const rows = db()
    .prepare(`SELECT ${EVENT_COLS} FROM events e WHERE e.id = ?`)
    .all(id) as unknown as EventRaw[];
  return withReps(rows)[0];
}

export interface MemberView {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  author_name: string;
  author_badge: string | null;
  author_tier: string;
  published_at: string;
  score_avg: number | null;
  like_count: number;
  role: string;
}

export function eventMembers(eventId: string): MemberView[] {
  return db()
    .prepare(
      `SELECT i.id, i.title, i.url, i.excerpt, i.author_name, i.author_badge, i.author_tier,
              i.published_at, i.score_avg, i.like_count, m.role
       FROM event_members m JOIN items i ON i.id = m.item_id
       WHERE m.event_id = ?
       ORDER BY m.role = 'representative' DESC, i.score_avg DESC`,
    )
    .all(eventId) as unknown as MemberView[];
}

/** 全文搜索（标题/摘要/事件/帖子全文缓存，LIKE 近似） */
export function searchAll(q: string, limit = 40): { events: EventView[]; items: Array<{ id: string; title: string; url: string; published_at: string; event_id: string | null }> } {
  const like = `%${q}%`;
  const events = withReps(
    db()
      .prepare(
        `SELECT ${EVENT_COLS} FROM events e
         WHERE e.title LIKE ? OR e.summary LIKE ? OR e.tags_json LIKE ? OR e.stocks_json LIKE ?
         ORDER BY e.heat DESC LIMIT ?`,
      )
      .all(like, like, like, like, limit) as unknown as EventRaw[],
  );
  const items = db()
    .prepare(
      `SELECT i.id, i.title, i.url, i.published_at, i.event_id FROM items i
       LEFT JOIN item_details d ON d.item_id = i.id AND d.fetch_error IS NULL
       WHERE (i.title LIKE ? OR i.excerpt LIKE ? OR d.content LIKE ?) AND i.status = 'selected'
       ORDER BY i.published_at DESC LIMIT ?`,
    )
    .all(like, like, like, limit) as unknown as Array<{
      id: string;
      title: string;
      url: string;
      published_at: string;
      event_id: string | null;
    }>;
  return { events, items };
}

/** 推送历史 */
export function pushHistory(limit = 30): Array<{ id: string; slot: string; sent_at: string; titles: string[] }> {
  const rows = db()
    .prepare("SELECT id, slot, payload_json, sent_at FROM pushes ORDER BY sent_at DESC LIMIT ?")
    .all(limit) as unknown as Array<{ id: string; slot: string; payload_json: string; sent_at: string }>;
  return rows.map((r) => ({
    id: r.id,
    slot: r.slot,
    sent_at: r.sent_at,
    titles: (JSON.parse(r.payload_json) as { titles?: string[] }).titles ?? [],
  }));
}
