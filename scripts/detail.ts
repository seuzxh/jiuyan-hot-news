/**
 * 正文抓取阶段：对入选(selected)帖子抓取详情页全文存 item_details 缓存表，
 * 供写作阶段（全文摘要）与检索使用。与 ask 功能共用缓存，抓过不重抓；
 * 失败也留行防反复重抓，--retry 清除失败行重试。
 * 用法：npm run detail [-- --retry]
 */
import {
  defaultDbPath,
  defaultMigrationsDir,
  getSelectedItemsNeedingDetail,
  openDb,
  resetFailedDetails,
  upsertItemDetail,
  withRun,
} from "@jyc/core";
import { fetchDetail, randomInterval, sleep } from "@jyc/sources";

const db = openDb(defaultDbPath(), defaultMigrationsDir());
const retry = new Set(process.argv.slice(2)).has("--retry");

const stats = await withRun(db, "detail", async () => {
  let reset = 0;
  if (retry) reset = resetFailedDetails(db);
  const targets = getSelectedItemsNeedingDetail(db, 50);
  if (targets.length === 0) return { targets: 0, ok: 0, failed: 0, reset };

  let ok = 0;
  let failed = 0;
  for (const [i, t] of targets.entries()) {
    if (i > 0) await sleep(randomInterval([2000, 5000]));
    try {
      const d = await fetchDetail(t.ext_id, { maxRetries: 2 });
      if (d.content.trim().length === 0) throw new Error("正文为空（纯图帖或结构变化）");
      upsertItemDetail(db, t.id, d.content.slice(0, 8000));
      ok++;
      console.log(`[detail] ok ${t.ext_id}（${d.content.length} 字）`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      upsertItemDetail(db, t.id, "", msg.slice(0, 200));
      failed++;
      console.error(`[detail] failed ${t.ext_id}: ${msg}`);
    }
  }
  return { targets: targets.length, ok, failed, reset };
});

db.close();
console.log(`[detail] 完成: 目标 ${stats.targets} | 全文 ${stats.ok} | 失败 ${stats.failed}${stats.reset ? ` | 重置重试 ${stats.reset}` : ""}`);
