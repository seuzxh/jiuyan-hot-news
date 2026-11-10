/**
 * 打分阶段：对 candidate 条目双次独立打分 + 结构化标注，过分级门槛者 → selected。
 * API 模式（设 GLM_API_KEY）：直调 GLM，两轮独立调用合并为 score1/score2。
 * handoff 模式：生成 data/llm-tasks/score-*.json，agent 产出结果后 `npm run score -- --consume` 回填。
 */
import {
  getItemsByStatus,
  parseMetrics,
  setStatus,
  withRun,
  type ItemRow,
} from "@jyc/core";
import {
  buildPrompt,
  chat,
  extractJson,
  listReadyTasks,
  loadPrompt,
  readResult,
  validateScoreDual,
  validateScorePass,
  writeTask,
  completeTask,
  type ScoreDualOutput,
  type ScoreItemInput,
} from "@jyc/llm";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { THRESHOLDS } from "../industry/selection.js";
import { agentInstructions, chunk, hasGlmKey, handoffDirs, openPipelineDb, warnOutstanding } from "./lib.js";

const db = openPipelineDb();
const args = new Set(process.argv.slice(2));
const consume = args.has("--consume");

function toInput(r: ItemRow): ScoreItemInput {
  return {
    id: r.id,
    title: r.title,
    excerpt: r.excerpt.slice(0, 300),
    stocks: JSON.parse(r.stocks_json) as string[],
    authorBadge: r.author_badge,
    authorTier: r.author_tier,
    publishedAt: r.published_at,
    like: r.like_count,
    reply: parseMetrics(r.metrics_json).reply,
    forward: parseMetrics(r.metrics_json).forward,
    boards: JSON.parse(r.boards_json) as string[],
  };
}

function apply(db2: typeof db, items: ItemRow[], outputs: ScoreDualOutput[]) {
  let selected = 0;
  let rejected = 0;
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const o of outputs) {
    const item = byId.get(o.id);
    if (!item) continue;
    const avg = Math.floor((o.score1 + o.score2) / 2);
    const tier = item.author_tier === "T1_5" ? "T1_5" : "T2";
    const thr = THRESHOLDS[tier];
    const status = avg >= thr ? "selected" : "rejected";
    setStatus(db2, o.id, status, `avg:${avg}/thr:${thr}`, {
      score1: o.score1,
      score2: o.score2,
      scoreAvg: avg,
      tagsJson: JSON.stringify({ industry: o.industry, concepts: o.concepts, driver: o.driver }),
    });
    if (status === "selected") selected++;
    else rejected++;
  }
  return { selected, rejected };
}

if (consume) {
  const stats = await withRun(db, "score-consume", async () => {
    const outstanding = listReadyTasks(handoffDirs).filter((t) => t.stage === "score");
    let selected = 0;
    let rejected = 0;
    let consumed = 0;
    for (const t of outstanding) {
      const result = readResult<ScoreDualOutput>(handoffDirs, "score", t.batch);
      const task = JSON.parse(readFileSync(t.file, "utf8")) as { input: ScoreItemInput[] };
      const ids = new Set(task.input.map((x) => x.id));
      const outputs = validateScoreDual(result.outputs, ids);
      const items = getItemsByStatus(db, "candidate", 500).filter((i) => ids.has(i.id));
      const applied = apply(db, items, outputs);
      selected += applied.selected;
      rejected += applied.rejected;
      completeTask(handoffDirs, "score", t.batch);
      consumed++;
    }
    warnOutstanding("score");
    return { consumed, selected, rejected };
  });
  db.close();
  console.log(`[score] 回填完成: 任务 ${stats.consumed} | 入选 ${stats.selected} | 落选 ${stats.rejected}`);
} else {
  const stats = await withRun(db, "score", async () => {
    const items = getItemsByStatus(db, "candidate", 500);
    if (items.length === 0) return { candidates: 0, selected: 0, rejected: 0, tasks: 0 };

    const promptMd = loadPrompt("score");
    const batches = chunk(items.map(toInput), 10);

    if (hasGlmKey()) {
      const model = process.env.GLM_MODEL_SCORE;
      /** API 模式：每轮取响应中的 score1 作为该轮得分（提示词要求双分输出，两轮调用即两次独立判断） */
      const onePass = async (p: string, ids: Set<string>) => {
        const raw = extractJson<Array<Record<string, unknown>>>(await chat(p, { model }));
        return validateScorePass(
          raw.map((e) => ({ ...e, score: e.score1 })),
          ids,
        );
      };
      let selected = 0;
      let rejected = 0;
      for (const batch of batches) {
        const p = buildPrompt(promptMd, batch);
        const ids = new Set(batch.map((x) => x.id));
        const passA = await onePass(p, ids);
        const passB = await onePass(p, ids);
        const byA = new Map(passA.map((x) => [x.id, x]));
        const merged: ScoreDualOutput[] = passB.map((b) => {
          const a = byA.get(b.id);
          return {
            id: b.id,
            score1: a?.score ?? b.score,
            score2: b.score,
            industry: a?.industry ?? b.industry,
            concepts: a?.concepts ?? b.concepts,
            driver: a?.driver ?? b.driver,
          };
        });
        const applied = apply(db, items, validateScoreDual(merged, ids));
        selected += applied.selected;
        rejected += applied.rejected;
      }
      return { candidates: items.length, selected, rejected, tasks: 0 };
    }

    // handoff 模式：落盘任务
    const batchName = new Date().toISOString().replace(/[-:]/g, "").slice(0, 14);
    let tasks = 0;
    for (const [i, batch] of batches.entries()) {
      const batchId = `${batchName}_${String(i).padStart(2, "0")}`;
      const outputFile = join(handoffDirs.resultsDir, `score-${batchId}.json`);
      writeTask(handoffDirs, {
        version: 1,
        stage: "score",
        batch: batchId,
        promptFile: "industry/prompts/score.md",
        prompt: buildPrompt(promptMd, batch),
        input: batch,
        outputFile,
        agentInstructions: agentInstructions(outputFile, "score"),
      });
      tasks++;
    }
    return { candidates: items.length, selected: 0, rejected: 0, tasks };
  });
  db.close();
  if (stats.tasks > 0) {
    console.log(
      `[score] 已生成 ${stats.tasks} 个 handoff 任务（候选 ${stats.candidates} 条）。` +
        `请让 agent 处理 data/llm-tasks/score-*.json 并写出结果，然后运行: npm run score -- --consume`,
    );
  } else {
    console.log(`[score] 完成: 候选 ${stats.candidates} | 入选 ${stats.selected} | 落选 ${stats.rejected}`);
  }
}
