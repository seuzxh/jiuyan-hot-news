/**
 * 概念阶段：把窗口内的事件交给 LLM 做概念级归类，写出"概念逻辑卡"
 * （结论 + 因果链 + 标的角色 + 风险 + 来源帖子）。汇总帖由 LLM 拆题归位，可同时属于多个概念。
 * API 模式直调 GLM；handoff 模式生成 concept-*.json 任务，`npm run concept -- --consume` 回填。
 * 用法：npm run concept [-- --date=YYYY-MM-DD]
 *   默认取最近 24h（归属今天）；指定日期则取该北京日全天（用于回填历史）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bjDateKey,
  defaultDbPath,
  defaultMigrationsDir,
  nowIso,
  openDb,
  planConcepts,
  replaceConceptsForDate,
  withRun,
  type ConceptEvent,
  type ConceptPlan,
} from "@jyc/core";
import {
  chat,
  completeTask,
  extractJson,
  listReadyTasks,
  loadPrompt,
  readResult,
  validateConcepts,
  writeTask,
  type ConceptOutput,
  type ConceptTaskInput,
  type LlmTask,
} from "@jyc/llm";
import { agentInstructions, hasGlmKey, handoffDirs, openPipelineDb, warnOutstanding } from "./lib.js";

const db = openPipelineDb();
const args = new Set(process.argv.slice(2));
const consume = args.has("--consume");
/** 单次归类的帖子上限（按热度取前 N，足够覆盖一个窗口的主线） */
const MAX_EVENTS = 40;
/** 每帖正文节选上限：汇总帖的要点常在第 1000 字之后，太短会漏催化；太长则每轮阅读成本过高 */
const MAX_TEXT = 1500;
const BJ_OFFSET_MS = 8 * 3600_000;

const dateArg = process.argv.find((a) => a.startsWith("--date="))?.slice(7);
if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  throw new Error(`--date 格式应为 YYYY-MM-DD: ${dateArg}`);
}

function bjStamp(iso: string): string {
  return new Date(Date.parse(iso) + BJ_OFFSET_MS).toISOString().slice(5, 16).replace("T", " ");
}

/** 归类窗口：默认最近 24h；指定日期 = 该北京日 00:00 ~ 次日 00:00（不超过当前） */
function windowOf(dateKey?: string): { since: string; until: string; dateKey: string } {
  if (!dateKey) {
    const now = nowIso();
    return { since: new Date(Date.parse(now) - 24 * 3600_000).toISOString(), until: now, dateKey: bjDateKey(now) };
  }
  const start = Date.parse(`${dateKey}T00:00:00+08:00`);
  const until = Math.min(start + 24 * 3600_000, Date.now());
  return { since: new Date(start).toISOString(), until: new Date(until).toISOString(), dateKey };
}

interface EventRaw {
  id: string;
  title: string;
  summary: string | null;
  heat: number;
  stocks_json: string;
  tags_json: string;
  last_item_at: string | null;
  rep_tags: string | null;
  rep_score: number | null;
  rep_tier: string | null;
  rep_content: string | null;
}

const REP_SUBQUERY = `(SELECT i.tags_json FROM event_members m JOIN items i ON i.id = m.item_id
  WHERE m.event_id = e.id ORDER BY m.role = 'representative' DESC, i.score_avg DESC LIMIT 1)`;
/** 正文节选来源：优先代表帖；代表帖无全文缓存时退而取任一有全文的成员帖 */
const CONTENT_SUBQUERY = `(SELECT d.content FROM event_members m JOIN items i ON i.id = m.item_id
  JOIN item_details d ON d.item_id = i.id AND d.fetch_error IS NULL
  WHERE m.event_id = e.id ORDER BY m.role = 'representative' DESC, i.score_avg DESC LIMIT 1)`;

