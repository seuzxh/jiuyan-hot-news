/** 韭研公社适配器：逐板块抓取 SSR 列表页并解析 */
import type { RawItem } from "@jyc/core";
import type { CrawlContext, CrawlResult, SourceAdapter } from "../types.js";
import { isBoardPageValid, parseBoardHtml } from "./parse.js";
import { fetchPage, randomInterval, sleep } from "./http.js";

export interface JycBoardConfig {
  baseUrl: string;
  boards: string[];
}

export function createJiuYanGongSheAdapter(cfg: JycBoardConfig): SourceAdapter {
  return {
    id: "jiuyangongshe",
    name: "韭研公社",
    async crawl(ctx: CrawlContext): Promise<CrawlResult> {
      const items: RawItem[] = [];
      const boards: CrawlResult["boards"] = [];
      for (let i = 0; i < cfg.boards.length; i++) {
        const board = cfg.boards[i]!;
        if (i > 0) await sleep(randomInterval(ctx.intervalMs));
        try {
          const html = await fetchPage(`${cfg.baseUrl}/${board}`, {
            maxRetries: ctx.maxRetries,
          });
          if (!isBoardPageValid(html)) {
            throw new Error(`板块 ${board} 解析到 0 条（疑似风控页或站点改版）`);
          }
          const parsed = parseBoardHtml(html, board);
          items.push(...parsed);
          boards.push({ board, ok: true, count: parsed.length });
          console.log(`[crawl] ${board}: ${parsed.length} 条`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          boards.push({ board, ok: false, count: 0, error: msg });
          console.error(`[crawl] ${board}: 失败 - ${msg}`);
        }
      }
      return { items, boards };
    },
  };
}
