/** item_details 表：帖子全文缓存（detail 阶段批量补齐 selected；ask 按需抓取共用，抓过不重抓） */
import type { Db } from "../db.js";
import { nowIso } from "../time.js";

export interface ItemDetailRow {
  item_id: string;
  content: string;
  fetched_at: string;
  fetch_error: string | null;
}

/** 已有缓存（含失败行）的 item id 集合 */
export function getItemIdsWithDetail(db: Db, ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const ph = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT item_id FROM item_details WHERE item_id IN (${ph})`)
    .all(...ids) as unknown as Array<{ item_id: string }>;
  return new Set(rows.map((r) => r.item_id));
}

export function upsertItemDetail(db: Db, itemId: string, content: string, fetchError: string | null = null): void {
  db.prepare(
    `INSERT INTO item_details (item_id, content, fetched_at, fetch_error)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET content = excluded.content, fetched_at = excluded.fetched_at, fetch_error = excluded.fetch_error`,
  ).run(itemId, content, nowIso(), fetchError);
}

/** 待补全文：selected 且无缓存行（失败行也算已处理，防反复重抓；--retry 先清失败行） */
export function getSelectedItemsNeedingDetail(db: Db, limit = 50): Array<{ id: string; ext_id: string; url: string; title: string }> {
  return db
    .prepare(
      `SELECT i.id, i.ext_id, i.url, i.title FROM items i
       WHERE i.status = 'selected' AND NOT EXISTS (SELECT 1 FROM item_details d WHERE d.item_id = i.id)
       ORDER BY i.like_count DESC LIMIT ?`,
    )
    .all(limit) as unknown as Array<{ id: string; ext_id: string; url: string; title: string }>;
}

/** --retry：删除失败行使其可重试 */
export function resetFailedDetails(db: Db): number {
  const r = db.prepare("DELETE FROM item_details WHERE fetch_error IS NOT NULL").run();
  return Number(r.changes);
}

/** 取多个帖子的全文（写作/检索共用；无缓存返回空 Map） */
export function getDetailMap(db: Db, ids: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const ph = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT item_id, content FROM item_details WHERE item_id IN (${ph}) AND fetch_error IS NULL`)
    .all(...ids) as unknown as Array<{ item_id: string; content: string }>;
  for (const r of rows) map.set(r.item_id, r.content);
  return map;
}
