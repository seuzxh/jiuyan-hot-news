/**
 * 三路召回归回测试：覆盖实测六坑（docs/关键词问答技术方案.md §2.2 / §3.6）。
 * 内存 SQLite 造数，纯函数验证——不依赖生产库。
 */
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { normalizeKeyword, recall, type RecallQuery } from "./recall.js";

const ANCHOR = "2026-11-11T03:51:53.000Z";
const IN_WINDOW = "2026-11-11T02:00:00.000Z";
const JUST_OUT = "2026-11-10T03:51:53.000Z"; // = anchor-24h，左开 → 窗外
const FAR_OUT = "2026-11-09T00:00:00.000Z";

interface TestItem {
  id?: string;
  extId?: string;
  title: string;
  excerpt: string;
  stocks?: string[];
  publishedAt?: string;
  status?: string;
  scoreAvg?: number | null;
  eventId?: string | null;
}

function makeDb(items: TestItem[], events: Array<{ id: string; title: string; summary?: string }> = []) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE items (
    id TEXT PRIMARY KEY, ext_id TEXT, url TEXT, title TEXT, excerpt TEXT,
    stocks_json TEXT, published_at TEXT, status TEXT, score_avg REAL, event_id TEXT
  )`);
  db.exec(`CREATE TABLE events (id TEXT PRIMARY KEY, title TEXT, summary TEXT, reason TEXT,
    tags_json TEXT, stocks_json TEXT, updated_at TEXT)`);
  const ins = db.prepare(
    `INSERT INTO items (id, ext_id, url, title, excerpt, stocks_json, published_at, status, score_avg, event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [i, it] of items.entries()) {
    const extId = it.extId ?? `e${i}`;
    ins.run(
      it.id ?? `jiuyangongshe:${extId}`,
      extId,
      `https://www.jiuyangongshe.com/a/${extId}`,
      it.title,
      it.excerpt,
      JSON.stringify(it.stocks ?? []),
      it.publishedAt ?? IN_WINDOW,
      it.status ?? "new",
      it.scoreAvg ?? null,
      it.eventId ?? null,
    );
  }
  const insEvt = db.prepare(
    `INSERT INTO events (id, title, summary, reason, tags_json, stocks_json, updated_at)
     VALUES (?, ?, ?, '', '[]', '[]', ?)`,
  );
  for (const e of events) insEvt.run(e.id, e.title, e.summary ?? "", ANCHOR);
  return db;
}

const Q = (over: Partial<RecallQuery> = {}): RecallQuery => ({
  identityWords: ["福莱新材"],
  narrativeWords: [],
  stocks: [],
  ...over,
});

describe("坑① 多词匹配窗口泄漏（括号 bug 的程序内等价物）", () => {
  it("窗口 (anchor-24h, anchor] 左开右闭，窗外帖子即使含词也不召回", () => {
    const db = makeDb([
      { title: "福莱新材锚点帖", excerpt: "正文", publishedAt: ANCHOR },
      { title: "福莱新材旧闻（恰在左边界）", excerpt: "正文", publishedAt: JUST_OUT },
      { title: "福莱新材三天前旧闻", excerpt: "正文", publishedAt: FAR_OUT },
    ]);
    const { stats, candidates } = recall(db, Q());
    expect(stats.window.anchor).toBe(ANCHOR);
    expect(stats.unionCount).toBe(1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.title).toContain("锚点帖");
  });
});

describe("坑③ 英文词大小写（SQLite LIKE 对 ASCII 不区分）", () => {
  it("'AI' 不命中小写 ai 子串（domain/said），命中大写 AI", () => {
    const db = makeDb([
      { title: "domain model said something", excerpt: "maintain airflow" },
      { title: "AI 芯片新进展", excerpt: "正文" },
      { title: "ai 眼镜 lowercase", excerpt: "正文" },
    ]);
    const { candidates } = recall(db, Q({ identityWords: ["AI"] }));
    expect(candidates.map((c) => c.title)).toEqual(["AI 芯片新进展"]);
  });
});

describe("坑⑤ stocks_json 裸子串误报（'东方'→日出东方）", () => {
  it("路 A 精确相等：'东方' 不命中 [日出东方,东方海洋]，命中 [东方]", () => {
    const db = makeDb([
      { title: "无关标题甲", excerpt: "无关正文", stocks: ["日出东方", "东方海洋"] },
      { title: "无关标题乙", excerpt: "无关正文", stocks: ["东方海洋"] },
      { title: "直接命中", excerpt: "无关正文", stocks: ["东方"] },
    ]);
    const { candidates } = recall(db, Q({ identityWords: [], stocks: ["东方"] }));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.routeA).toBe(true);
    expect(candidates[0]!.routeB).toBe(false);
  });

  it("路 A 是主召回：标签命中但标题摘要完全不含股名（实测 16/31 仅此路命中）", () => {
    const db = makeDb([
      { title: "数采手套产业链梳理", excerpt: "完全没提股票名字", stocks: ["福莱新材"] },
    ]);
    const { candidates } = recall(db, Q({ identityWords: [], stocks: ["福莱新材"] }));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.routeA).toBe(true);
  });
});

