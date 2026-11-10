/**
 * 预筛阶段：对 status=new 的条目应用规则（关键词拦截/旧文归档/跨作者近似去重），
 * 通过者标记为 candidate 待打分。用法：npm run prefilter
 */
import { join } from "node:path";
import {
  defaultDbPath,
  defaultMigrationsDir,
  getItemsByStatus,
  getRecentProcessedItems,
  nowIso,
  openDb,
  parseMetrics,
  prefilterBatch,
  setStatus,
  withRun,
  type PrefilterItem,
} from "@jyc/core";
import { PREFILTER } from "../industry/selection.js";

const root = process.cwd();
const db = openDb(defaultDbPath(root), defaultMigrationsDir(root));

const stats = await withRun(db, "prefilter", async () => {
  const newItems = getItemsByStatus(db, "new", 2000);
  if (newItems.length === 0) return { candidates: 0, blocked: 0, archived_old: 0, untouched: 0 };

  const toInput = (r: (typeof newItems)[number]): PrefilterItem => ({
    id: r.id,
    title: r.title,
    excerpt: r.excerpt,
    authorName: r.author_name,
    publishedAt: r.published_at,
    metrics: parseMetrics(r.metrics_json),
  });

  const pool = getRecentProcessedItems(db, PREFILTER.nearDupWindowHours).map(toInput);
  const decisions = prefilterBatch(newItems.map(toInput), pool, PREFILTER, nowIso());

  let candidates = 0;
  let blocked = 0;
  let archived = 0;
  db.exec("BEGIN");
  try {
    for (const d of decisions) {
      setStatus(db, d.id, d.status, d.reason);
      if (d.status === "candidate") candidates++;
      else if (d.status === "blocked") blocked++;
      else archived++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return {
    candidates,
    blocked,
    archived_old: archived,
    untouched: newItems.length - decisions.length,
    top: newItems
      .filter((r) => decisions.some((d) => d.id === r.id && d.status === "candidate"))
      .sort((a, b) => b.like_count - a.like_count)
      .slice(0, 5)
      .map((r) => `「${r.title.slice(0, 30)}」赞${r.like_count} ${r.author_badge ?? r.author_name}`),
  };
});

db.close();
console.log(
  `\n[prefilter] 完成: 候选 ${stats.candidates} | 拦截 ${stats.blocked} | 旧文归档 ${stats.archived_old} | 留待下轮 ${stats.untouched}`,
);
for (const t of (stats as { top?: string[] }).top ?? []) console.log(`  候选示例: ${t}`);
