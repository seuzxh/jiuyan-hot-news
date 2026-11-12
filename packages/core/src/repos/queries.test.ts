/** 只读视图查询单测：内存库造数，覆盖标题命中、全文缓存命中、状态过滤、热点窗口与数据截止 */
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { dataFreshness, hotEvents, searchAll } from "./queries.js";

const NOW = new Date("2026-11-12T04:00:00.000Z").getTime();

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE items (
    id TEXT PRIMARY KEY, url TEXT, title TEXT, excerpt TEXT, author_name TEXT DEFAULT '',
    author_badge TEXT, author_tier TEXT DEFAULT 'T2', published_at TEXT, score_avg REAL,
    like_count INTEGER DEFAULT 0, tags_json TEXT DEFAULT NULL, status TEXT DEFAULT 'selected', event_id TEXT
  )`);
  db.exec(`CREATE TABLE item_details (item_id TEXT PRIMARY KEY, content TEXT, fetch_error TEXT)`);
  db.exec(`CREATE TABLE events (id TEXT PRIMARY KEY, title TEXT, summary TEXT, reason TEXT,
    tags_json TEXT, stocks_json TEXT, heat REAL DEFAULT 0, prev_heat REAL DEFAULT 0,
    member_count INTEGER DEFAULT 0, first_item_at TEXT, last_item_at TEXT, created_at TEXT)`);
  db.exec(`CREATE TABLE event_members (event_id TEXT, item_id TEXT, role TEXT)`);
  db.exec(`CREATE TABLE pushes (id TEXT PRIMARY KEY, slot TEXT, payload_json TEXT, sent_at TEXT)`);
  return db;
}

function iso(hoursAgo: number): string {
  return new Date(NOW - hoursAgo * 3600_000).toISOString();
}

let db: DatabaseSync;

beforeEach(() => {
  db = makeDb();
  const insItem = db.prepare(
    `INSERT INTO items (id, url, title, excerpt, published_at, score_avg, status, event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // i1 标题命中；i2 全程无关键词（对照组）；i3 仅全文缓存命中；i4 有关键词但 rejected 应被过滤
  insItem.run("i1", "u1", "固态电池新突破", "摘要", iso(2), 80, "selected", "e1");
  insItem.run("i2", "u2", "调研纪要", "日常记录", iso(3), 70, "selected", null);
  insItem.run("i3", "u3", "无关标题", "普通摘要", iso(4), 60, "selected", null);
  insItem.run("i4", "u4", "固态电池但被拒", "摘要", iso(5), 10, "rejected", null);
  db.prepare(`INSERT INTO item_details (item_id, content, fetch_error) VALUES (?, ?, ?)`).run("i3", "全文含固态电池细节", null);
  db.prepare(
    `INSERT INTO events (id, title, summary, tags_json, stocks_json, heat, prev_heat, member_count, first_item_at, last_item_at, created_at)
     VALUES ('e1', '固态电池事件', '综述', '["电池"]', '["A公司"]', 90, 70, 1, ?, ?, ?)`,
  ).run(iso(2), iso(1), iso(1));
  db.exec(`INSERT INTO event_members (event_id, item_id, role) VALUES ('e1', 'i1', 'representative')`);
});

describe("searchAll", () => {
  it("命中事件（标题）并带代表帖", () => {
    const r = searchAll(db, "固态电池");
    expect(r.events).toHaveLength(1);
    expect(r.events[0]?.id).toBe("e1");
    expect(r.events[0]?.rep_id).toBe("i1");
    expect(r.events[0]?.heat).toBe(90);
  });

  it("帖子命中两路：标题与全文缓存；对照组与 rejected 不入结果", () => {
    const ids = searchAll(db, "固态电池").items.map((i) => i.id);
    expect(ids).toContain("i1"); // 标题命中
    expect(ids).toContain("i3"); // item_details.content 命中
    expect(ids).not.toContain("i2"); // 无关键词
    expect(ids).not.toContain("i4"); // status=rejected 被过滤
  });

  it("无命中返回空", () => {
    expect(searchAll(db, "不存在的词")).toEqual({ events: [], items: [] });
  });
});

describe("hotEvents", () => {
  it("48h 窗口内按热度返回并解析 tags/stocks", () => {
    const events = hotEvents(db, 10);
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe("固态电池事件");
    expect(events[0]?.tags).toEqual(["电池"]);
    expect(events[0]?.stocks).toEqual(["A公司"]);
  });
});

describe("dataFreshness", () => {
  it("取 selected 帖最大发布时间", () => {
    expect(dataFreshness(db)).toBe(iso(2));
  });
});
