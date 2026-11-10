/** items 仓储：采集 upsert 与各阶段查询 */
import type { Db } from "../db.js";
import type { ItemMetrics, ItemStatus, RawItem } from "../types.js";
import { nowIso } from "../time.js";

export interface ItemRow {
  id: string;
  source_id: string;
  ext_id: string;
  url: string;
  title: string;
  excerpt: string;
  author_name: string;
  author_url: string | null;
  author_badge: string | null;
  author_tier: string;
  published_at: string;
  stocks_json: string;
  metrics_json: string;
  boards_json: string;
  like_count: number;
  first_seen_at: string;
  last_seen_at: string;
  crawl_count: number;
  status: string;
  prefilter_reason: string | null;
  score1: number | null;
  score2: number | null;
  score_avg: number | null;
  tags_json: string | null;
  event_id: string | null;
  updated_at: string;
}

export interface UpsertStats {
  fetched: number;
  inserted: number;
  updated: number;
}

/** 批量 upsert 采集结果：合并板块、更新互动数（取最大）、保留首次见时间 */
export function upsertCrawledItems(db: Db, items: RawItem[]): UpsertStats {
  // 同一轮内先按 extId 去重合并（同一帖出现在多个板块页）
  const merged = new Map<string, RawItem>();
  for (const it of items) {
    const prev = merged.get(it.url);
    if (!prev) {
      merged.set(it.url, it);
      continue;
    }
    prev.boards = [...new Set([...prev.boards, ...it.boards])];
    prev.metrics = {
      forward: Math.max(prev.metrics.forward, it.metrics.forward),
      reply: Math.max(prev.metrics.reply, it.metrics.reply),
      like: Math.max(prev.metrics.like, it.metrics.like),
    };
  }

  let inserted = 0;
  let updated = 0;
  const ts = nowIso();
  db.exec("BEGIN");
  try {
    const get = db.prepare("SELECT boards_json, crawl_count FROM items WHERE id = ?");
    const insert = db.prepare(`INSERT INTO items (
      id, source_id, ext_id, url, title, excerpt, author_name, author_url, author_badge,
      author_tier, published_at, stocks_json, metrics_json, boards_json, like_count,
      first_seen_at, last_seen_at, crawl_count, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'new', ?)`);
    const update = db.prepare(`UPDATE items SET
      last_seen_at = ?, boards_json = ?, metrics_json = ?, like_count = MAX(like_count, ?),
      author_badge = COALESCE(?, author_badge), crawl_count = crawl_count + 1, updated_at = ?
    WHERE id = ?`);

    for (const it of merged.values()) {
      const id = `${it.sourceId}:${it.extId}`;
      const existing = get.get(id) as { boards_json: string; crawl_count: number } | undefined;
      if (!existing) {
        insert.run(
          id, it.sourceId, it.extId, it.url, it.title, it.excerpt, it.authorName,
          it.authorUrl ?? null, it.authorBadge ?? null, it.authorTier, it.publishedAt,
          JSON.stringify(it.stocks), JSON.stringify(it.metrics), JSON.stringify(it.boards),
          it.metrics.like, ts, ts, ts,
        );
        inserted++;
      } else {
        const boards = [...new Set([...(JSON.parse(existing.boards_json) as string[]), ...it.boards])];
        update.run(ts, JSON.stringify(boards), JSON.stringify(it.metrics), it.metrics.like, it.authorBadge ?? null, ts, id);
        updated++;
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { fetched: items.length, inserted, updated };
}

export function getItem(db: Db, id: string): ItemRow | undefined {
  return db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;
}

export function getItemsByStatus(db: Db, status: ItemStatus, limit = 200): ItemRow[] {
  return db
    .prepare("SELECT * FROM items WHERE status = ? ORDER BY published_at DESC LIMIT ?")
    .all(status, limit) as unknown as ItemRow[];
}

/** 近 N 天内已进入过候选/入选流程的条目（近似去重的比对池） */
export function getRecentProcessedItems(db: Db, withinHours = 14 * 24, limit = 2000): ItemRow[] {
  const since = new Date(Date.now() - withinHours * 3600_000).toISOString();
  return db
    .prepare(
      `SELECT * FROM items
       WHERE published_at >= ? AND status IN ('candidate','scored','selected','rejected')
       ORDER BY published_at DESC LIMIT ?`,
    )
    .all(since, limit) as unknown as ItemRow[];
}

export function parseMetrics(json: string): ItemMetrics {
  return JSON.parse(json) as ItemMetrics;
}

/** 更新单条状态（预筛/打分/聚簇各阶段共用） */
export function setStatus(
  db: Db,
  id: string,
  status: ItemStatus,
  reason?: string,
  extra?: { score1?: number; score2?: number; scoreAvg?: number; tagsJson?: string; eventId?: string },
): void {
  const sets = ["status = ?", "updated_at = ?"];
  const params: Array<string | number | null> = [status, nowIso()];
  if (reason !== undefined) {
    sets.push("prefilter_reason = ?");
    params.push(reason);
  }
  if (extra?.score1 !== undefined) {
    sets.push("score1 = ?");
    params.push(extra.score1);
  }
  if (extra?.score2 !== undefined) {
    sets.push("score2 = ?");
    params.push(extra.score2);
  }
  if (extra?.scoreAvg !== undefined) {
    sets.push("score_avg = ?");
    params.push(extra.scoreAvg);
  }
  if (extra?.tagsJson !== undefined) {
    sets.push("tags_json = ?");
    params.push(extra.tagsJson);
  }
  if (extra?.eventId !== undefined) {
    sets.push("event_id = ?");
    params.push(extra.eventId);
  }
  params.push(id);
  db.prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function parseStocks(json: string): string[] {
  return JSON.parse(json) as string[];
}
