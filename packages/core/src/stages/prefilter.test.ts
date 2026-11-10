/** 预筛纯逻辑测试 */
import { describe, expect, it } from "vitest";
import type { PrefilterConfig } from "../config.js";
import { jaccard, normalizeTitle } from "../text.js";
import { prefilterBatch, type PrefilterItem } from "./prefilter.js";

const NOW = "2026-11-07T06:00:00.000Z"; // 北京 14:00

const cfg: PrefilterConfig = {
  oldItemHours: 48,
  nearDupWindowHours: 14 * 24,
  nearDupJaccard: 0.72,
  sameAuthorExempt: true,
  blockKeywords: ["配资", "加群"],
  maxCandidatesPerRun: 80,
};

const mk = (over: Partial<PrefilterItem> & Pick<PrefilterItem, "id" | "title">): PrefilterItem => ({
  excerpt: "",
  authorName: "用户A",
  publishedAt: "2026-11-07T03:00:00.000Z", // 3 小时前
  metrics: { like: 0, reply: 0, forward: 0 },
  ...over,
});

describe("normalizeTitle / jaccard", () => {
  it("归一化去标点空格", () => {
    expect(normalizeTitle(" 惠城环保，进博会！携手欧莱雅 ")).toBe("惠城环保进博会携手欧莱雅");
  });

  it("同事件标题相似度高、无关标题为 0", () => {
    expect(jaccard(normalizeTitle("XX公司中标10亿大单"), normalizeTitle("XX公司中标10亿大单（转载）"))).toBeGreaterThan(0.6);
    expect(jaccard(normalizeTitle("XX公司中标10亿大单"), normalizeTitle("复盘今日市场情绪周期"))).toBeLessThan(0.2);
  });
});

describe("prefilterBatch", () => {
  it("关键词拦截", () => {
    const d = prefilterBatch([mk({ id: "1", title: "需要配资的看过来" })], [], cfg, NOW);
    expect(d[0]?.status).toBe("blocked");
    expect(d[0]?.reason).toContain("keyword");
  });

  it("旧文归档（发布超 48h）", () => {
    const d = prefilterBatch([mk({ id: "1", title: "深度复盘", publishedAt: "2026-11-01T00:00:00.000Z" })], [], cfg, NOW);
    expect(d[0]?.status).toBe("archived_old");
  });

  it("跨作者近似重复被拦，且互动强者存活", () => {
    const items = [
      mk({ id: "weak", title: "惠城环保中标10亿大单", authorName: "散户甲", metrics: { like: 2, reply: 0, forward: 0 } }),
      mk({ id: "strong", title: "惠城环保中标10亿大单！", authorName: "机构乙", metrics: { like: 50, reply: 10, forward: 5 } }),
    ];
    const d = prefilterBatch(items, [], cfg, NOW);
    const byId = Object.fromEntries(d.map((x) => [x.id, x]));
    expect(byId.strong?.status).toBe("candidate");
    expect(byId.weak?.status).toBe("blocked");
    expect(byId.weak?.reason).toContain("dup_of:strong");
  });

  it("同作者系列帖（盘前纪要日更）豁免去重", () => {
    const pool = [mk({ id: "p1", title: "10月8日盘前纪要", authorName: "盘前纪要", publishedAt: "2026-11-05T02:00:00.000Z" })];
    const d = prefilterBatch([mk({ id: "n1", title: "10月14日盘前纪要", authorName: "盘前纪要" })], pool, cfg, NOW);
    expect(d[0]?.status).toBe("candidate");
  });

  it("与已处理池的跨作者重复被拦", () => {
    const pool = [mk({ id: "p1", title: "光库科技CPO新突破", authorName: "某人", publishedAt: "2026-11-06T02:00:00.000Z" })];
    const d = prefilterBatch([mk({ id: "n1", title: "光库科技CPO新突破（转发）", authorName: "另一人" })], pool, cfg, NOW);
    expect(d[0]?.status).toBe("blocked");
  });

  it("候选上限：溢出者不产生决策（留待下轮）", () => {
    const small: PrefilterConfig = { ...cfg, maxCandidatesPerRun: 2 };
    const items = [1, 2, 3, 4].map((i) => mk({ id: `i${i}`, title: `完全不同的主题第${i}号` }));
    const d = prefilterBatch(items, [], small, NOW);
    expect(d.length).toBe(2);
    expect(d.every((x) => x.status === "candidate")).toBe(true);
  });
});
