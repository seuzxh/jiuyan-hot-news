/**
 * 三路检索召回（关键词问股·段②b，纯代码无 LLM）。
 * 全部匹配在程序内完成（不用 SQL 拼 LIKE），从根上规避实测三坑：
 * ① 多词 OR 缺外层括号导致窗口泄漏 ② SQLite LIKE 对 ASCII 不区分大小写（'AI' 误命中 125 条英文帖）
 * ③ stocks_json 裸 LIKE 子串误报（"东方"命中日出东方）——路 A 用数组元素精确相等。
 * 设计依据 docs/关键词问答技术方案.md §一 段②b。
 */
import type { Db } from "@jyc/core";

export interface RecallQuery {
  /** 身份词：全称/简称/代码/别名 */
  identityWords: string[];
  /** 叙事词：该股/该概念独占的产品叙事 */
  narrativeWords: string[];
  /** 意图股票池（仅作路 A 精确召回输入） */
  stocks: string[];
}

export interface RecallCandidate {
  /** items 主键（形如 jiuyangongshe:xxx，段间统一口径；展示/外链用 url/extId） */
  id: string;
  extId: string;
  url: string;
  title: string;
  excerpt: string;
  stocks: string[];
  publishedAt: string;
  status: string;
  scoreAvg: number | null;
  eventId: string | null;
  /** 命中的检索词 */
  hits: string[];
  routeA: boolean;
  routeB: boolean;
  routeC: boolean;
  score: number;
}

export interface RecallStats {
  window: { start: string; end: string; anchor: string; hours: number };
  perWord: Array<{ word: string; count: number }>;
  /** 三路并集（去重后） */
  unionCount: number;
  routeCounts: { text: number; stockTagOnly: number; eventOnly: number };
  zeroHitWords: string[];
  candidates: number;
  /** 降权明细（加帖型 ×0.5 / 多股简报 ×0.3，M1 待校准参数） */
  demoted: Array<{ id: string; title: string; reason: "加帖型" | "多股简报"; factor: number }>;
}

export interface RecallOptions {
  /** 滚动窗口小时数（默认 24；扩窗由调用方以 48/72 重跑） */
  windowHours?: number;
  /** 候选上限（默认 15） */
  limit?: number;
}

/** 加帖型标题（信息密度低的日更汇编，降权不剔除） */
const DIGEST_TITLE_RE = /(盘前|早报|简图|复盘|资讯精选|涨停解析)/;

/** 计分公式（实测"算力"窗原配方；末项 min(score_avg,5) 为实测原文口径，M1 校准项） */
const SCORE = { titleHit: 3, excerptHit: 1, stockTag: 2, eventLink: 1.5, selectedBonus: 1 };
/** 降权因子（实测仅给出方向，M1 默认待校准） */
const DEMOTE = { digest: 0.5, multiStockBrief: 0.3, multiStockTagThreshold: 5 };
/** 多股简报帖判定：路 A 命中 && 标签数 >5 && 与文本零交集 */
const MULTI_STOCK_TAGS = 5;

/** ASCII 可打印词（SQLite LIKE 大小写不敏感坑的规避对象）→ 程序内大小写敏感匹配 */
function isAsciiWord(w: string): boolean {
  return /^[\x21-\x7e]+$/.test(w);
}

function hit(word: string, text: string): boolean {
  return isAsciiWord(word) ? text.includes(word) : text.includes(word);
}

