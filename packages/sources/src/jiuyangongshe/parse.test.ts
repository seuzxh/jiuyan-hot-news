/** 解析器回归测试：基于 2026-11-07 真实 fixture（站点改版后先更新 fixture 再修选择器） */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBoardHtml, isBoardPageValid } from "./parse.js";
import { tierFromBadge } from "./selectors.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

describe("parseBoardHtml - square_publish", () => {
  const items = parseBoardHtml(fixture("square_publish.html"), "square_publish");

  it("解析出 28 条帖子（30 行 - 2 条置顶官方帖，置顶帖无时间不入库）", () => {
    expect(items.length).toBe(28);
  });

  it("首条字段完整（标题/作者/时间/股票/互动数）", () => {
    const first = items[0]!;
    expect(first.extId).toBe("2gvkvpk3q99");
    expect(first.title).toContain("惠城环保");
    expect(first.authorName).toBe("Hi放开那个女孩");
    expect(first.publishedAt).toBe("2026-11-07T04:27:08.000Z"); // 北京 12:27:08
    expect(first.stocks).toContain("惠城环保");
    expect(first.metrics.like).toBe(1);
    expect(first.metrics.forward).toBe(0);
    expect(first.metrics.reply).toBe(0);
    expect(first.url).toBe("https://www.jiuyangongshe.com/a/2gvkvpk3q99");
    expect(first.boards).toEqual(["square_publish"]);
  });

  it("所有条目都有可信发布时间与分级", () => {
    for (const it of items) {
      expect(it.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(["T1_5", "T2"]).toContain(it.authorTier);
      expect(it.title.length).toBeGreaterThan(0);
    }
  });

  it("标题必有；摘要允许为空（纯图帖如「一图复盘」），有则已截断", () => {
    for (const it of items) {
      expect(it.title.length).toBeGreaterThan(0);
      expect(it.excerpt.length).toBeLessThanOrEqual(600);
    }
    expect(items.filter((i) => i.excerpt.length > 0).length).toBeGreaterThanOrEqual(25);
  });
});

describe("parseBoardHtml - 其他板块", () => {
  it("study_publish 解析 27 条（30 行 - 3 条置顶官方帖）", () => {
    const items = parseBoardHtml(fixture("study_publish.html"), "study_publish");
    expect(items.length).toBe(27);
  });

  it("live_publish 解析出条目且时间跨度正常", () => {
    const items = parseBoardHtml(fixture("live_publish.html"), "live_publish");
    expect(items.length).toBeGreaterThan(20);
    const times = items.map((i) => i.publishedAt).sort();
    expect(times[0]! < times[times.length - 1]!).toBe(true);
  });

  it("action 页（客户端渲染）被判定为无效", () => {
    expect(isBoardPageValid(fixture("action.html"))).toBe(false);
  });
});

describe("tierFromBadge 作者分级", () => {
  it("机构/游资/达人 → T1_5", () => {
    expect(tierFromBadge("机构")).toBe("T1_5");
    expect(tierFromBadge("游资")).toBe("T1_5");
    expect(tierFromBadge("只买龙头的公社达人")).toBe("T1_5");
  });

  it("萌新/无徽章 → T2", () => {
    expect(tierFromBadge("疯狂点赞的萌新")).toBe("T2");
    expect(tierFromBadge(undefined)).toBe("T2");
  });
});
