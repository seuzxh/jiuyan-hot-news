/** events 仓储：事件、成员、热度、推送增量查询 */
import type { Db } from "../db.js";
import type { HeatConfig } from "../config.js";
import type { ItemRow } from "./items.js";
import { nowIso } from "../time.js";

export interface EventRow {
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
  pushed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewEvent {
  id: string;
  title: string;
  tags: string[];
  stocks: string[];
  firstItemAt: string;
  lastItemAt: string;
}

export function newEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function upsertEvent(db: Db, evt: NewEvent): void {
  db.prepare(
    `INSERT INTO events (id, title, tags_json, stocks_json, first_item_at, last_item_at, member_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_item_at = MAX(last_item_at, excluded.last_item_at), updated_at = excluded.updated_at`,
  ).run(
    evt.id,
    evt.title,
    JSON.stringify(evt.tags),
    JSON.stringify(evt.stocks),
    evt.firstItemAt,
    evt.lastItemAt,
    nowIso(),
    nowIso(),
  );
}

export function updateEventContent(
  db: Db,
  id: string,
  fields: { title?: string; summary?: string; reason?: string },
): void {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  if (fields.title !== undefined) {
    sets.push("title = ?");
    params.push(fields.title);
  }
  if (fields.summary !== undefined) {
    sets.push("summary = ?");
    params.push(fields.summary);
  }
  if (fields.reason !== undefined) {
    sets.push("reason = ?");
    params.push(fields.reason);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  params.push(nowIso(), id);
  db.prepare(`UPDATE events SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function setEventPushed(db: Db, eventIds: string[], ts = nowIso()): void {
  const stmt = db.prepare("UPDATE events SET pushed_at = ? WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const id of eventIds) stmt.run(ts, id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function addEventMember(db: Db, eventId: string, itemId: string, role: "representative" | "member"): void {
  db.prepare(
    "INSERT OR IGNORE INTO event_members (event_id, item_id, role) VALUES (?, ?, ?)",
  ).run(eventId, itemId, role);
}

export function getEventsNeedingSummary(db: Db, limit = 100): EventRow[] {
  return db
    .prepare("SELECT * FROM events WHERE summary IS NULL ORDER BY heat DESC LIMIT ?")
    .all(limit) as unknown as EventRow[];
}

export interface EventWithMembers extends EventRow {
  members: ItemRow[];
  representative: ItemRow | null;
}

/** 事件 + 成员（推送与网站共用；保持传入 eventIds 的顺序，如热度降序） */
export function getEventsWithMembers(db: Db, eventIds: string[]): EventWithMembers[] {
  if (eventIds.length === 0) return [];
  const placeholders = eventIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM events WHERE id IN (${placeholders})`)
    .all(...eventIds) as unknown as EventRow[];
  const byId = new Map(rows.map((e) => [e.id, e]));
  const members = db
    .prepare(
      `SELECT i.* FROM event_members m JOIN items i ON i.id = m.item_id
       WHERE m.event_id IN (${placeholders})`,
    )
    .all(...eventIds) as unknown as ItemRow[];
  const byEvent = new Map<string, ItemRow[]>();
  for (const m of members) {
    const list = byEvent.get(m.event_id ?? "") ?? [];
    list.push(m);
    byEvent.set(m.event_id ?? "", list);
  }
  // SQL IN 不保证顺序，按传入 id 顺序重排
  return eventIds
    .map((id) => byId.get(id))
    .filter((e): e is EventRow => !!e)
    .map((e) => {
      const mem = (byEvent.get(e.id) ?? []).sort((a, b) => (b.score_avg ?? 0) - (a.score_avg ?? 0));
      return { ...e, members: mem, representative: mem[0] ?? null };
    });
}

/**
 * 推送增量：自 since 起有新成员（或新建）且未推送过新内容的事件，按热度降序。
 * pushed_at < last_item_at 表示"推送过但之后又有新帖"→ 视为有更新。
 */
export function getEventsForPush(db: Db, since: string, limit = 8): EventRow[] {
  return db
    .prepare(
      `SELECT * FROM events
       WHERE last_item_at > ? AND (pushed_at IS NULL OR pushed_at < last_item_at)
       ORDER BY heat DESC LIMIT ?`,
    )
    .all(since, limit) as unknown as EventRow[];
}

export function latestPushTime(db: Db): string | null {
  const row = db.prepare("SELECT MAX(sent_at) AS t FROM pushes").get() as { t: string | null };
  return row.t;
}

/** 重算全部事件热度（prev_heat 记录上一轮值，用于"涨"标记） */
export function recomputeHeat(db: Db, cfg: HeatConfig, ts = nowIso()): { events: number } {
  const now = ts;
  const events = db.prepare("SELECT id FROM events").all() as Array<{ id: string }>;
  const select = db.prepare(
    `SELECT published_at, like_count, metrics_json FROM items WHERE event_id = ?`,
  );
  const update = db.prepare(
    "UPDATE events SET prev_heat = heat, heat = ?, member_count = ?, first_item_at = ?, last_item_at = ?, updated_at = ? WHERE id = ?",
  );
  db.exec("BEGIN");
  try {
    for (const { id } of events) {
      const items = select.all(id) as Array<{
        published_at: string;
        like_count: number;
        metrics_json: string;
      }>;
      let heat = 0;
      let first: string | null = null;
      let last: string | null = null;
      for (const it of items) {
        const ageH = (Date.parse(now) - Date.parse(it.published_at)) / 3600_000;
        if (first === null || it.published_at < first) first = it.published_at;
        if (last === null || it.published_at > last) last = it.published_at;
        if (ageH > cfg.uniqueWindowHours) continue; // 窗口外不计
        const m = JSON.parse(it.metrics_json) as { reply: number; forward: number };
        let c = it.like_count * cfg.weights.like + m.reply * cfg.weights.reply + m.forward * cfg.weights.forward;
        if (ageH > cfg.decayHours) c *= 0.5;
        heat += c;
      }
      update.run(heat, items.length, first, last, nowIso(), id);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { events: events.length };
}
