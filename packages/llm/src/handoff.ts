/**
 * agent-handoff 协议：无 GLM_API_KEY 时，CLI 落盘任务文件，
 * 由 ZCode 定时任务中的 agent（或人工）按 schema 产出结果文件，再 `--consume` 回填。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmResult, LlmStage, LlmTask } from "./types.js";

export interface HandoffDirs {
  tasksDir: string;
  resultsDir: string;
}

export function defaultHandoffDirs(root = process.cwd()): HandoffDirs {
  return {
    tasksDir: join(root, "data", "llm-tasks"),
    resultsDir: join(root, "data", "llm-results"),
  };
}

export function writeTask<T extends LlmStage, TInput>(
  dirs: HandoffDirs,
  task: LlmTask<T, TInput>,
): string {
  mkdirSync(dirs.tasksDir, { recursive: true });
  const path = join(dirs.tasksDir, `${task.stage}-${task.batch}.json`);
  writeFileSync(path, JSON.stringify(task, null, 2), "utf8");
  return path;
}

function scanTasks(
  dirs: HandoffDirs,
  wantResult: boolean,
): Array<{ stage: LlmStage; batch: string; file: string }> {
  if (!existsSync(dirs.tasksDir)) return [];
  return readdirSync(dirs.tasksDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const m = f.match(/^(score|cluster|write|theme)-(.+)\.json$/);
      const file = join(dirs.tasksDir, f);
      if (!m) return null;
      const [, stage, batch] = m as unknown as [string, LlmStage, string];
      const hasResult = existsSync(join(dirs.resultsDir, f));
      if (hasResult !== wantResult) return null;
      return { stage, batch, file };
    })
    .filter((x): x is { stage: LlmStage; batch: string; file: string } => x !== null)
    .sort((a, b) => a.file.localeCompare(b.file));
}

/** 未完成任务（尚无对应结果文件，等待 agent 处理） */
export function listOutstandingTasks(dirs: HandoffDirs): Array<{ stage: LlmStage; batch: string; file: string }> {
  return scanTasks(dirs, false);
}

/** 就绪任务（结果文件已生成，等待 consume 回填） */
export function listReadyTasks(dirs: HandoffDirs): Array<{ stage: LlmStage; batch: string; file: string }> {
  return scanTasks(dirs, true);
}

export function readResult<TOutput>(dirs: HandoffDirs, stage: LlmStage, batch: string): LlmResult<TOutput> {
  const path = join(dirs.resultsDir, `${stage}-${batch}.json`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as LlmResult<TOutput>;
  if (parsed.stage !== stage || parsed.batch !== batch) {
    throw new Error(`结果文件 ${path} 的 stage/batch 与文件名不符`);
  }
  if (!Array.isArray(parsed.outputs)) throw new Error(`结果文件 ${path} 缺少 outputs 数组`);
  return parsed;
}

export function writeResult(dirs: HandoffDirs, result: LlmResult<unknown>): string {
  mkdirSync(dirs.resultsDir, { recursive: true });
  const path = join(dirs.resultsDir, `${result.stage}-${result.batch}.json`);
  writeFileSync(path, JSON.stringify(result, null, 2), "utf8");
  return path;
}

/** consume 成功后移除任务文件（结果文件留作审计） */
export function completeTask(dirs: HandoffDirs, stage: LlmStage, batch: string): void {
  unlinkSync(join(dirs.tasksDir, `${stage}-${batch}.json`));
}