function excerpt(s: string | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

function toEvent(r: EventRaw): ConceptEvent {
  let repIndustry: string | null = null;
  let repDriver: string | null = null;
  if (r.rep_tags) {
    try {
      const t = JSON.parse(r.rep_tags) as { industry?: string; driver?: string };
      repIndustry = t.industry ?? null;
      repDriver = t.driver ?? null;
    } catch {
      /* 忽略坏 tags */
    }
  }
  return {
    id: r.id,
    title: r.title,
    heat: r.heat,
    repScore: r.rep_score,
    stocks: JSON.parse(r.stocks_json) as string[],
    tags: JSON.parse(r.tags_json) as string[],
    repIndustry,
    repDriver,
  };
}

/** 窗口内事件 + 代表帖评分/作者层级/最新时间（先按热度取前 N，再按时间先后排列便于读叙事） */
function loadWindowEvents(since: string, until: string): ConceptTaskInput["events"] {
  const rows = db
    .prepare(
      `SELECT e.id, e.title, e.summary, e.heat, e.stocks_json, e.tags_json, e.last_item_at,
        ${REP_SUBQUERY} AS rep_tags,
        (SELECT i.score_avg FROM event_members m2 JOIN items i ON i.id = m2.item_id
          WHERE m2.event_id = e.id ORDER BY m2.role = 'representative' DESC, i.score_avg DESC LIMIT 1) AS rep_score,
        (SELECT i.author_tier FROM event_members m3 JOIN items i ON i.id = m3.item_id
          WHERE m3.event_id = e.id ORDER BY m3.role = 'representative' DESC, i.score_avg DESC LIMIT 1) AS rep_tier,
        ${CONTENT_SUBQUERY} AS rep_content
       FROM events e WHERE e.last_item_at >= ? AND e.last_item_at < ?
       ORDER BY e.heat DESC LIMIT ${MAX_EVENTS}`,
    )
    .all(since, until) as unknown as EventRaw[];
  return rows
    .sort((a, b) => (a.last_item_at ?? "").localeCompare(b.last_item_at ?? ""))
    .map((r) => ({
      id: r.id,
      title: r.title,
      summary: r.summary ?? "",
      stocks: JSON.parse(r.stocks_json) as string[],
      tags: JSON.parse(r.tags_json) as string[],
      heat: Math.round(r.heat),
      score: r.rep_score === null ? null : Math.round(r.rep_score),
      time: r.last_item_at ? bjStamp(r.last_item_at) : "",
      tier: r.rep_tier,
      text: excerpt(r.rep_content),
    }));
}

function loadEventsByIds(ids: string[]): ConceptEvent[] {
  if (ids.length === 0) return [];
  const ph = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT e.id, e.title, e.summary, e.heat, e.stocks_json, e.tags_json, e.last_item_at, ${REP_SUBQUERY} AS rep_tags,
        (SELECT i.score_avg FROM event_members m2 JOIN items i ON i.id = m2.item_id
          WHERE m2.event_id = e.id ORDER BY m2.role = 'representative' DESC, i.score_avg DESC LIMIT 1) AS rep_score
       FROM events e WHERE e.id IN (${ph})`,
    )
    .all(...ids) as unknown as EventRaw[];
  return rows.map(toEvent);
}

function buildConceptPrompt(promptMd: string, input: ConceptTaskInput, since: string, until: string): string {
  const lines = input.events.map((e, i) => `${i + 1}. ${JSON.stringify(e)}`).join("\n");
  return `${promptMd}\n\n===== 待归类帖子（北京日期 ${input.dateKey}，窗口 ${bjStamp(since)} ~ ${bjStamp(until)}，共 ${input.events.length} 条）=====\n${lines}\n`;
}

function toUpsert(p: ConceptPlan) {
  return {
    id: p.id,
    dateKey: p.dateKey,
    rank: p.rank,
    title: p.title,
    categoryId: p.category.id,
    categoryLabel: p.category.label,
    emoji: p.category.emoji,
    takeaway: p.takeaway,
    chainJson: JSON.stringify(p.chain),
    stocksJson: JSON.stringify(p.stocks),
    risk: p.risk,
    eventIdsJson: JSON.stringify(p.eventIds),
    eventCount: p.eventCount,
    heatTotal: p.heatTotal,
  };
}

if (consume) {
  const stats = await withRun(db, "concept-consume", async () => {
    const ready = listReadyTasks(handoffDirs).filter((t) => t.stage === "concept");
    let consumed = 0;
    const written: string[] = [];
    for (const t of ready) {
      const result = readResult<ConceptOutput>(handoffDirs, "concept", t.batch);
      const task = JSON.parse(readFileSync(t.file, "utf8")) as LlmTask<"concept", ConceptTaskInput>;
      const input = task.input[0];
      if (!input) throw new Error(`任务 ${t.batch} 缺少 input`);
      const drafts = validateConcepts(result.outputs, new Set(input.events.map((e) => e.id)));
      const plans = planConcepts(input.dateKey, drafts, loadEventsByIds(input.events.map((e) => e.id)));
      if (plans.length === 0) throw new Error(`任务 ${t.batch} 归一化后没有任何概念`);
      replaceConceptsForDate(db, input.dateKey, plans.map(toUpsert));
      completeTask(handoffDirs, "concept", t.batch);
      consumed++;
      written.push(`${input.dateKey}×${plans.length}`);
    }
    warnOutstanding("concept");
    return { consumed, written };
  });
  db.close();
  console.log(`[concept] 回填完成: 任务 ${stats.consumed} | 概念逻辑卡 ${stats.written.join("、") || "无"}`);
} else {
  const stats = await withRun(db, "concept", async () => {
    const { since, until, dateKey } = windowOf(dateArg);
    const events = loadWindowEvents(since, until);
    if (events.length === 0) return { events: 0, concepts: 0, tasks: 0, dateKey };

    const promptMd = loadPrompt("concept");
    const input: ConceptTaskInput = { dateKey, events };
    const prompt = buildConceptPrompt(promptMd, input, since, until);

    if (hasGlmKey()) {
      const model = process.env.GLM_MODEL_WRITE;
      const drafts = validateConcepts(extractJson(await chat(prompt, { model })), new Set(events.map((e) => e.id)));
      const plans = planConcepts(dateKey, drafts, loadEventsByIds(events.map((e) => e.id)));
      replaceConceptsForDate(db, dateKey, plans.map(toUpsert));
      return { events: events.length, concepts: plans.length, tasks: 0, dateKey };
    }

    const batch = new Date().toISOString().replace(/[-:]/g, "").slice(0, 14);
    const outputFile = join(handoffDirs.resultsDir, `concept-${batch}.json`);
    writeTask(handoffDirs, {
      version: 1,
      stage: "concept",
      batch,
      promptFile: "industry/prompts/concept.md",
      prompt,
      input: [input],
      outputFile,
      agentInstructions: agentInstructions(outputFile, "concept"),
      meta: { dateKey, since, until },
    });
    return { events: events.length, concepts: 0, tasks: 1, dateKey };
  });
  db.close();
  if (stats.tasks > 0) {
    console.log(
      `[concept] 窗口内 ${stats.events} 个事件（归属 ${stats.dateKey}），已生成 1 个概念归类任务。agent 分析处理后运行: npm run concept -- --consume`,
    );
  } else {
    console.log(`[concept] 窗口内无事件，未生成任务`);
  }
}
