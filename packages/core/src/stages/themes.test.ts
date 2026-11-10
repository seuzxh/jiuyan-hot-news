/** 题材聚合测试 */
import { describe, expect, it } from "vitest";
import { buildThemes, topStocksOf, type ThemeEvent } from "./themes.js";

const ev = (over: Partial<ThemeEvent> & Pick<ThemeEvent, "id" | "title">): ThemeEvent => ({
  summary: null,
  heat: 0,
  repScore: null,
  stocks: [],
  tags: [],
  repIndustry: null,
  repDriver: null,
  ...over,
});

describe("topStocksOf", () => {
  it("按 事件热度+评分×0.5 加权聚合，多事件提及者优先", () => {
    const top = topStocksOf([
      ev({ id: "a", title: "A", heat: 100, repScore: 80, stocks: ["西部材料", "润贝航科"] }),
      ev({ id: "b", title: "B", heat: 50, repScore: 70, stocks: ["西部材料"] }),
    ]);
    expect(top[0]?.name).toBe("西部材料"); // (100+40)+(50+35)=225
    expect(top[1]?.name).toBe("润贝航科"); // 140
    expect(top[0]?.mentions).toBe(2);
  });

  it("最多取 5 个", () => {
    const top = topStocksOf([ev({ id: "a", title: "A", stocks: ["1", "2", "3", "4", "5", "6", "7"] })]);
    expect(top.length).toBe(5);
  });
});

describe("buildThemes", () => {
  it("按分类聚题材；长征十二号归商业航天（新分类）", () => {
    const themes = buildThemes("2026-11-09", [
      ev({ id: "e1", title: "长征十二号发射", tags: ["长征十二号", "卫星互联网"], heat: 89 }),
      ev({ id: "e2", title: "StarMind时间表", tags: ["太空算力", "StarMind"], heat: 61 }),
      ev({ id: "e3", title: "寒潮采暖", tags: ["寒潮", "热泵"], heat: 100 }),
    ]);
    const ids = themes.map((t) => t.category.id);
    expect(ids).toContain("space");
    expect(ids).toContain("ai");
    expect(ids).toContain("energy");
    const space = themes.find((t) => t.category.id === "space")!;
    expect(space.eventCount).toBe(1);
    expect(space.needsLogic).toBe(false);
    expect(space.heatTotal).toBe(89);
    expect(space.id).toBe("2026-11-09:space");
  });

  it("同分类 ≥2 事件 needsLogic=true 且聚合个股", () => {
    const themes = buildThemes("2026-11-09", [
      ev({ id: "e1", title: "短剧A", tags: ["短剧"], heat: 40, stocks: ["浙文影业"] }),
      ev({ id: "e2", title: "短剧B", tags: ["漫剧"], heat: 30, stocks: ["中文在线", "浙文影业"] }),
    ]);
    expect(themes).toHaveLength(1);
    const media = themes[0]!;
    expect(media.category.id).toBe("media");
    expect(media.needsLogic).toBe(true);
    expect(media.topStocks[0]?.name).toBe("浙文影业");
  });
});
