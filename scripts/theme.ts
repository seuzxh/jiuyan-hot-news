/**
 * 题材阶段：把 24h 窗口内的事件按 taxonomy 聚成题材（热度合计 + Top5 概念股），
 * 事件数 ≥2 的题材由 LLM 写催化逻辑综述。
 * API 模式直调 GLM；handoff 模式生成 theme-*.json 任务，`npm run theme -- --consume` 回填。
 */
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  bjDateKey,
  buildThemes,
  defaultDbPath,
  defaultMigrationsDir,
  getThemesByDate,
  nowIso,
  openDb,
  rebuildThemesForDate,
  setThemeLogic,
  withRun,
  type ThemeEvent,
  type ThemeUpsert,
} from "@jyc/core";
import {
  buildPrompt,
  chat,
  completeTask,
  extractJson,
  listReadyTasks,
  loadPrompt,
  readResult,
  validateTheme,
  writeTask,
  type ThemeOutput,
  type ThemeTaskInput,
} from "@jyc/llm";
import { agentInstructions, chunk, hasGlmKey, handoffDirs, openPipelineDb, warnOutstanding } from "./lib.js";

const db = openPipelineDb();
const consume = new Set(process.argv.slice(2)).has("--consume");

interface EventRaw {
  id: string;
  title: string;
  summary: string | null;
  heat: number;
  stocks_json: string;
  tags_json: string;
  rep_tags: string | null;
  rep_score: number | null;
}

/** 24h 窗口内事件 + 代表帖评分/标签 */
function loadWindowEvents(sinceIso: string): ThemeEvent[] {
  const rows = db
    .prepare(
      `SELECT e.id, e.title, e.summary, e.heat, e.stocks_json, e.tags_json,
        (SELECT i.tags_json FROM event_members m JOIN items i ON i.id = m.item_id
          WHERE m.event_id = e.id ORDER BY m.role = 'representative' DESC, i.score_avg DESC LIMIT 1) AS rep_tags,
        (SELECT i.score_avg FROM event_members m2 JOIN items i ON i.id = m2.item_id
          WHERE m2.event_id = e.id ORDER BY m2.role = 'representative' DESC, i.score_avg DESC LIMIT 1) AS rep_score
       FROM events e WHERE e.last_item_at >= ?`,
    )
    .all(sinceIso) as unknown as EventRaw[];
  return rows.map((r) => {
    let repIndustry: string | null = null;
    let repDriver: string | null = null;
    if (r.rep_tags) {
      try {
        const t = JSON.parse(r.rep_tags) as { industry?: string; driver?: string };
        repIndustry = t.industry ?? null;
        repDriver = t.driver ?? null;
      } catch {
        /* 忽略 */
      }
    }
    return {
      id: r.id,
      title: r.title,
      summary: r.summary,
      heat: r.heat,
      repScore: r.rep_score,
      stocks: JSON.parse(r.stocks_json) as string[],
      tags: JSON.parse(r.tags_json) as string[],
      repIndustry,
      repDriver,
    };
  });
}

function toTaskInput(t: { id: string; category: { label: string }; eventIds: string[] }, byId: Map<string, ThemeEvent>): ThemeTaskInput {
  return {
    themeId: t.id,
    label: t.category.label,
    events: t.eventIds
      .map((id) => byId.get(id))
      .filter((e): e is ThemeEvent => !!e)
      .sort((a, b) => b.heat - a.heat)
      .slice(0, 6)
      .map((e) => ({
        title: e.title,
        summary: (e.summary ?? "").slice(0, 90),
        heat: Math.round(e.heat),
        stocks: e.stocks.slice(0, 3),
      })),
  };
}

if (consume) {
  const stats = await withRun(db, "theme-consume", async () => {
    const outstanding = listReadyTasks(handoffDirs).filter((t) => t.stage === "theme");
    let applied = 0;
    let consumed = 0;
    for (const t of outstanding) {
      const result = readResult<ThemeOutput>(handoffDirs, "theme", t.batch);
      const task = JSON.parse(readFileSync(t.file, "utf8")) as { input: ThemeTaskInput[] };
      const ids = new Set(task.input.map((x) => x.themeId));
      for (const o of validateTheme(result.outputs, ids)) {
        setThemeLogic(db, o.themeId, o.logic);
        applied++;
      }
      completeTask(handoffDirs, "theme", t.batch);
      consumed++;
    }
    warnOutstanding("theme");
    return { consumed, applied };
  });
  db.close();
  console.log(`[theme] 回填完成: 任务 ${stats.consumed} | 题材综述 ${stats.applied}`);
} else {
  const stats = await withRun(db, "theme", async () => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const events = loadWindowEvents(since);
    const dateKey = bjDateKey(nowIso());
    if (events.length === 0) return { themes: 0, events: 0, tasks: 0 };

    const byId = new Map(events.map((e) => [e.id, e]));
    const themes = buildThemes(dateKey, events);
    const upserts: ThemeUpsert[] = themes.map((t) => ({
      id: t.id,
      dateKey: t.dateKey,
      categoryId: t.category.id,
      categoryLabel: t.category.label,
      emoji: t.category.emoji,
      topStocksJson: JSON.stringify(t.topStocks.map((s) => ({ name: s.name, score: Math.round(s.score), mentions: s.mentions }))),
      eventIdsJson: JSON.stringify(t.eventIds),
      eventCount: t.eventCount,
      heatTotal: t.heatTotal,
    }));
    rebuildThemesForDate(db, dateKey, upserts);

    const needLogic = themes.filter((t) => t.needsLogic);
    if (needLogic.length === 0) return { themes: themes.length, events: events.length, tasks: 0 };

    const promptMd = loadPrompt("theme");
    if (hasGlmKey()) {
      const model = process.env.GLM_MODEL_WRITE;
      let written = 0;
      for (const batch of chunk(needLogic, 6)) {
        const inputs = batch.map((t) => toTaskInput(t, byId));
        const ids = new Set(inputs.map((x) => x.themeId));
        const outputs = validateTheme(extractJson(await chat(buildPrompt(promptMd, inputs), { model })), ids);
        for (const o of outputs) {
          setThemeLogic(db, o.themeId, o.logic);
          written++;
        }
      }
      return { themes: themes.length, events: events.length, tasks: 0, logic: written };
    }

    const batchName = new Date().toISOString().replace(/[-:]/g, "").slice(0, 14);
    let tasks = 0;
    for (const [i, batch] of chunk(needLogic, 6).entries()) {
      const batchId = `${batchName}_${String(i).padStart(2, "0")}`;
      const inputs = batch.map((t) => toTaskInput(t, byId));
      const outputFile = join(handoffDirs.resultsDir, `theme-${batchId}.json`);
      writeTask(handoffDirs, {
        version: 1,
        stage: "theme",
        batch: batchId,
        promptFile: "industry/prompts/theme.md",
        prompt: buildPrompt(promptMd, inputs),
        input: inputs,
        outputFile,
        agentInstructions: agentInstructions(outputFile, "theme"),
      });
      tasks++;
    }
    return { themes: themes.length, events: events.length, tasks };
  });
  db.close();
  if (stats.tasks > 0) {
    console.log(
      `[theme] 已建 ${stats.themes} 个题材（窗口事件 ${stats.events}），生成 ${stats.tasks} 个综述任务。agent 处理后运行: npm run theme -- --consume`,
    );
  } else {
    console.log(`[theme] 完成: ${stats.themes} 个题材（窗口事件 ${stats.events}）`);
  }
}
