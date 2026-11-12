/**
 * 写作阶段：为每个事件生成"答案先行"摘要 + 推荐理由 + 事件标题。
 * API 模式直调 GLM；handoff 模式生成 write-*.json 任务，`npm run write -- --consume` 回填。
 */
import { getDetailMap, getEventsNeedingSummary, getEventsWithMembers, updateEventContent, withRun } from "@jyc/core";
import {
  buildPrompt,
  chat,
  completeTask,
  extractJson,
  listReadyTasks,
  loadPrompt,
  readResult,
  validateWrite,
  writeTask,
  type WriteEventInput,
  type WriteEventOutput,
} from "@jyc/llm";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { agentInstructions, chunk, hasGlmKey, handoffDirs, openPipelineDb, stocksOf, warnOutstanding } from "./lib.js";

const db = openPipelineDb();
const consume = new Set(process.argv.slice(2)).has("--consume");

function toInput(e: ReturnType<typeof getEventsWithMembers>[number], details: Map<string, string>): WriteEventInput {
  const rep = e.representative;
  const fullText = rep ? details.get(rep.id) : undefined;
  return {
    eventId: e.id,
    representative: {
      title: rep?.title ?? e.title,
      // 优先用详情页全文（detail 阶段缓存），无缓存回退列表页摘要
      excerpt: fullText ? fullText.slice(0, 1200) : (rep?.excerpt ?? "").slice(0, 300),
      authorName: rep?.author_name ?? "",
      stocks: rep ? stocksOf(rep).slice(0, 5) : [],
    },
    members: e.members
      .filter((m) => m.id !== rep?.id)
      .slice(0, 5)
      .map((m) => ({ title: m.title.slice(0, 60), excerpt: (details.get(m.id) ?? m.excerpt).slice(0, 160) })),
  };
}

function apply(outputs: WriteEventOutput[]): number {
  let applied = 0;
  for (const o of outputs) {
    updateEventContent(db, o.eventId, { title: o.eventTitle, summary: o.summary, reason: o.reason });
    applied++;
  }
  return applied;
}

if (consume) {
  const stats = await withRun(db, "write-consume", async () => {
    const outstanding = listReadyTasks(handoffDirs).filter((t) => t.stage === "write");
    let applied = 0;
    let consumed = 0;
    for (const t of outstanding) {
      const result = readResult<WriteEventOutput>(handoffDirs, "write", t.batch);
      const task = JSON.parse(readFileSync(t.file, "utf8")) as { input: WriteEventInput[] };
      const ids = new Set(task.input.map((x) => x.eventId));
      applied += apply(validateWrite(result.outputs, ids));
      completeTask(handoffDirs, "write", t.batch);
      consumed++;
    }
    warnOutstanding("write");
    return { consumed, applied };
  });
  db.close();
  console.log(`[write] 回填完成: 任务 ${stats.consumed} | 事件 ${stats.applied}`);
} else {
  const stats = await withRun(db, "write", async () => {
    const events = getEventsNeedingSummary(db, 100);
    if (events.length === 0) return { events: 0, tasks: 0, written: 0 };
    const withMembers = getEventsWithMembers(db, events.map((e) => e.id));
    const memberIds = withMembers.flatMap((e) => e.members.map((m) => m.id));
    const details = getDetailMap(db, memberIds);
    const inputs = withMembers.map((e) => toInput(e, details));
    const promptMd = loadPrompt("write");

    if (hasGlmKey()) {
      const model = process.env.GLM_MODEL_WRITE;
      let written = 0;
      for (const batch of chunk(inputs, 6)) {
        const ids = new Set(batch.map((x) => x.eventId));
        const outputs = validateWrite(
          extractJson(await chat(buildPrompt(promptMd, batch), { model })),
          ids,
        );
        written += apply(outputs);
      }
      return { events: events.length, tasks: 0, written };
    }

    const batchName = new Date().toISOString().replace(/[-:]/g, "").slice(0, 14);
    let tasks = 0;
    for (const [i, batch] of chunk(inputs, 6).entries()) {
      const batchId = `${batchName}_${String(i).padStart(2, "0")}`;
      const outputFile = join(handoffDirs.resultsDir, `write-${batchId}.json`);
      writeTask(handoffDirs, {
        version: 1,
        stage: "write",
        batch: batchId,
        promptFile: "industry/prompts/write.md",
        prompt: buildPrompt(promptMd, batch),
        input: batch,
        outputFile,
        agentInstructions: agentInstructions(outputFile, "write"),
      });
      tasks++;
    }
    return { events: events.length, tasks, written: 0 };
  });
  db.close();
  if (stats.tasks > 0) {
    console.log(
      `[write] 已生成 ${stats.tasks} 个 handoff 任务（事件 ${stats.events} 个）。agent 处理后运行: npm run write -- --consume`,
    );
  } else {
    console.log(`[write] 完成: 事件 ${stats.events} | 已写 ${stats.written}`);
  }
}
