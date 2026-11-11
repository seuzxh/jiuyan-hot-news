/**
 * 帖子详情页全文提取：/a/{extId} 为 Nuxt2 CSR，正文不在 DOM，
 * 在 window.__NUXT__ IIFE 载荷 data[0].data.content（HTML 字符串）。
 * 用 node:vm 沙箱求值载荷（无 require/process，超时 3s），__fixtures__/detail-*.html 回归。
 */
import vm from "node:vm";
import { load } from "cheerio";
import { DETAIL_PAYLOAD } from "./selectors.js";
import { fetchPage } from "./http.js";

const BASE_URL = "https://www.jiuyangongshe.com";

export interface DetailContent {
  /** 全文纯文本（段落以 \n 分隔） */
  content: string;
  title: string;
  /** 载荷自带股票列表（名称+代码），列表页没有时可作补充 */
  stocks: Array<{ name: string; code: string }>;
}

/** 从详情页 HTML 提取正文（纯函数，fixture 测试覆盖） */
export function parseDetailHtml(html: string): DetailContent {
  const m = html.match(DETAIL_PAYLOAD.scriptRe);
  if (!m) throw new Error("详情页未找到 window.__NUXT__ 载荷（疑似站点改版或风控页）");
  const sandbox: { window?: Record<string, unknown> } = { window: {} };
  const payload = vm.runInNewContext(`${m[1]}; window.__NUXT__`, sandbox, { timeout: 3000 }) as {
    data?: Array<{ data?: { content?: unknown; title?: unknown; stock_list?: unknown } }>;
  };
  const node = payload?.data?.[0]?.data;
  const rawContent = typeof node?.content === "string" ? node.content : "";
  if (!rawContent) throw new Error("NUXT 载荷缺少 content 字段（疑似改版/付费墙）");

  const title = typeof node?.title === "string" ? node.title : "";
  const stocks = Array.isArray(node?.stock_list)
    ? (node.stock_list as Array<{ name?: unknown; code?: unknown }>)
        .filter((s) => typeof s?.name === "string")
        .map((s) => ({ name: s.name as string, code: typeof s.code === "string" ? s.code : "" }))
    : [];

  // HTML → 纯文本：块级标签转换行，去标签后逐行清理
  const withBreaks = rawContent.replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n");
  const text = load(`<div>${withBreaks}</div>`)("div").text();
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
  return { content: lines.join("\n"), title, stocks };
}

/** 抓取一个帖子详情页（复用 fetchPage 的 UA/Referer/退避） */
export async function fetchDetail(extId: string, opts: { maxRetries: number }): Promise<DetailContent> {
  const html = await fetchPage(`${BASE_URL}/a/${extId}`, opts);
  return parseDetailHtml(html);
}
