/**
 * 关键词问答（问股）四段编排：①意图分析 → ②实时爬取(防抖)+三路召回 → ③关联过滤与汇聚(R1/R2) → ④结论。
 * 与 scripts/ask.ts（CLI）及未来 /api/ask（SSE）共用同一编排函数。
 * 设计依据 docs/关键词问答技术方案.md §一、§3.4。
 */
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  bjDateKey,
  CATEGORIES,
  nowIso,
  optEnv,
  type Db,
} from "@jyc/core";
import {
  chat,
  defaultHandoffDirs,
  extractJson,
  GlmKeyMissingError,
  listReadyTasks,
  loadPrompt,
  readResult,
  completeTask,
  writeTask,
  validateAskAggregate,
  validateAskIntent,
  type AskAggregateInput,
  type AskAggregateOutput,
  type AskIntentInput,
  type AskIntentOutput,
  type LlmTask,
} from "@jyc/llm";
import { crawlAll, fetchDetail, sleep, type CrawlAllResult } from "@jyc/sources";
import { normalizeKeyword, recall, type RecallCandidate, type RecallStats } from "./recall.js";

export type AskPhase = "intent" | "crawl" | "recall" | "aggregate" | "detail" | "answer";

export interface AskProgress {
  phase: AskPhase;
  message: string;
}

export interface AskRunOptions {
  db: Db;
  root: string;
  keyword: string;
  onProgress?: (p: AskProgress) => void;
  /** 候选上限（默认 15） */
  candidateLimit?: number;
  /** 跳过实时爬取（库内现存量直接召回） */
  skipCrawl?: boolean;
}

export interface AskRunResult {
  askId: number;
  keyword: string;
  status: "done" | "empty" | "awaiting_handoff" | "failed";
  kind?: string;
  intent?: AskIntentOutput;
  recallStats?: RecallStats;
  /** 扩窗说明（24h 无命中时为最终窗口小时数） */
  widenedToHours?: number;
  candidates?: RecallCandidate[];
  result?: AskAggregateOutput;
  detailIds?: string[];
  handoffTasks?: string[];
  error?: string;
}

/** R2 全文输入截断上限（保护上下文） */
const R2_TEXT_MAX = 4000;
/** 深挖名单上限（Top 3-5） */
const DETAIL_MAX = 5;
/** 详情页逐帖抓取间隔（礼貌抓取） */
const DETAIL_INTERVAL_MS = 2000;

// ---------------------------------------------------------------------------
// ask_results 行操作
// ---------------------------------------------------------------------------

type AskRowFields = Partial<{
  kind: string;
  status: string;
  phase: string;
  window_start: string;
  window_end: string;
  crawl_stats_json: string;
  intent_json: string;
  recall_json: string;
  detail_ids_json: string;
  result_json: string;
  error: string;
  finished_at: string;
}>;

function insertAskRow(db: Db, keyword: string): number {
  const r = db
    .prepare(
      "INSERT INTO ask_results (keyword, keyword_norm, status, phase, window_start, window_end, created_at) VALUES (?, ?, 'running', 'intent', '', '', ?)",
    )
    .run(keyword, normalizeKeyword(keyword), nowIso());
  return Number(r.lastInsertRowid);
}

function updateAskRow(db: Db, id: number, fields: AskRowFields): void {
  const sets = Object.keys(fields).map((k) => `${k} = ?`);
  db.prepare(`UPDATE ask_results SET ${sets.join(", ")} WHERE id = ?`).run(
    ...Object.values(fields),
    id,
  );
}

