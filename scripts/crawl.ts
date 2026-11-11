/**
 * 采集阶段：按 industry/sources.json 抓取所有启用信源并入库。
 * 用法：npm run crawl [-- --source=jiuyangongshe] [-- --boards=square_publish,square_hot]
 * 抓取/入库逻辑在 @jyc/sources 的 crawlAll（与 ask 链路共用）。
 */
import { defaultDbPath, defaultMigrationsDir, openDb, withRun, type RunStats } from "@jyc/core";
import { crawlAll } from "@jyc/sources";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const sourceFilter = [...args].find((a) => a.startsWith("--source="))?.slice("--source=".length);
const boardsArg = [...args].find((a) => a.startsWith("--boards="))?.slice("--boards=".length);

const db = openDb(defaultDbPath(root), defaultMigrationsDir(root));

const stats = await withRun(db, "crawl", async (): Promise<RunStats> => {
  const r = await crawlAll(db, root, { sourceId: sourceFilter, boards: boardsArg });
  return { fetched: r.fetched, inserted: r.inserted, updated: r.updated, sources: r.sources };
});

db.close();
console.log(
  "\n[crawl] 完成:",
  JSON.stringify({ fetched: stats.fetched, inserted: stats.inserted, updated: stats.updated }),
);
