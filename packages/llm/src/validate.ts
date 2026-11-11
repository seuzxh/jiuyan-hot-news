/** 各阶段结果校验：坏数据明确报错，好数据归一化 */
import type {
  AskAggregateOutput,
  AskIntentOutput,
  AskKeyPoint,
  ClusterGroupOutput,
  ScoreDualOutput,
  ScorePassOutput,
  WriteEventOutput,
} from "./types.js";

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
const str = (x: unknown): string | undefined => (typeof x === "string" && x.trim().length > 0 ? x.trim() : undefined);
const strArr = (x: unknown): string[] | undefined =>
  Array.isArray(x) && x.every((i) => typeof i === "string") ? (x as string[]).map((s) => s.trim()).filter(Boolean) : undefined;

function scoreRange(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toArr(x: unknown): unknown[] {
  if (!Array.isArray(x)) throw new Error(`期望 JSON 数组，得到: ${typeof x}`);
  return x;
}

/** 校验单轮打分输出（API 模式每轮） */
export function validateScorePass(raw: unknown, expectedIds: Set<string>): ScorePassOutput[] {
  return toArr(raw).map((entry, i) => {
    if (!isObj(entry)) throw new Error(`第 ${i} 项不是对象`);
    const id = str(entry.id);
    const score = num(entry.score);
    if (!id || !expectedIds.has(id)) throw new Error(`第 ${i} 项 id 非法: ${String(entry.id)}`);
    if (score === undefined) throw new Error(`第 ${i} 项（${id}）缺少数值 score`);
    return {
      id,
      score: scoreRange(score),
      industry: str(entry.industry) ?? "综合",
      concepts: strArr(entry.concepts) ?? [],
      driver: str(entry.driver) ?? "其他",
    };
  });
}

/** 校验双分输出（handoff 模式 / 合并后） */
export function validateScoreDual(raw: unknown, expectedIds: Set<string>): ScoreDualOutput[] {
  return toArr(raw).map((entry, i) => {
    if (!isObj(entry)) throw new Error(`第 ${i} 项不是对象`);
    const id = str(entry.id);
    const s1 = num(entry.score1);
    const s2 = num(entry.score2);
    if (!id || !expectedIds.has(id)) throw new Error(`第 ${i} 项 id 非法: ${String(entry.id)}`);
    if (s1 === undefined || s2 === undefined) throw new Error(`第 ${i} 项（${id}）缺少 score1/score2`);
    return {
      id,
      score1: scoreRange(s1),
      score2: scoreRange(s2),
      industry: str(entry.industry) ?? "综合",
      concepts: strArr(entry.concepts) ?? [],
      driver: str(entry.driver) ?? "其他",
    };
  });
}

export function validateCluster(raw: unknown, expectedGroups: Set<string>): ClusterGroupOutput[] {
  return toArr(raw).map((entry, i) => {
    if (!isObj(entry)) throw new Error(`第 ${i} 项不是对象`);
    const groupId = str(entry.groupId);
    if (!groupId || !expectedGroups.has(groupId)) throw new Error(`第 ${i} 项 groupId 非法: ${String(entry.groupId)}`);
    return { groupId, sameEvent: entry.sameEvent === true, reason: str(entry.reason) };
  });
}

export function validateWrite(raw: unknown, expectedEventIds: Set<string>): WriteEventOutput[] {
  return toArr(raw).map((entry, i) => {
    if (!isObj(entry)) throw new Error(`第 ${i} 项不是对象`);
    const eventId = str(entry.eventId);
    const eventTitle = str(entry.eventTitle);
    const summary = str(entry.summary);
    const reason = str(entry.reason);
    if (!eventId || !expectedEventIds.has(eventId)) throw new Error(`第 ${i} 项 eventId 非法: ${String(entry.eventId)}`);
    if (!eventTitle) throw new Error(`第 ${i} 项（${eventId}）缺少 eventTitle`);
    if (!summary) throw new Error(`第 ${i} 项（${eventId}）缺少 summary`);
    if (!reason) throw new Error(`第 ${i} 项（${eventId}）缺少 reason`);
    return { eventId, eventTitle, summary, reason };
  });
}

export function validateTheme(raw: unknown, expectedThemeIds: Set<string>): Array<{ themeId: string; logic: string }> {
  return toArr(raw).map((entry, i) => {
    if (!isObj(entry)) throw new Error(`第 ${i} 项不是对象`);
    const themeId = str(entry.themeId);
    const logic = str(entry.logic);
    if (!themeId || !expectedThemeIds.has(themeId)) throw new Error(`第 ${i} 项 themeId 非法: ${String(entry.themeId)}`);
    if (!logic) throw new Error(`第 ${i} 项（${themeId}）缺少 logic`);
    return { themeId, logic };
  });
}

/** 校验 ask-intent 输出（单个对象包在单元素数组里，与 handoff outputs 数组协议一致） */
export function validateAskIntent(raw: unknown, expectedKeyword: string): AskIntentOutput {
  const arr = toArr(raw);
  if (arr.length !== 1) throw new Error(`ask-intent 期望恰好 1 个输出对象，得到 ${arr.length} 个`);
  const entry = arr[0];
  if (!isObj(entry)) throw new Error("ask-intent 输出不是对象");
  const keyword = str(entry.keyword) ?? expectedKeyword;
  if (keyword !== expectedKeyword) throw new Error(`ask-intent keyword 非法: ${String(entry.keyword)}`);
  const kind = entry.kind;
  if (kind !== "个股" && kind !== "概念题材" && kind !== "模糊") {
    throw new Error(`ask-intent kind 非法: ${String(kind)}`);
  }
  const intent = str(entry.intent);
  const assumption = str(entry.assumption);
  if (!intent) throw new Error("ask-intent 缺少 intent");
  if (!assumption) throw new Error("ask-intent 缺少 assumption");
  const kwObj = isObj(entry.expandedKeywords) ? entry.expandedKeywords : {};
  const identity = strArr(kwObj.identity) ?? [];
  const narrative = strArr(kwObj.narrative) ?? [];
  if (identity.length === 0 && narrative.length === 0) {
    throw new Error("ask-intent expandedKeywords 两层均为空（至少要有关键词本身）");
  }
  const alt = Array.isArray(entry.altInterpretations)
    ? entry.altInterpretations
        .filter((a) => isObj(a) && str((a as Record<string, unknown>).label))
        .map((a) => {
          const o = a as Record<string, unknown>;
          return { label: str(o.label)!, hint: str(o.hint) ?? "" };
        })
    : undefined;
  return {
    keyword: expectedKeyword,
    kind,
    intent,
    assumption,
    expandedKeywords: { identity: [...new Set([expectedKeyword, ...identity])], narrative },
    stocks: strArr(entry.stocks) ?? [],
    altInterpretations: alt && alt.length > 0 ? alt : undefined,
  };
}

const INFO_LAYERS = ["事件", "研报观点", "UGC推测"] as const;

/** 校验 ask-aggregate 输出（R1/R2 同一 schema；expectedIds = 候选 items.id 集） */
export function validateAskAggregate(raw: unknown, expectedIds: Set<string>): AskAggregateOutput {
  const arr = toArr(raw);
  if (arr.length !== 1) throw new Error(`ask-aggregate 期望恰好 1 个输出对象，得到 ${arr.length} 个`);
  const entry = arr[0];
  if (!isObj(entry)) throw new Error("ask-aggregate 输出不是对象");
  const conclusion = str(entry.conclusion);
  if (!conclusion) throw new Error("ask-aggregate 缺少 conclusion");
  if (!Array.isArray(entry.keyPoints)) throw new Error("ask-aggregate 缺少 keyPoints 数组");
  const keyPoints: AskKeyPoint[] = entry.keyPoints.map((k, i) => {
    if (!isObj(k)) throw new Error(`keyPoints[${i}] 不是对象`);
    const point = str(k.point);
    if (!point) throw new Error(`keyPoints[${i}] 缺少 point`);
    const sourceIds = strArr(k.sourceIds) ?? [];
    if (sourceIds.length === 0) throw new Error(`keyPoints[${i}]（${point.slice(0, 20)}…）缺来源 sourceIds`);
    for (const sid of sourceIds) {
      if (!expectedIds.has(sid)) throw new Error(`keyPoints[${i}] sourceId 非法: ${sid}`);
    }
    const form = k.form === "B" ? "B" : "A";
    if (form === "B" && (strArr(k.subjects) ?? []).length === 0) {
      throw new Error(`keyPoints[${i}] 为 B 类映射帖但缺 subjects（主客体标注）`);
    }
    const layers = (Array.isArray(k.infoLayers) ? k.infoLayers : []).filter((l): l is (typeof INFO_LAYERS)[number] =>
      (INFO_LAYERS as readonly string[]).includes(l as string),
    );
    return {
      point,
      sourceIds,
      mergedFrom: str(k.mergedFrom),
      form,
      subjects: strArr(k.subjects),
      infoLayers: layers.length > 0 ? layers : ["事件"],
      infoIncomplete: k.infoIncomplete === true,
    };
  });
  const relatedStocks = (Array.isArray(entry.relatedStocks) ? entry.relatedStocks : [])
    .filter((s) => isObj(s) && str((s as Record<string, unknown>).name))
    .map((s) => {
      const o = s as Record<string, unknown>;
      return { name: str(o.name)!, reason: str(o.reason) ?? "" };
    });
  const timeline = (Array.isArray(entry.timeline) ? entry.timeline : [])
    .filter((t) => isObj(t) && str((t as Record<string, unknown>).time))
    .map((t) => {
      const o = t as Record<string, unknown>;
      return { time: str(o.time)!, text: str(o.text) ?? "" };
    });
  const rejected = (Array.isArray(entry.rejected) ? entry.rejected : [])
    .filter((r) => isObj(r) && str((r as Record<string, unknown>).id))
    .map((r) => {
      const o = r as Record<string, unknown>;
      return { id: str(o.id)!, reason: str(o.reason) ?? "" };
    });
  for (const r of rejected) {
    if (!expectedIds.has(r.id)) throw new Error(`rejected id 非法: ${r.id}`);
  }
  const detailIds = strArr(entry.detailIds)?.filter((id) => expectedIds.has(id));
  return {
    keyPoints,
    relatedStocks,
    timeline,
    conclusion,
    gaps: strArr(entry.gaps) ?? [],
    rejected,
    detailIds,
  };
}
