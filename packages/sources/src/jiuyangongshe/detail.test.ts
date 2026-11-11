/** 详情页解析回归：基于 2026-11-11 真实 fixture（/a/jzwbk3d4un，Nuxt2 CSR NUXT 载荷） */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDetailHtml } from "./detail.js";

const fixture = (): string =>
  readFileSync(new URL("./__fixtures__/detail-jzwbk3d4un.html", import.meta.url), "utf8");

describe("parseDetailHtml", () => {
  const d = parseDetailHtml(fixture());

  it("从 window.__NUXT__ 载荷提取标题与全文（远超列表页 ~250 字摘要）", () => {
    expect(d.title).toBe("端侧AI迎来规模化落地，端侧及边缘算力环节梳理");
    expect(d.content.length).toBeGreaterThan(1000);
    expect(d.content).toContain("端侧AI在终端本地完成AI推理");
  });

  it("段落以换行分隔（块级标签转换行）", () => {
    expect(d.content.split("\n").length).toBeGreaterThan(10);
  });

  it("载荷自带股票列表", () => {
    expect(d.stocks).toContainEqual({ name: "通宇通讯", code: "sz002792" });
  });

  it("无 NUXT 载荷的页面（风控页/改版）明确报错而非返回空", () => {
    expect(() => parseDetailHtml("<html><body>风控页</body></html>")).toThrow(/__NUXT__/);
  });
});
