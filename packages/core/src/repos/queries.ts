/** 只读视图查询：事件/热点/全文搜索/推送历史（web 与 scripts/search 共用，调用方传入 Db） */
import type { Db } from "../db.js";

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
function withReps(db: Db, rows: EventRaw[]): EventView[] {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const ph = ids.map(() => "?").join(",");
  const reps = db
    .prepare(
      `SELECT m.event_id, i.id, i.title, i.url, i.score_avg, i.author_name, i.author_badge, i.tags_json
       FROM event_members m JOIN items i ON i.id = m.item_id
       WHERE m.event_id IN (${ph})
       ORDER BY m.role = 'representative' DESC, i.score_avg DESC`,
    )
    .all(...ids) as unknown as Array<{
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

/** 精选事件流：按北京日期分组 */
export function latestEvents(db: Db, limit = 300): EventView[] {
  const rows = db
    .prepare(`SELECT ${EVENT_COLS} FROM events e ORDER BY e.first_item_at DESC LIMIT ?`)
    .all(limit) as unknown as EventRaw[];
  return withReps(db, rows);
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

/** 热点榜：48h 内按热度降序 */
export function hotEvents(db: Db, limit = 20): EventView[] {
  const since = new Date(Date.now() - 48 * 3600_000).toISOString();
  const rows = db
    .prepare(
      `SELECT ${EVENT_COLS} FROM events e WHERE e.last_item_at >= ?
       ORDER BY e.heat DESC LIMIT ?`,
    )
    .all(since, limit) as unknown as EventRaw[];
  return withReps(db, rows);
}

export function getEvent(db: Db, id: string): EventView | undefined {
  const rows = db
    .prepare(`SELECT ${EVENT_COLS} FROM events e WHERE e.id = ?`)
    .all(id) as unknown as EventRaw[];
  return withReps(db, rows)[0];
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

export function eventMembers(db: Db, eventId: string): MemberView[] {
  return db
    .prepare(
      `SELECT i.id, i.title, i.url, i.excerpt, i.author_name, i.author_badge, i.author_tier,
              i.published_at, i.score_avg, i.like_count, m.role
       FROM event_members m JOIN items i ON i.id = m.item_id
       WHERE m.event_id = ?
       ORDER BY m.role = 'representative' DESC, i.score_avg DESC`,
    )
    .all(eventId) as unknown as MemberView[];
}

export interface ItemHit {
  id: string;
  title: string;
  url: string;
  published_at: string;
  event_id: string | null;
}

/** 全文搜索（标题/摘要/事件/帖子全文缓存，LIKE 近似） */
export function searchAll(db: Db, q: string, limit = 40): { events: EventView[]; items: ItemHit[] } {
  const like = `%${q}%`;
  const events = withReps(
    db,
    db
      .prepare(
        `SELECT ${EVENT_COLS} FROM events e
         WHERE e.title LIKE ? OR e.summary LIKE ? OR e.tags_json LIKE ? OR e.stocks_json LIKE ?
         ORDER BY e.heat DESC LIMIT ?`,
      )
      .all(like, like, like, like, limit) as unknown as EventRaw[],
  );
  const items = db
    .prepare(
      `SELECT i.id, i.title, i.url, i.published_at, i.event_id FROM items i
       LEFT JOIN item_details d ON d.item_id = i.id AND d.fetch_error IS NULL
       WHERE (i.title LIKE ? OR i.excerpt LIKE ? OR d.content LIKE ?) AND i.status = 'selected'
       ORDER BY i.published_at DESC LIMIT ?`,
    )
    .all(like, like, like, limit) as unknown as ItemHit[];
  return { events, items };
}

/** 推送历史 */
export function pushHistory(db: Db, limit = 30): Array<{ id: string; slot: string; sent_at: string; titles: string[] }> {
  const rows = db
    .prepare("SELECT id, slot, payload_json, sent_at FROM pushes ORDER BY sent_at DESC LIMIT ?")
    .all(limit) as unknown as Array<{ id: string; slot: string; payload_json: string; sent_at: string }>;
  return rows.map((r) => ({
    id: r.id,
    slot: r.slot,
    sent_at: r.sent_at,
    titles: (JSON.parse(r.payload_json) as { titles?: string[] }).titles ?? [],
  }));
}

/** 数据截止时间：selected 帖最大发布时间（检索输出据此标注新鲜度） */
export function dataFreshness(db: Db): string | null {
  const row = db
    .prepare("SELECT MAX(published_at) AS t FROM items WHERE status = 'selected'")
    .get() as { t: string | null } | undefined;
  return row?.t ?? null;
}
