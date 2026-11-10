/** 信源适配器接口：新增信源（财联社/雪球等）实现此接口即可接入全部管线 */
import type { RawItem } from "@jyc/core";

export interface CrawlContext {
  /** 请求间隔毫秒区间 */
  intervalMs: [number, number];
  maxRetries: number;
}

export interface CrawlResult {
  items: RawItem[];
  /** 各板块抓取统计 */
  boards: Array<{ board: string; ok: boolean; count: number; error?: string }>;
}

export interface SourceAdapter {
  id: string;
  name: string;
  /** 抓取一轮：实现方负责礼貌间隔与退避 */
  crawl(ctx: CrawlContext): Promise<CrawlResult>;
}
