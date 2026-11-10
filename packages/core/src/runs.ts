/** runs 表：每个管线阶段的执行记录（可观测性） */
import type { Db } from "./db.js";
import { nowIso } from "./time.js";

export interface RunStats {
  [key: string]: unknown;
}

/** 包裹一个阶段：开始时插入 running，成功写 stats，失败写 error */
export async function withRun<T extends RunStats>(
  db: Db,
  stage: string,
  fn: () => Promise<T>,
): Promise<T> {
  const ins = db
    .prepare("INSERT INTO runs (stage, status, started_at) VALUES (?, 'running', ?)")
    .run(stage, nowIso());
  const runId = Number(ins.lastInsertRowid);
  try {
    const stats = await fn();
    db.prepare("UPDATE runs SET status = 'success', stats_json = ?, ended_at = ? WHERE id = ?").run(
      JSON.stringify(stats),
      nowIso(),
      runId,
    );
    return stats;
  } catch (e) {
    db.prepare("UPDATE runs SET status = 'failed', error = ?, ended_at = ? WHERE id = ?").run(
      e instanceof Error ? e.message : String(e),
      nowIso(),
      runId,
    );
    throw e;
  }
}
