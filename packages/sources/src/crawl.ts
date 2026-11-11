/** 共享爬取编排：加载 sources.json → 逐信源抓取 → upsert 入库 → 更新 last_crawl_at（CLI 与 ask 链路共用一份实现） */
import { join } from "node:path";
import { nowIso, upsertCrawledItems, type Db } from "@jyc/core";
import { createAdapter, loadSourcesConfig } from "./loader.js";

export interface CrawlAllOptions {
  /** 仅抓指定信源（默认全部启用信源） */
  sourceId?: string;
  /** 仅抓指定板块（逗号分隔或数组，默认 sources.json 全板块） */
  boards?: string[] | string;
}

export interface CrawlAllResult {
  sources: Array<{ id: string; boards: Array<{ board: string; ok: boolean; count: number; error?: string }> }>;
  fetched: number;
  inserted: number;
  updated: number;
}

export async function crawlAll(db: Db, root: string, opts: CrawlAllOptions = {}): Promise<CrawlAllResult> {
  const entries = loadSourcesConfig(join(root, "industry", "sources.json")).filter(
    (e) => e.enabled && (!opts.sourceId || e.id === opts.sourceId),
  );
  if (entries.length === 0) throw new Error("没有启用的信源");

  const summary: CrawlAllResult = { sources: [], fetched: 0, inserted: 0, updated: 0 };
  for (const entry of entries) {
    db.prepare(
      "INSERT OR IGNORE INTO sources (id, name, kind, enabled, created_at) VALUES (?, ?, ?, 1, ?)",
    ).run(entry.id, entry.name, entry.kind, nowIso());

    let config = entry.config;
    const wantedBoards = typeof opts.boards === "string" ? opts.boards.split(",") : opts.boards;
    if (wantedBoards) {
      config = { ...config, boards: config.boards.filter((b) => wantedBoards.includes(b)) };
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
    summary.sources.push({ id: entry.id, boards: result.boards });
    summary.fetched += up.fetched;
    summary.inserted += up.inserted;
    summary.updated += up.updated;
  }
  return summary;
}
