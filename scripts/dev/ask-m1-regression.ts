/**
 * M1 基准回归：把 docs/fixtures/ask-m1-baseline.json 记录的窗口数据拷进内存库
 * （还原基准锚点），用 recall() 原函数复算逐词命中与并集，逐项对齐。
 * CJK 词必须精确一致；ASCII 词允许与 SQL LIKE 口径差「大小写敏感」文档化差值。
 * 用法：npx tsx scripts/dev/ask-m1-regression.ts
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { recall } from "@jyc/ask";

interface Baseline {
  samples: Array<{
    keyword: string;
    kind: string;
    expandedKeywords: string[];
    perWordCounts: Record<string, number>;
    unionCount: number;
    unionCountCaseSensitive?: number;
    unionStatusBreakdown: Record<string, number>;
  }>;
}

const baseline = JSON.parse(
  readFileSync("docs/fixtures/ask-m1-baseline.json", "utf8"),
) as Baseline;

// 基准窗口（左开右闭）
const WIN_START = "2026-11-10T03:51:53.000Z";
const WIN_END = "2026-11-11T03:51:53.000Z";

const prod = new DatabaseSync("data/jycgs.db", { readOnly: true });
const mem = new DatabaseSync(":memory:");
mem.exec(`CREATE TABLE items (
  id TEXT PRIMARY KEY, ext_id TEXT, url TEXT, title TEXT, excerpt TEXT,
  stocks_json TEXT, published_at TEXT, status TEXT, score_avg REAL, event_id TEXT
)`);
mem.exec(`CREATE TABLE events (id TEXT PRIMARY KEY, title TEXT, summary TEXT, reason TEXT,
  tags_json TEXT, stocks_json TEXT, updated_at TEXT)`);

interface CopyRow {
  id: string;
  ext_id: string;
  url: string;
  title: string;
  excerpt: string;
  stocks_json: string;
  published_at: string;
  status: string;
  score_avg: number | null;
  event_id: string | null;
}

const rows = prod
  .prepare(
    `SELECT id, ext_id, url, title, excerpt, stocks_json, published_at, status, score_avg, event_id
     FROM items WHERE published_at > ? AND published_at <= ?`,
  )
  .all(WIN_START, WIN_END) as unknown as CopyRow[];
const insItems = mem.prepare(
  `INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
for (const r of rows) {
  insItems.run(
    r.id, r.ext_id, r.url, r.title, r.excerpt, r.stocks_json,
    r.published_at, r.status, r.score_avg, r.event_id,
  );
}
interface CopyEventRow {
  id: string;
  title: string;
  summary: string | null;
  reason: string | null;
  tags_json: string;
  stocks_json: string;
  updated_at: string;
}

const evts = prod
  .prepare("SELECT id, title, summary, reason, tags_json, stocks_json, updated_at FROM events")
  .all() as unknown as CopyEventRow[];
const insEvts = mem.prepare("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?)");
for (const e of evts) insEvts.run(e.id, e.title, e.summary, e.reason, e.tags_json, e.stocks_json, e.updated_at);
prod.close();

console.log(`窗口内 items：${rows.length}（基准 251；晚到入库/状态变化属正常漂移，命中数不受影响）\n`);

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
}

for (const s of baseline.samples) {
  console.log(`━━━ ${s.keyword}（${s.kind}，${s.expandedKeywords.length} 词）━━━`);

  // ---- 层1：逐词命中，基准口径 = 标题/摘要/stocks_json 三字段 OR LIKE（锚定数据与匹配规则）----
  for (const w of s.expandedKeywords) {
    const got = mem
      .prepare(
        `SELECT COUNT(*) AS n FROM items
         WHERE published_at > ? AND published_at <= ?
           AND (title LIKE ? OR excerpt LIKE ? OR stocks_json LIKE ?)`,
      )
      .get(WIN_START, WIN_END, `%${w}%`, `%${w}%`, `%${w}%`) as { n: number };
    check(got.n === (s.perWordCounts[w] ?? -1), `三字段逐词 ${w}: ${got.n}（基准 ${s.perWordCounts[w]}）`);
  }

  // ---- 层2：recall() 原函数（路B=两字段大小写敏感 / 路A=标签精确相等）----
  const { stats } = recall(
    mem,
    {
      identityWords: s.expandedKeywords,
      narrativeWords: [],
      stocks: s.kind === "个股" ? [s.keyword] : [],
    },
    { windowHours: 24, limit: 15 },
  );

  check(stats.window.anchor === WIN_END, `锚点 = 基准（${stats.window.anchor}）`);

  // 并集期望：福莱=31（基准口径两/三字段一致）；算力=两字段大小写敏感 72 + 仅事件 2 = 74（基准分解式）
  const textUnion = s.unionCountCaseSensitive ?? s.unionCount;
  const eventOnly = s.keyword === "算力" ? 2 : 0;
  check(
    stats.unionCount === textUnion + eventOnly,
    `三路并集 ${stats.unionCount}（路B ${stats.routeCounts.text} / 仅标签 ${stats.routeCounts.stockTagOnly} / 仅事件 ${stats.routeCounts.eventOnly}；期望 路B=${textUnion} 仅事件=${eventOnly}）`,
  );

  // 概念词（stocks_json 不含）的 recall 逐词数应与三字段口径一致
  const stockFree = s.expandedKeywords.filter((x) => {
    if (/^[\x21-\x7e]+$/.test(x)) return false; // ASCII 词走大小写敏感口径，另行人工核对
    const inTags = mem
      .prepare(`SELECT COUNT(*) AS n FROM items WHERE published_at > ? AND published_at <= ? AND stocks_json LIKE ?`)
      .get(WIN_START, WIN_END, `%${x}%`) as { n: number };
    return inTags.n === 0;
  });
  for (const w of stockFree) {
    const got = stats.perWord.find((p) => p.word === w)?.count ?? -1;
    check(got === (s.perWordCounts[w] ?? -1), `recall 逐词 ${w}: ${got}（基准 ${s.perWordCounts[w]}）`);
  }

  if (s.keyword === "福莱新材") {
    // ---- 层3：路 A 精确标签（方案 §0：21/31 来自 stocks_json 精确匹配，其中 16 条两字段不含股名）----
    const tagExact = mem
      .prepare(
        `SELECT COUNT(*) AS n FROM items
         WHERE published_at > ? AND published_at <= ? AND stocks_json LIKE ?`,
      )
      .get(WIN_START, WIN_END, `%"${s.keyword}"%`) as { n: number };
    check(tagExact.n === 21, `路 A 精确标签：${tagExact.n}（基准 21）`);
    // 撞名防护：福莱特在窗口内三字段 0 命中，"福莱"子串不会经路 A 误报
    const collision = mem
      .prepare(
        `SELECT COUNT(*) AS n FROM items
         WHERE published_at > ? AND published_at <= ? AND stocks_json LIKE ?`,
      )
      .get(WIN_START, WIN_END, `%"福莱特"%`) as { n: number };
    check(collision.n === 0, `撞名股福莱特：${collision.n} 命中（期望 0）`);
  }
  console.log("");
}

if (failures > 0) {
  console.log(`✗ 回归失败：${failures} 处不一致`);
  process.exit(1);
}
console.log("✓ M1 基准回归全部通过");