export interface AskResultRow {
  id: number;
  keyword: string;
  kind: string | null;
  status: string;
  phase: string;
  window_start: string;
  window_end: string;
  intent_json: string | null;
  recall_json: string | null;
  detail_ids_json: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export function getAskResultRow(db: Db, askId: number): AskResultRow | undefined {
  return db.prepare("SELECT * FROM ask_results WHERE id = ?").get(askId) as AskResultRow | undefined;
}

/** running 行超时回收（默认 30 分钟；awaiting_handoff 等人工回填，不回收） */
export function reclaimStaleAskRows(db: Db): number {
  const staleMs = Number(optEnv("ASK_STALE_MS") ?? 1_800_000);
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  const r = db
    .prepare(
      "UPDATE ask_results SET status = 'failed', error = 'stale: 超时回收', finished_at = ? WHERE status = 'running' AND created_at < ?",
    )
    .run(nowIso(), cutoff);
  return Number(r.changes);
}

// ---------------------------------------------------------------------------
// 爬取防抖 + 全局互斥（§3.4）
// ---------------------------------------------------------------------------

let crawlInFlight: Promise<CrawlAllResult> | null = null;

interface CrawlOutcome {
  skipped: boolean;
  lastCrawlAt?: string;
  stats?: CrawlAllResult;
  error?: string;
}

async function crawlFresh(db: Db, root: string): Promise<CrawlOutcome> {
  const debounceMs = Number(optEnv("ASK_CRAWL_DEBOUNCE_MS") ?? 900_000);
  const row = db
    .prepare("SELECT last_crawl_at FROM sources WHERE id = 'jiuyangongshe'")
    .get() as { last_crawl_at: string | null } | undefined;
  if (row?.last_crawl_at && Date.now() - Date.parse(row.last_crawl_at) < debounceMs) {
    return { skipped: true, lastCrawlAt: row.last_crawl_at };
  }
  // 全局互斥：并发 ask 共享同一轮 in-flight 爬取
  if (!crawlInFlight) {
    crawlInFlight = crawlAll(db, root, { sourceId: "jiuyangongshe" }).finally(() => {
      crawlInFlight = null;
    });
  }
  try {
    return { skipped: false, stats: await crawlInFlight };
  } catch (e) {
    // 全失败降级：用库内现存量继续（§一 段②a）
    return { skipped: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// 段① 输入装配：themes 背景 + taxonomy 概念词
// ---------------------------------------------------------------------------

function themesContext(db: Db, anchor: string): Array<{ label: string; logic: string }> {
  if (!anchor) return [];
  const start = new Date(Date.parse(anchor) - 24 * 3600_000).toISOString();
  // 窗口覆盖的北京日期集合（通常 2 天；themes 以北京日为主键）
  const dates = [...new Set([bjDateKey(start), bjDateKey(anchor)])];
  const ph = dates.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT category_label AS label, logic FROM themes
       WHERE date_key IN (${ph}) AND logic IS NOT NULL AND logic != ''
       ORDER BY heat_total DESC LIMIT 8`,
    )
    .all(...dates) as Array<{ label: string; logic: string }>;
}

/** taxonomy 概念词兜底：关键词命中某类目 conceptKeywords（双向包含）则注入该类目词表 */
export function taxonomyHints(keyword: string): string[] {
  const out: string[] = [];
  for (const cat of CATEGORIES) {
    const matched = cat.conceptKeywords.some(
      (k) => k === keyword || keyword.includes(k) || k.includes(keyword),
    );
    if (matched) out.push(...cat.conceptKeywords);
    if (out.length >= 20) break;
  }
  return [...new Set(out)].slice(0, 20);
}

// ---------------------------------------------------------------------------
// 段③ prompt 装配（R1/R2 共用一份 ask-aggregate.md，轮次在意图区块注明）
// ---------------------------------------------------------------------------

interface AggregateContext {
  keyword: string;
  intent: string;
  assumption: string;
  round: "R1" | "R2";
  /** 路 C 注入：命中事件摘要（催化背景） */
  events: Array<{ title: string; summary: string }>;
  /** 路 C 注入：窗口题材综述（top_stocks 的 score/mentions 是事件级语义，仅作背景） */
  themes: Array<{ label: string; logic: string }>;
}

function buildAggregatePrompt(promptMd: string, ctx: AggregateContext, inputs: AskAggregateInput[]): string {
  const lines = inputs.map((x, i) => `${i + 1}. ${JSON.stringify(x)}`).join("\n");
  return [
    promptMd,
    `\n===== 查询意图与背景 =====`,
    JSON.stringify(ctx, null, 0),
    `\n===== 待处理候选（共 ${inputs.length} 条；text 字段：R1=列表页摘要约250字，R2=详情页全文）=====`,
    lines,
    "",
  ].join("\n");
}

function agentInstructions(outputFile: string, round: "R1" | "R2"): string {
  return [
    `你是「关键词问股」管线 ask-aggregate 阶段（${round} 轮）的执行者。请：`,
    `1. 阅读本文件中的 prompt（含查询意图背景与候选帖）`,
    `2. 严格按 prompt 中的输出格式，产出恰好 1 个结果对象`,
    `3. 将结果写入文件 ${outputFile}，格式：{"version":1,"stage":"ask-aggregate","batch":"<本任务的batch>","outputs":[<那1个对象>]}`,
    `4. outputs 必须是只含 1 个对象的 JSON 数组；sourceIds/rejected 的 id 必须原样使用输入候选的 id 字段`,
    `5. 写完后用 JSON 解析自检一遍，确保是合法 JSON`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 段③.5 详情页全文（item_details 缓存：成功失败都留行防重抓）
// ---------------------------------------------------------------------------

function extIdOf(id: string, url: string): string {
  const fromUrl = url.split("/a/")[1];
  if (fromUrl) return fromUrl;
  return id.slice(id.indexOf(":") + 1);
}

async function fetchDetails(
  db: Db,
  wanted: string[],
  candidates: RecallCandidate[],
): Promise<{ contents: Map<string, string>; fetched: number; failed: number; errors: string[] }> {
  const contents = new Map<string, string>();
  let fetched = 0;
  let failed = 0;
  const errors: string[] = [];
  const byId = new Map(candidates.map((c) => [c.id, c]));
  let first = true;
  for (const id of wanted) {
    const cached = db
      .prepare("SELECT content, fetch_error FROM item_details WHERE item_id = ?")
      .get(id) as { content: string; fetch_error: string | null } | undefined;
    if (cached) {
      if (!cached.fetch_error && cached.content.length > 0) contents.set(id, cached.content);
      continue; // 失败行也跳过（防反复重抓）
    }
    const c = byId.get(id);
    if (!c) continue;
    if (!first) await sleep(DETAIL_INTERVAL_MS);
    first = false;
    try {
      const d = await fetchDetail(extIdOf(c.id, c.url), { maxRetries: 2 });
      db.prepare("INSERT INTO item_details (item_id, content, fetched_at) VALUES (?, ?, ?)").run(
        id,
        d.content,
        nowIso(),
      );
      contents.set(id, d.content);
      fetched++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      db.prepare(
        "INSERT INTO item_details (item_id, content, fetched_at, fetch_error) VALUES (?, '', ?, ?)",
      ).run(id, nowIso(), msg);
      failed++;
      errors.push(`${c.title}: ${msg}`);
    }
  }
  return { contents, fetched, failed, errors };
}

// ---------------------------------------------------------------------------
// 候选 → LLM 输入
// ---------------------------------------------------------------------------

function toAggregateInputs(
  candidates: RecallCandidate[],
  eventTitles: Map<string, string>,
  fullTexts?: Map<string, string>,
): AskAggregateInput[] {
  return candidates.map((c) => {
    const full = fullTexts?.get(c.id);
    const text =
      full !== undefined
        ? full.length > R2_TEXT_MAX
          ? `${full.slice(0, R2_TEXT_MAX)}…（全文截断）`
          : full
        : c.excerpt;
    return {
      id: c.id,
      title: c.title,
      text,
      stocks: c.stocks,
      url: c.url,
      publishedAt: c.publishedAt,
      status: c.status,
      scoreAvg: c.scoreAvg,
      eventTitle: c.eventId ? (eventTitles.get(c.eventId) ?? undefined) : undefined,
    };
  });
}

function eventTitleMap(db: Db, candidates: RecallCandidate[]): Map<string, string> {
  const ids = [...new Set(candidates.map((c) => c.eventId).filter((e): e is string => e !== null))];
  const map = new Map<string, string>();
  for (const id of ids) {
    const row = db.prepare("SELECT title FROM events WHERE id = ?").get(id) as { title: string } | undefined;
    if (row) map.set(id, row.title);
  }
  return map;
}

// ---------------------------------------------------------------------------
// LLM 调用（API / handoff 双模式）
// ---------------------------------------------------------------------------

async function runIntent(
  db: Db,
  root: string,
  keyword: string,
  anchor: string,
): Promise<{ intent: AskIntentOutput; degraded: boolean }> {
  const input: AskIntentInput = {
    keyword,
    themesContext: themesContext(db, anchor),
    taxonomyHints: taxonomyHints(keyword),
  };
  const hints = input.taxonomyHints;
  const degraded: AskIntentOutput = {
    keyword,
    kind: "模糊",
    intent: `关键词直查：${keyword}`,
    assumption: "关键词直查模式（未配置 GLM）：仅用关键词与 taxonomy 命中词检索，未做意图扩展",
    expandedKeywords: { identity: [...new Set([keyword, ...hints])], narrative: [] },
    stocks: [],
  };
  try {
    const prompt = loadPrompt("ask-intent", root);
    const model = optEnv("GLM_MODEL_ASK_INTENT");
    const lines = `1. ${JSON.stringify(input)}`;
    const raw = extractJson<unknown>(
      await chat(`${prompt}\n\n===== 待处理条目（共 1 条）=====\n${lines}\n`, { model }),
    );
    return { intent: validateAskIntent(raw, keyword), degraded: false };
  } catch (e) {
    if (e instanceof GlmKeyMissingError) return { intent: degraded, degraded: true };
    // API 瞬时失败 → 直查模式兜底，不阻塞链路
    console.warn(`[ask] 意图分析失败，降级为关键词直查: ${e instanceof Error ? e.message : String(e)}`);
    return { intent: degraded, degraded: true };
  }
}

interface AggregateOutcome {
  result: AskAggregateOutput;
  handoff: false;
} interface AggregateHandoff {
  handoff: true;
  taskFile: string;
}

async function runAggregate(
  root: string,
  ctx: AggregateContext,
  inputs: AskAggregateInput[],
  round: "R1" | "R2",
  askId: number,
  batchBase: string,
): Promise<AggregateOutcome | AggregateHandoff> {
  const promptMd = loadPrompt("ask-aggregate", root);
  const prompt = buildAggregatePrompt(promptMd, ctx, inputs);
  const batch = `${batchBase}_${round.toLowerCase()}`;
  const expectedIds = new Set(inputs.map((i) => i.id));

  try {
    const model = optEnv("GLM_MODEL_ASK_AGG");
    const raw = extractJson<unknown>(await chat(prompt, { model }));
    return { result: validateAskAggregate(raw, expectedIds), handoff: false };
  } catch (e) {
    if (!(e instanceof GlmKeyMissingError)) {
      console.warn(
        `[ask] 汇聚分析 ${round} API 失败，转 handoff: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const dirs = defaultHandoffDirs(root);
    const outputFile = join(dirs.resultsDir, `ask-aggregate-${batch}.json`);
    const task: LlmTask<"ask-aggregate", AskAggregateInput> = {
      version: 1,
      stage: "ask-aggregate",
      batch,
      promptFile: "industry/prompts/ask-aggregate.md",
      prompt,
      input: inputs,
      outputFile,
      agentInstructions: agentInstructions(outputFile, round),
      meta: { askId, round },
    };
    const file = writeTask(dirs, task);
    return { handoff: true, taskFile: file };
  }
}

// ---------------------------------------------------------------------------
// 主编排
// ---------------------------------------------------------------------------

/** 查询单飞锁（同 keyword_norm 合并等待；模块级 Map，web 单进程内有效） */
const inFlight = new Map<string, Promise<AskRunResult>>();

export async function askSingle(options: AskRunOptions): Promise<AskRunResult> {
  const key = normalizeKeyword(options.keyword);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = runAsk(options).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

export async function runAsk(options: AskRunOptions): Promise<AskRunResult> {
  const { db, root, keyword, onProgress } = options;
  const limit = options.candidateLimit ?? 15;
  reclaimStaleAskRows(db);
  const askId = insertAskRow(db, keyword);
  const base: AskRunResult = { askId, keyword, status: "failed" };
  const progress = (phase: AskPhase, message: string) => {
    updateAskRow(db, askId, { phase });
    onProgress?.({ phase, message });
  };

  try {
    // ---- 段① 意图分析 ----
    progress("intent", "理解查询意图…");
    const preAnchor = (
      db.prepare("SELECT MAX(published_at) AS a FROM items").get() as { a: string | null }
    ).a;
    const { intent } = await runIntent(db, root, keyword, preAnchor ?? "");
    updateAskRow(db, askId, {
      kind: intent.kind,
      intent_json: JSON.stringify(intent),
    });

    // ---- 段②a 实时爬取（防抖跳过 / 全局互斥 / 失败降级） ----
    progress("crawl", "检查语料新鲜度…");
    let crawlStats: Record<string, unknown> = {};
    if (options.skipCrawl) {
      crawlStats = { skipped: "manual" };
    } else {
      const outcome = await crawlFresh(db, root);
      if (outcome.skipped) {
        crawlStats = { skipped: "debounce", lastCrawlAt: outcome.lastCrawlAt };
      } else if (outcome.error) {
        crawlStats = { error: outcome.error };
      } else {
        crawlStats = { fetched: outcome.stats?.fetched ?? 0, inserted: outcome.stats?.inserted ?? 0 };
      }
    }
    updateAskRow(db, askId, { crawl_stats_json: JSON.stringify(crawlStats) });

    // ---- 段②b 三路召回（24h → 空则扩窗 48h → 72h；低命中不扩） ----
    progress("recall", "三路召回中…");
    const q = {
      identityWords: intent.expandedKeywords.identity,
      narrativeWords: intent.expandedKeywords.narrative,
      stocks: intent.stocks,
    };
    let widenedToHours: number | undefined;
    let recalled = recall(db, q, { windowHours: 24, limit });
    if (recalled.stats.unionCount === 0) {
      for (const hours of [48, 72]) {
        recalled = recall(db, q, { windowHours: hours, limit });
        widenedToHours = hours;
        if (recalled.stats.unionCount > 0) break;
      }
    }
    const { candidates, stats } = recalled;
    updateAskRow(db, askId, {
      window_start: stats.window.start,
      window_end: stats.window.end,
      recall_json: JSON.stringify({ ...stats, widenedToHours: widenedToHours ?? null }),
    });
    if (candidates.length === 0) {
      updateAskRow(db, askId, {
        status: "empty",
        phase: "recall",
        finished_at: nowIso(),
      });
      return { ...base, status: "empty", intent, recallStats: stats, widenedToHours };
    }

    // ---- 段③ R1：excerpt 级关联过滤与汇聚 ----
    progress("aggregate", `关联过滤与汇聚分析（R1，${candidates.length} 条候选）…`);
    const eventTitles = eventTitleMap(db, candidates);
    const matchedEvents = [...new Set(candidates.filter((c) => c.routeC).map((c) => c.eventId))]
      .filter((e): e is string => e !== null)
      .slice(0, 5)
      .map((id) => {
        const row = db.prepare("SELECT title, summary FROM events WHERE id = ?").get(id) as {
          title: string;
          summary: string | null;
        };
        return { title: row.title, summary: row.summary ?? "" };
      });
    const ctx: AggregateContext = {
      keyword,
      intent: intent.intent,
      assumption: intent.assumption,
      round: "R1",
      events: matchedEvents,
      themes: themesContext(db, stats.window.end),
    };
    const batchBase = `${nowIso().replace(/[-:]/g, "").slice(0, 14)}_${askId}`;
    const r1Inputs = toAggregateInputs(candidates, eventTitles);
    const r1 = await runAggregate(root, ctx, r1Inputs, "R1", askId, batchBase);
    if (r1.handoff) {
      updateAskRow(db, askId, {
        status: "awaiting_handoff",
        phase: "aggregate",
        detail_ids_json: JSON.stringify([]),
      });
      return {
        ...base,
        status: "awaiting_handoff",
        intent,
        recallStats: stats,
        candidates,
        handoffTasks: [r1.taskFile],
      };
    }

    // ---- 段③.5 + R2：深挖全文后重跑（名单空则 R1 即终稿） ----
    let final = r1.result;
    let detailIds = [...new Set(r1.result.detailIds ?? [])].slice(0, DETAIL_MAX);
    if (detailIds.length > 0) {
      progress("detail", `深挖 ${detailIds.length} 帖抓全文…`);
      const det = await fetchDetails(db, detailIds, candidates);
      detailIds = detailIds.filter((id) => det.contents.has(id));
      updateAskRow(db, askId, { detail_ids_json: JSON.stringify(detailIds) });
      if (det.contents.size > 0) {
        progress("answer", "综合结论（R2 全文级）…");
        const r2ctx: AggregateContext = { ...ctx, round: "R2" };
        const r2Inputs = toAggregateInputs(candidates, eventTitles, det.contents);
        const r2 = await runAggregate(root, r2ctx, r2Inputs, "R2", askId, batchBase);
        if (r2.handoff) {
          // R1 结果先落库，R2 等 handoff 回填（consume 续跑）
          updateAskRow(db, askId, {
            status: "awaiting_handoff",
            phase: "answer",
            result_json: JSON.stringify(final),
          });
          return {
            ...base,
            status: "awaiting_handoff",
            intent,
            recallStats: stats,
            candidates,
            result: final,
            detailIds,
            handoffTasks: [r2.taskFile],
          };
        }
        final = r2.result;
        if (det.failed > 0) {
          final = { ...final, gaps: [...final.gaps, `${det.failed} 帖全文抓取失败（已用摘要）：${det.errors.join("；")}`] };
        }
      }
    } else {
      updateAskRow(db, askId, { detail_ids_json: JSON.stringify([]) });
    }

    updateAskRow(db, askId, {
      status: "done",
      phase: "answer",
      result_json: JSON.stringify(final),
      finished_at: nowIso(),
    });
    return {
      ...base,
      status: "done",
      kind: intent.kind,
      intent,
      recallStats: stats,
      candidates,
      result: final,
      detailIds,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateAskRow(db, askId, { status: "failed", error: msg, finished_at: nowIso() });
    return { ...base, status: "failed", error: msg };
  }
}

// ---------------------------------------------------------------------------
// handoff consume：ask-aggregate r1/r2 回填续跑（npm run ask -- --consume）
// ---------------------------------------------------------------------------

export interface ConsumeSummary {
  askId: number;
  keyword: string;
  status: string;
  taskBatch: string;
}

export async function consumeAsk(db: Db, root: string): Promise<ConsumeSummary[]> {
  const dirs = defaultHandoffDirs(root);
  const ready = listReadyTasks(dirs).filter((t) => t.stage === "ask-aggregate");
  const out: ConsumeSummary[] = [];
  for (const t of ready) {
    const task = JSON.parse(readFileSync(t.file, "utf8")) as {
      input: AskAggregateInput[];
      meta?: { askId?: number; round?: string };
    };
    const askId = task.meta?.askId;
    const round = task.meta?.round === "R2" ? "R2" : "R1";
    const result = readResult<AskAggregateOutput>(dirs, "ask-aggregate", t.batch);
    const validated = validateAskAggregate(result.outputs, new Set(task.input.map((i) => i.id)));
    const row = askId !== undefined ? getAskResultRow(db, askId) : undefined;
    if (askId === undefined) {
      console.warn(`[ask] 任务 ${t.batch} 缺少 meta.askId（旧协议任务？），仅销账不落库`);
      completeTask(dirs, "ask-aggregate", t.batch);
      continue;
    }

    if (round === "R1" && row && row.status === "awaiting_handoff") {
      const detailIds = [...new Set(validated.detailIds ?? [])].slice(0, DETAIL_MAX);
      let r2Written = false;
      if (detailIds.length > 0) {
        const pseudoCandidates = task.input.map((i) => ({
          id: i.id,
          extId: extIdOf(i.id, i.url),
          url: i.url,
          title: i.title,
          excerpt: i.text,
          stocks: i.stocks,
          publishedAt: i.publishedAt,
          status: i.status,
          scoreAvg: i.scoreAvg,
          eventId: null,
          hits: [],
          routeA: false,
          routeB: false,
          routeC: false,
          score: 0,
        })) as RecallCandidate[];
        const det = await fetchDetails(db, detailIds, pseudoCandidates);
        if (det.contents.size > 0) {
          // 写 R2 任务，行继续 awaiting_handoff（phase=answer）
          const ctx: AggregateContext = {
            keyword: row.keyword,
            intent: "（见 R1 任务 prompt 的查询意图背景）",
            assumption: "",
            round: "R2",
            events: [],
            themes: [],
          };
          const r2 = await runAggregate(
            root,
            ctx,
            toAggregateInputs(pseudoCandidates, new Map(), det.contents),
            "R2",
            askId,
            t.batch.replace(/_r1$/, ""),
          );
          if (r2.handoff) {
            updateAskRow(db, askId, {
              phase: "answer",
              status: "awaiting_handoff",
              result_json: JSON.stringify(validated),
              detail_ids_json: JSON.stringify(detailIds),
            });
            out.push({ askId, keyword: row.keyword, status: "awaiting_handoff_r2", taskBatch: t.batch });
            r2Written = true;
          } else {
            finalizeAsk(db, askId, r2.result);
            out.push({ askId, keyword: row.keyword, status: "done", taskBatch: t.batch });
            r2Written = true;
          }
        }
      }
      if (!r2Written) {
        finalizeAsk(db, askId, validated);
        out.push({ askId, keyword: row.keyword, status: "done", taskBatch: t.batch });
      }
    } else if (round === "R2" && row && row.status === "awaiting_handoff") {
      finalizeAsk(db, askId, validated);
      out.push({ askId, keyword: row.keyword, status: "done", taskBatch: t.batch });
    } else {
      // 行已不存在/已被回收/stale：任务完成但不落库（结果文件留审计）
      console.warn(`[ask] 任务 ${t.batch} 对应 ask 行不可续跑（status=${row?.status ?? "缺失"}），仅销账`);
    }
    completeTask(dirs, "ask-aggregate", t.batch);
  }
  return out;
}

function finalizeAsk(db: Db, askId: number, result: AskAggregateOutput): void {
  updateAskRow(db, askId, {
    status: "done",
    phase: "answer",
    result_json: JSON.stringify(result),
    finished_at: nowIso(),
  });
}