describe("坑⑦ 不筛 status（预筛轴与关联轴不同轴）", () => {
  it("rejected/blocked/archived_old 帖照常召回", () => {
    const db = makeDb([
      { title: "福莱新材 rejected 帖", excerpt: "x", status: "rejected", scoreAvg: 33 },
      { title: "福莱新材 blocked 帖", excerpt: "x", status: "blocked" },
      { title: "福莱新材 selected 帖", excerpt: "x", status: "selected", scoreAvg: 88 },
    ]);
    const { candidates } = recall(db, Q());
    expect(candidates.map((c) => c.status).sort()).toEqual(["blocked", "rejected", "selected"]);
  });
});

describe("坑⑫ 降权（加帖型 ×0.5 / 多股简报 ×0.3，不剔除）", () => {
  it("盘前早报类标题同分靠后，多股简报帖（路A+>5标签+文本零交集）大幅靠后", () => {
    const db = makeDb([
      { title: "福莱新材盘前早报", excerpt: "含词摘要 福莱新材", stocks: ["福莱新材"] },
      { title: "福莱新材深度逻辑", excerpt: "含词摘要 福莱新材", stocks: ["福莱新材"] },
      {
        title: "完全不含词的标题",
        excerpt: "也不含词",
        stocks: ["福莱新材", "甲", "乙", "丙", "丁", "戊"],
      },
    ]);
    const { candidates, stats } = recall(db, Q({ stocks: ["福莱新材"] }));
    const order = candidates.map((c) => c.title);
    expect(order[0]).toBe("福莱新材深度逻辑");
    expect(order.indexOf("福莱新材盘前早报")).toBeGreaterThan(order.indexOf("福莱新材深度逻辑"));
    expect(order).toContain("完全不含词的标题"); // 降权不剔除
    const demotedIds = stats.demoted.map((d) => d.reason);
    expect(demotedIds).toContain("加帖型");
    expect(demotedIds).toContain("多股简报");
  });
});

describe("坑⑨ 段间 ID 口径", () => {
  it("candidate.id 是 items 主键（jiuyangongshe:xxx），extId/url 独立字段", () => {
    const db = makeDb([{ title: "福莱新材", excerpt: "x", extId: "abc123" }]);
    const { candidates } = recall(db, Q());
    expect(candidates[0]!.id).toBe("jiuyangongshe:abc123");
    expect(candidates[0]!.extId).toBe("abc123");
    expect(candidates[0]!.url).toBe("https://www.jiuyangongshe.com/a/abc123");
  });
});

describe("路 C 事件回链", () => {
  it("events LLM 字段命中 → 窗口内带 event_id 的帖子被召回（原文用词不同形）", () => {
    const db = makeDb(
      [
        {
          title: "端侧推理新帖（不含查询词）",
          excerpt: "token 消耗下降",
          eventId: "evt_1",
        },
      ],
      [{ id: "evt_1", title: "算力事件：端侧推理降本", summary: "边缘算力推理成本下降" }],
    );
    const { candidates } = recall(db, Q({ identityWords: ["算力"] }));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.routeC).toBe(true);
  });
});

describe("逐词命中统计与扩窗数据", () => {
  it("perWord 记录每个词 24h 命中数，零命中词入 zeroHitWords", () => {
    const db = makeDb([
      { title: "福莱新材 A", excerpt: "x" },
      { title: "福莱新材 B", excerpt: "x" },
      { title: "灵巧手 C", excerpt: "x" },
    ]);
    const { stats } = recall(db, Q({ narrativeWords: ["灵巧手", "触觉手套"] }));
    const byWord = Object.fromEntries(stats.perWord.map((p) => [p.word, p.count]));
    expect(byWord["福莱新材"]).toBe(2);
    expect(byWord["灵巧手"]).toBe(1);
    expect(byWord["触觉手套"]).toBe(0);
    expect(stats.zeroHitWords).toEqual(["触觉手套"]);
  });
});

describe("normalizeKeyword（单飞锁键）", () => {
  it("去空白 + 全角转半角 + 小写", () => {
    expect(normalizeKeyword("　福莱 新材　")).toBe("福莱新材");
    expect(normalizeKeyword("ＣＰＯ 液冷")).toBe("cpo液冷");
  });
});