interface WindowRow {
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

/**
 * 执行三路召回。anchor = MAX(published_at)（不筛 status，代表库内语料全量），
 * 窗口 (anchor-hours, anchor] 左开右闭，published_at 为 24 位 ISO UTC TEXT 直接字符串比较。
 */
export function recall(
  db: Db,
  q: RecallQuery,
  opts: RecallOptions = {},
): { candidates: RecallCandidate[]; stats: RecallStats } {
  const hours = opts.windowHours ?? 24;
  const limit = opts.limit ?? 15;

  const anchorRow = db.prepare("SELECT MAX(published_at) AS a FROM items").get() as { a: string | null };
  const anchor = anchorRow.a ?? "";
  const perWord: Array<{ word: string; count: number }> = [];
  const stats: RecallStats = {
    window: { start: "", end: anchor, anchor, hours },
    perWord,
    unionCount: 0,
    routeCounts: { text: 0, stockTagOnly: 0, eventOnly: 0 },
    zeroHitWords: [],
    candidates: 0,
    demoted: [],
  };
  if (!anchor) return { candidates: [], stats };

  const start = new Date(Date.parse(anchor) - hours * 3600_000).toISOString();
  stats.window.start = start;

  const rows = db
    .prepare(
      `SELECT id, ext_id, url, title, excerpt, stocks_json, published_at, status, score_avg, event_id
       FROM items WHERE published_at > ? AND published_at <= ?`,
    )
    .all(start, anchor) as unknown as WindowRow[];

  // 词表去重（保序）
  const words = [...new Set([...q.identityWords, ...q.narrativeWords].map((w) => w.trim()).filter(Boolean))];
  const stockPool = [...new Set(q.stocks.map((s) => s.trim()).filter(Boolean))];

  // 路 C：events LLM 字段二次匹配 → 命中事件的 id 集（回链窗口内 items）
  const matchedEventIds = matchEvents(db, words);

  // 逐词命中统计（路 B 口径：title 或 excerpt）
  for (const w of words) {
    const count = rows.filter((r) => hit(w, r.title) || hit(w, r.excerpt)).length;
    perWord.push({ word: w, count });
    if (count === 0) stats.zeroHitWords.push(w);
  }

  const candidates: RecallCandidate[] = [];
  for (const r of rows) {
    let stocks: string[] = [];
    try {
      stocks = JSON.parse(r.stocks_json) as string[];
    } catch {
      stocks = [];
    }
    const titleHits = words.filter((w) => hit(w, r.title));
    const excerptHits = words.filter((w) => hit(w, r.excerpt));
    const routeB = titleHits.length > 0 || excerptHits.length > 0;
    // 路 A：股票标签精确相等（防"东方"→日出东方子串误报）
    const routeA = stockPool.length > 0 && stocks.some((s) => stockPool.includes(s));
    const routeC = r.event_id !== null && matchedEventIds.has(r.event_id);
    if (!routeA && !routeB && !routeC) continue;

    let score =
      titleHits.length * SCORE.titleHit +
      excerptHits.length * SCORE.excerptHit +
      (routeA ? SCORE.stockTag : 0) +
      (routeC ? SCORE.eventLink : 0) +
      (r.status === "selected" ? SCORE.selectedBonus : 0) +
      0.1 * Math.min(r.score_avg ?? 0, 5);

    // 加帖型降权（盘前/早报类标题常带词但信息密度低）
    if (DIGEST_TITLE_RE.test(r.title)) {
      score *= DEMOTE.digest;
      stats.demoted.push({ id: r.id, title: r.title, reason: "加帖型", factor: DEMOTE.digest });
    }
    // 多股简报帖防污染：路 A 独有 + 标签 >5 + 文本零交集（实测路 A 独有 4 条全是噪声）
    if (routeA && stocks.length > MULTI_STOCK_TAGS && !routeB && !routeC) {
      score *= DEMOTE.multiStockBrief;
      stats.demoted.push({ id: r.id, title: r.title, reason: "多股简报", factor: DEMOTE.multiStockBrief });
    }

    stats.unionCount++;
    if (routeB) stats.routeCounts.text++;
    else if (routeA) stats.routeCounts.stockTagOnly++;
    else stats.routeCounts.eventOnly++;

    candidates.push({
      id: r.id,
      extId: r.ext_id,
      url: r.url,
      title: r.title,
      excerpt: r.excerpt,
      stocks,
      publishedAt: r.published_at,
      status: r.status,
      scoreAvg: r.score_avg,
      eventId: r.event_id,
      hits: [...new Set([...titleHits, ...excerptHits])],
      routeA,
      routeB,
      routeC,
      score,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, limit);
  stats.candidates = top.length;
  // 降权明细只保留最终候选内的（其余已被排序自然淘汰）
  const topIds = new Set(top.map((c) => c.id));
  stats.demoted = stats.demoted.filter((d) => topIds.has(d.id));
  return { candidates: top, stats };
}

/** 路 C：events 表的 LLM 字段（title/summary/reason/tags/stocks）二次匹配 */
function matchEvents(db: Db, words: string[]): Set<string> {
  if (words.length === 0) return new Set();
  const events = db
    .prepare(
      `SELECT id, title, summary, reason, tags_json, stocks_json FROM events ORDER BY updated_at DESC LIMIT 500`,
    )
    .all() as Array<{
    id: string;
    title: string;
    summary: string | null;
    reason: string | null;
    tags_json: string;
    stocks_json: string;
  }>;
  const matched = new Set<string>();
  for (const e of events) {
    const text = [e.title, e.summary ?? "", e.reason ?? "", e.tags_json, e.stocks_json].join("\n");
    if (words.some((w) => hit(w, text))) matched.add(e.id);
  }
  return matched;
}

/** 关键词归一化（单飞锁键）：去空白 + 全角→半角 + 小写 */
export function normalizeKeyword(keyword: string): string {
  return keyword
    .replace(/\s+/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();
}
