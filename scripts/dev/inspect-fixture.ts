/**
 * 开发工具：检查韭研公社 fixture 的 DOM 结构。
 * 用途：站点改版后重新运行，确认选择器是否仍然有效。
 * 用法：npx tsx scripts/dev/inspect-fixture.ts <fixture.html路径>
 */
import { readFileSync } from "node:fs";
import { load, type CheerioAPI } from "cheerio";

const file = process.argv[2] ?? "packages/sources/src/jiuyangongshe/__fixtures__/square_publish.html";
const html = readFileSync(file, "utf8");
const $ = load(html);

function section(title: string, fn: () => void) {
  console.log(`\n===== ${title} =====`);
  fn();
}

section("页面概况", () => {
  console.log("title:", $("title").text().trim());
  console.log("html size:", html.length);
  console.log("Nuxt2?:", html.includes("webpackJsonp") || html.includes("_nuxt"));
});

section("/a/ 帖子链接", () => {
  const links = $('a[href^="/a/"]');
  console.log("count:", links.length);
  const hrefs = links.slice(0, 5).map((_, el) => $(el).attr("href")).get();
  console.log("first hrefs:", hrefs);
  if (links.length > 0) {
    let el = links.first();
    const chain: string[] = [];
    for (let i = 0; i < 8 && el.length; i++) {
      chain.push(`${el.prop("tagName")}.${el.attr("class") ?? "(no-class)"}`);
      el = el.parent();
    }
    console.log("ancestor chain:\n  " + chain.join("\n  < "));
  }
});

function dumpFirstItem($: CheerioAPI) {
  const first = $('a[href^="/a/"]').first();
  let item = first;
  for (let i = 0; i < 6; i++) {
    const cls = item.attr("class") ?? "";
    if (/(item|list|post|card|feed)/.test(cls) && item.find('a[href^="/a/"]').length === 1) break;
    item = item.parent();
    if (!item.length) return;
  }
  console.log(item.html()?.replace(/\s+/g, " ").slice(0, 3000) ?? "NOT FOUND");
}

section("第一个帖子条目 HTML（截断 3000 字符）", () => dumpFirstItem($));

const tagOf = (el: unknown): string => (el as { tagName?: string }).tagName ?? "?";

section("疑似互动数元素（纯数字小元素）", () => {
  const candidates = $("span,em,i,b").filter((_, el) => {
    const t = $(el).text().trim();
    return t.length > 0 && t.length <= 6 && /^\d+(\.\d+[万w]?)?$/.test(t) && $(el).children().length === 0;
  });
  console.log("numeric leaf elements:", candidates.length);
  console.log(candidates.slice(0, 20).map((_, el) => `<${tagOf(el)} class="${$(el).attr("class") ?? ""}">${$(el).text().trim()}</${tagOf(el)}>`).get().join("\n"));
});

section("时间元素", () => {
  const timeish = $("*").filter((_, el) => {
    const t = $(el).clone().children().remove().end().text().trim();
    return /^\d{4}-\d{2}-\d{2}/.test(t) || /(分钟前|小时前|昨天|刚刚)/.test(t);
  });
  console.log("time elements:", timeish.length);
  console.log(timeish.slice(0, 5).map((_, el) => `<${tagOf(el)} class="${$(el).attr("class") ?? ""}">${$(el).text().trim().slice(0, 40)}</${tagOf(el)}>`).get().join("\n"));
});

section("股票标签元素", () => {
  // 已知首页有"永臻股份、上海电影"这类标签，找它们的容器
  const all = $("*").filter((_, el) => {
    const t = $(el).clone().children().remove().end().text().trim();
    return t.length >= 2 && t.length <= 8 && /(股份|科技|集团|实业|银行|证券|电子|新材)/.test(t) && $(el).children().length === 0;
  });
  console.log("stock-like leaves:", all.length);
  console.log(all.slice(0, 10).map((_, el) => `<${tagOf(el)} class="${$(el).attr("class") ?? ""}">${$(el).text().trim()}</${tagOf(el)}>`).get().join("\n"));
});
