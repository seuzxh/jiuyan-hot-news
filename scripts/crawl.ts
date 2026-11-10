/**
 * 采集阶段：按 industry/sources.json 抓取所有启用信源并入库。
 * 用法：npm run crawl [-- --source=jiuyangongshe] [-- --boards=square_publish,square_hot]
 */
import { join } from "node:path";
import {
  defaultDbPath,
  defaultMigrationsDir,
  nowIso,
  openDb,
  upsertCrawledItems,
  withRun,
} from "@jyc/core";
import { createAdapter, loadSourcesConfig } from "@jyc/sources";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const sourceFilter = [...args].find((a) => a.startsWith("--source="))?.slice("--source=".length);
const boardsArg = [...args].find((a) => a.startsWith("--boards="))?.slice("--boards=".length);

const db = openDb(defaultDbPath(root), defaultMigrationsDir(root));

const stats = await withRun(db, "crawl", async () => {
  const entries = loadSourcesConfig(join(root, "industry", "sources.json")).filter(
    (e) => e.enabled && (!sourceFilter || e.id === sourceFilter),
  );
  if (entries.length === 0) throw new Error("没有启用的信源");

  const summary = { sources: [] as unknown[], fetched: 0, inserted: 0, updated: 0 };
  for (const entry of entries) {
    db.prepare(
      "INSERT OR IGNORE INTO sources (id, name, kind, enabled, created_at) VALUES (?, ?, ?, 1, ?)",
    ).run(entry.id, entry.name, entry.kind, nowIso());

    let config = entry.config;
    if (boardsArg) {
      config = { ...config, boards: config.boards.filter((b) => boardsArg.split(",").includes(b)) };
    }

    const adapter = createAdapter({ ...entry, config });
    console.log(`[crawl] 开始抓取 ${entry.name}（${config.boards.length} 个板块）`);
    const result = await adapter.crawl({
      intervalMs: entry.config.requestIntervalMs ?? [2000, 5000],
      maxRetries: entry.config.maxRetries ?? 3,
    });

    if (result.boards.length > 0 && result.boards.every((b) => !b.ok)) {
      throw new Error(`信源 ${entry.id} 全部板块抓取失败: ${result.boards.map((b) => b.error).join("; ")}`);
    }

    const up = upsertCrawledItems(db, result.items);
    db.prepare("UPDATE sources SET last_crawl_at = ? WHERE id = ?").run(nowIso(), entry.id);
    summary.sources.push({ id: entry.id, boards: result.boards, ...up });
    summary.fetched += up.fetched;
    summary.inserted += up.inserted;
    summary.updated += up.updated;
  }
  return summary;
});

db.close();
console.log("\n[crawl] 完成:", JSON.stringify({ fetched: stats.fetched, inserted: stats.inserted, updated: stats.updated }));
