/** 概念归一化测试：LLM 草稿 → 落库计划 */
import { describe, expect, it } from "vitest";
import { CONCEPT_OTHER_TITLE, conceptCategoryRank, planConcepts, topStocksOf, type ConceptDraft, type ConceptEvent } from "./concepts.js";

const ev = (id: string, over: Partial<ConceptEvent> = {}): ConceptEvent => ({
  id,
  title: `帖子${id}`,
  heat: 10,
  repScore: 70,
  stocks: [],
  tags: [],
  repIndustry: null,
  repDriver: null,
  ...over,
});

const draft = (over: Partial<ConceptDraft> & Pick<ConceptDraft, "title" | "eventIds">): ConceptDraft => ({
  category: "ai",
  takeaway: "结论",
  chain: ["环节一", "环节二"],
  stocks: [{ name: "甲公司", role: "龙头" }],
  risk: "",
  ...over,
});

describe("planConcepts", () => {
  it("未归入任何概念的事件兜底成\"其他动态\"，保证不丢帖子", () => {
    const plans = planConcepts("2026-11-24", [draft({ title: "PCB 缺货链", eventIds: ["e1"] })], [ev("e1"), ev("e2"), ev("e3")]);
    expect(plans).toHaveLength(2);
    const other = plans.find((p) => p.title === CONCEPT_OTHER_TITLE)!;
    expect(other.eventIds).toEqual(["e2", "e3"]);
    expect(other.eventCount).toBe(2);
    // 兜底概念垫底
    expect(plans[1]!.title).toBe(CONCEPT_OTHER_TITLE);
  });

  it("非法 eventId 被剔除；全部非法的概念整条丢弃", () => {
    const plans = planConcepts(
      "2026-11-24",
      [
        draft({ title: "有效", eventIds: ["e1", "evt_不存在的"] }),
        draft({ title: "全是错的", eventIds: ["evt_x", "evt_y"] }),
      ],
      [ev("e1")],
    );
    expect(plans.map((p) => p.title)).toEqual(["有效"]);
  });

  it("类目非法时按成员事件的标签兜底分类", () => {
    const plans = planConcepts(
      "2026-11-24",
      [draft({ title: "短剧出海", category: "不存在的类目", eventIds: ["e1"] })],
      [ev("e1", { tags: ["短剧", "AI漫剧"] })],
    );
    expect(plans[0]!.category.id).toBe("media");
  });

  it("排序：情绪/其他垫底，其余按帖数降序，同帖数看热度", () => {
    const plans = planConcepts(
      "2026-11-24",
      [
        draft({ title: "盘面", category: "sentiment", eventIds: ["e1", "e2", "e3"] }),
        draft({ title: "单帖热点", eventIds: ["e9"] }),
        draft({ title: "三帖", eventIds: ["e1", "e2", "e4"] }),
        draft({ title: "两帖", eventIds: ["e5", "e6"] }),
      ],
      [ev("e1", { heat: 100 }), ev("e2", { heat: 100 }), ev("e3"), ev("e4"), ev("e5"), ev("e6"), ev("e9", { heat: 900 })],
    );
    // 盘面虽有 3 帖仍垫底；三帖在两帖前；单帖即使热度极高也排在后面
    expect(plans.map((p) => p.title)).toEqual(["三帖", "两帖", "单帖热点", "盘面"]);
    expect(plans.map((p) => p.rank)).toEqual([1, 2, 3, 4]);
  });

  it("id 由标题决定：同一逻辑线在后续轮次排序变化后链接不变；标题相同不冲突", () => {
    const events = [ev("e1", { heat: 100 }), ev("e2"), ev("e3")];
    const round1 = planConcepts("2026-11-24", [draft({ title: "A", eventIds: ["e1", "e2"] }), draft({ title: "B", eventIds: ["e3"] })], events);
    // 下一轮 B 吸收了新帖排到前面：A 的 rank 从 1 变成 2，但 id 不变
    const round2 = planConcepts("2026-11-24", [draft({ title: "A", eventIds: ["e1"] }), draft({ title: "B", eventIds: ["e2", "e3"] })], events);
    expect(round2.map((p) => p.title)).toEqual(["B", "A"]);
    expect(round2.find((p) => p.title === "A")!.id).toBe(round1.find((p) => p.title === "A")!.id);
    expect(round1[0]!.id).toMatch(/^2026-11-24:[0-9a-z]{6}$/);

    const dup = planConcepts("2026-11-24", [draft({ title: "A", eventIds: ["e1"] }), draft({ title: "A", eventIds: ["e2", "e3"] })], events);
    expect(dup).toHaveLength(2);
    expect(new Set(dup.map((p) => p.id)).size).toBe(2);
  });

  it("标的去重、上限 20 个，超长字段裁剪而不是报错", () => {
    const stocks = Array.from({ length: 25 }, (_, i) => ({ name: `标的${i}`, role: "" }));
    const plans = planConcepts(
      "2026-11-24",
      [draft({ title: "x".repeat(40), takeaway: "y".repeat(200), chain: ["a", "b", "c", "d", "e", "f", "g", "h"], stocks: [...stocks, { name: "标的0", role: "" }], eventIds: ["e1"] })],
      [ev("e1")],
    );
    const p = plans[0]!;
    expect(p.stocks).toHaveLength(20);
    expect(new Set(p.stocks.map((s) => s.name)).size).toBe(20);
    expect(p.title.length).toBeLessThanOrEqual(16);
    expect(p.takeaway.length).toBeLessThanOrEqual(64);
    expect(p.chain).toHaveLength(6);
  });

  it("标的的入选依据与「补充」标记被归一化；没写时为空/false", () => {
    const plans = planConcepts(
      "2026-11-24",
      [
        draft({
          title: "HBM 设备",
          eventIds: ["e1"],
          stocks: [
            { name: "甲公司", role: "键合设备", basis: "已获批量订单" },
            { name: "乙公司", role: "龙头", basis: "", added: true },
          ],
        }),
      ],
      [ev("e1")],
    );
    expect(plans[0]!.stocks).toEqual([
      { name: "甲公司", role: "键合设备", basis: "已获批量订单", added: false },
      { name: "乙公司", role: "龙头", basis: "", added: true },
    ]);
  });

  it("催化明细：去重、上限 8 条；旧结果没有 catalysts 时为空数组", () => {
    const catalysts = Array.from({ length: 10 }, (_, i) => ({ when: `11.2${i}`, fact: `催化${i}`, eventId: "e1" }));
    const plans = planConcepts(
      "2026-11-24",
      [
        draft({
          title: "有催化",
          eventIds: ["e1"],
          catalysts: [
            ...catalysts,
            { when: "11.26", fact: "催化0" }, // 与首条重复，丢弃
            { fact: "   " }, // 空事实，丢弃
          ],
        }),
        draft({ title: "无催化", eventIds: ["e2"] }),
      ],
      [ev("e1"), ev("e2")],
    );
    const withCatalysts = plans.find((p) => p.title === "有催化")!;
    expect(withCatalysts.catalysts).toHaveLength(8);
    expect(new Set(withCatalysts.catalysts.map((c) => c.fact)).size).toBe(8);
    expect(withCatalysts.catalysts[0]).toEqual({ when: "11.20", fact: "催化0", impact: "", upcoming: false, eventId: "e1" });

    const without = plans.find((p) => p.title === "无催化")!;
    expect(without.catalysts).toEqual([]);
  });

  it("催化明细：出处帖不在窗口内只去掉链接、保留事实；预期时点带 upcoming 标记", () => {
    const plans = planConcepts(
      "2026-11-24",
      [
        draft({
          title: "预期时点",
          eventIds: ["e1"],
          catalysts: [{ when: "2027Q1", fact: "产线投产", impact: "放量前提", upcoming: true, eventId: "evt_窗口外" }],
        }),
      ],
      [ev("e1")],
    );
    expect(plans[0]!.catalysts).toEqual([{ when: "2027Q1", fact: "产线投产", impact: "放量前提", upcoming: true, eventId: "" }]);
  });

  it("汇总帖可同时属于多个概念（帖数与热度合计按成员累加）", () => {
    const plans = planConcepts(
      "2026-11-24",
      [
        draft({ title: "A", eventIds: ["digest", "a1"] }),
        draft({ title: "B", eventIds: ["digest"] }),
      ],
      [ev("digest", { heat: 277 }), ev("a1", { heat: 5 })],
    );
    const a = plans.find((p) => p.title === "A")!;
    const b = plans.find((p) => p.title === "B")!;
    expect(a.eventIds).toContain("digest");
    expect(b.eventIds).toContain("digest");
    expect(a.heatTotal).toBe(282);
  });
});

describe("conceptCategoryRank", () => {
  it("产业类在前，情绪居中，其他垫底", () => {
    expect(conceptCategoryRank("ai")).toBeLessThan(conceptCategoryRank("sentiment"));
    expect(conceptCategoryRank("sentiment")).toBeLessThan(conceptCategoryRank("other"));
  });
});

describe("topStocksOf", () => {
  it("按 事件热度+评分×0.5 加权聚合，多事件提及者优先", () => {
    const top = topStocksOf([
      ev("a", { heat: 100, repScore: 80, stocks: ["西部材料", "润贝航科"] }),
      ev("b", { heat: 50, repScore: 70, stocks: ["西部材料"] }),
    ]);
    expect(top[0]?.name).toBe("西部材料");
    expect(top[0]?.mentions).toBe(2);
  });
});
