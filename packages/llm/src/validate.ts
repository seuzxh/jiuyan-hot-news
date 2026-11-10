/** 各阶段结果校验：坏数据明确报错，好数据归一化 */
import type { ClusterGroupOutput, ScoreDualOutput, ScorePassOutput, WriteEventOutput } from "./types.js";

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
