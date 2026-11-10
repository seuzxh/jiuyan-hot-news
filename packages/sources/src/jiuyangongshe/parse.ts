/** 板块页 HTML → RawItem[]（纯函数，用 __fixtures__ 做回归测试） */
import { load, type CheerioAPI } from "cheerio";
import { parseBjDateTime, type RawItem } from "@jyc/core";
import { SELECTORS, ICON_TO_METRIC, tierFromBadge } from "./selectors.js";

const SOURCE_ID = "jiuyangongshe";
const BASE_URL = "https://www.jiuyangongshe.com";
const TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
/** 入库摘要截断长度（LLM 阶段输入另有更宽松的截断） */
const EXCERPT_MAX = 600;

/**
 * 解析一个板块页。
 * @param html SSR 渲染的完整页面 HTML
 * @param board 板块标识（如 square_publish），仅作为标签
 */
export function parseBoardHtml(html: string, board: string): RawItem[] {
  const $ = load(html);
  const items: RawItem[] = [];
  const seen = new Set<string>();

  $(SELECTORS.postRow).each((_, rowEl) => {
    const row = $(rowEl);
    const link = row.find(SELECTORS.postLink).first();
    const href = link.attr("href");
    if (!href || !/^\/a\/[\w-]+$/.test(href)) return;
    const extId = href.slice(3);
    if (seen.has(extId)) return;
    seen.add(extId);

    const title = textOf(row.find(SELECTORS.title).first());
    const excerptRaw = textOf(row.find(SELECTORS.excerpt).first());

    // 作者块：名称 + 主页链接 + 徽章
    const authorName = textOf(row.find(SELECTORS.authorName).first());
    const authorHref = row.find(`a[href^="/u/"]`).first().attr("href");
    const authorBadge = textOf(row.find(SELECTORS.authorBadge).first()) || undefined;

    // 时间：取行内匹配绝对时间格式的元素
    let publishedAt = "";
    row.find(SELECTORS.time).each((__, el) => {
      const t = $(el).text().trim();
      if (TIME_RE.test(t)) {
        publishedAt = parseBjDateTime(t);
        return false;
      }
      return;
    });

    // 关联股票
    const stocks = [
      ...new Set(
        row
          .find(SELECTORS.stockTag)
          .map((__, el) => $(el).text().trim())
          .get()
          .filter((s) => s.length > 0),
      ),
    ];

    // 互动数：.handle 内 i.icon.{forward|reply|fabulous} + 相邻 span 数字
    const metrics = { forward: 0, reply: 0, like: 0 };
    row.find(SELECTORS.handle).each((__, handleEl) => {
      const handle = $(handleEl);
      const icon = handle.find(SELECTORS.handleIcon).first();
      const cls = icon.attr("class") ?? "";
      const metric = cls
        .split(/\s+/)
        .map((c) => ICON_TO_METRIC[c as keyof typeof ICON_TO_METRIC])
        .find((m) => m !== undefined);
      if (!metric) return;
      const num = parseInt(handle.find("span").first().text().trim() || "0", 10);
      metrics[metric] = Number.isNaN(num) ? 0 : num;
    });

    if (!publishedAt) return; // 无可信发布时间的条目不入库（AIHOT 同款规则）
    const finalTitle = title || excerptRaw.slice(0, 40);

    items.push({
      sourceId: SOURCE_ID,
      extId,
      url: `${BASE_URL}${href}`,
      title: finalTitle,
      excerpt: excerptRaw.slice(0, EXCERPT_MAX),
      authorName,
      authorUrl: authorHref ? `${BASE_URL}${authorHref}` : undefined,
      authorBadge,
      authorTier: tierFromBadge(authorBadge),
      publishedAt,
      stocks,
      metrics,
      boards: [board],
    });
  });

  return items;
}

function textOf(el: { text(): string }): string {
  return el.text().replace(/\s+/g, " ").trim();
}

/** 快速校验页面是否为有效 SSR（用于抓取后自检，防止把风控页当空列表） */
export function isBoardPageValid(html: string): boolean {
  const $: CheerioAPI = load(html);
  return $(SELECTORS.postRow).find(SELECTORS.postLink).length > 0;
}
