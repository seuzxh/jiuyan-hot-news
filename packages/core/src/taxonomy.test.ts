/** 分类体系测试：真实事件样本回归 */
import { describe, expect, it } from "vitest";
import { classifyEvent, groupByCategory } from "./taxonomy.js";

describe("classifyEvent 关键词计分分类", () => {
  it("Optimus/物理AI 归机器人而非 AI（'物理AI'包含'AI'不得误判）", () => {
    const c = classifyEvent({ tags: ["人形机器人", "Optimus", "物理AI"] });
    expect(c.id).toBe("robot");
  });

  it("AI漫剧归传媒而非 AI", () => {
    expect(classifyEvent({ tags: ["AI漫剧", "短剧出海"] }).id).toBe("media");
  });

  it("端侧AI归 AI·算力", () => {
    expect(classifyEvent({ tags: ["端侧AI", "可穿戴"] }).id).toBe("ai");
  });

  it("概念无命中时按驱动：情绪周期→情绪复盘，订单→个股", () => {
    expect(classifyEvent({ tags: [], repDriver: "情绪周期" }).id).toBe("sentiment");
    expect(classifyEvent({ tags: [], repDriver: "订单" }).id).toBe("stock");
  });

  it("驱动也无时按行业：电力设备→新能源", () => {
    expect(classifyEvent({ tags: [], repIndustry: "电力设备" }).id).toBe("energy");
  });

  it("全空归其他", () => {
    expect(classifyEvent({ tags: [] }).id).toBe("other");
  });

  it("冰雪装备归新能源·电力而非宏观（driver=政策 不得越过概念匹配）", () => {
    expect(classifyEvent({ tags: ["三夫户外", "冰雪装备"], repDriver: "政策" }).id).toBe("energy");
  });

  it("iPSC 归医药·生物而非传媒（'iPSC' 含 'IP' 子串不得误判）", () => {
    expect(classifyEvent({ tags: ["iPSC", "帕金森", "细胞治疗"] }).id).toBe("pharma");
  });

  it("中医药条例归医药·生物（driver=政策 不得越过概念匹配）", () => {
    expect(classifyEvent({ tags: ["中医药", "顶层政策"], repDriver: "政策" }).id).toBe("pharma");
  });
});

describe("groupByCategory", () => {
  it("空分类不出现，其他恒排最后", () => {
    const groups = groupByCategory([
      { tags: ["复盘", "连板梯队"], repDriver: "情绪周期" },
      { tags: ["短剧"] },
      { tags: [] },
    ]);
    expect(groups.map((g) => g.category.id)).toEqual(["media", "sentiment", "other"]);
    expect(groups[0]?.events.length).toBe(1);
  });
});
