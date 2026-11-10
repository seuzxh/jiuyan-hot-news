/** 各阶段 CLI 共用：数据库打开、handoff 目录、公共工具 */
import {
  defaultDbPath,
  defaultMigrationsDir,
  openDb,
  optEnv,
  parseStocks,
  type Db,
  type ItemRow,
} from "@jyc/core";
import { defaultHandoffDirs, listOutstandingTasks } from "@jyc/llm";

export function openPipelineDb(): Db {
  return openDb(defaultDbPath(), defaultMigrationsDir());
}

export const handoffDirs = defaultHandoffDirs();

export function hasGlmKey(): boolean {
  return optEnv("GLM_API_KEY") !== undefined;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface ItemTags {
  industry: string;
  concepts: string[];
  driver: string;
}

export function parseTags(item: ItemRow): ItemTags {
  if (!item.tags_json) return { industry: "综合", concepts: [], driver: "其他" };
  try {
    return { industry: "综合", concepts: [], driver: "其他", ...JSON.parse(item.tags_json) };
  } catch {
    return { industry: "综合", concepts: [], driver: "其他" };
  }
}

export function stocksOf(item: ItemRow): string[] {
  return parseStocks(item.stocks_json);
}

/** consume 时提示仍缺结果文件的任务（防止静默无操作） */
export function warnOutstanding(stage: "score" | "cluster" | "write" | "theme"): void {
  const pending = listOutstandingTasks(handoffDirs).filter((t) => t.stage === stage);
  if (pending.length > 0) {
    console.warn(
      `⚠ [handoff] ${stage} 阶段仍有 ${pending.length} 个任务缺结果文件: ${pending.map((p) => p.file.split("\\").pop()?.split("/").pop()).join(", ")}`,
    );
  }
}

/** agent-handoff 任务中写给 agent 的执行说明 */
export function agentInstructions(outputFile: string, stage: "score" | "cluster" | "write" | "theme"): string {
  return [
    `你是 LLM 管线中「${stage}」阶段的执行者。请：`,
    `1. 阅读本文件中的 prompt（提示词全文）与 input 数组`,
    `2. 严格按照 prompt 中的输出格式，为每条输入产出结果`,
    `3. 将结果写入文件 ${outputFile}，格式：{"version":1,"stage":"${stage}","batch":"<本任务的batch>","outputs":[...]}`,
    `4. outputs 必须是 JSON 数组，id/groupId/eventId 必须原样使用输入中的对应字段`,
    `5. 写完后用 JSON 解析自检一遍，确保是合法 JSON`,
  ].join("\n");
}
