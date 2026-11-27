import type { ConceptView } from "./queries";

/**
 * 纯函数模块：首页组件（浏览器）与日报 loader（服务端）共用。
 * 这里不能 import lib/queries 的运行时导出，也不能 import @jyc/core——两者都带 node:sqlite，
 * 被客户端组件引用会把它们拉进浏览器包，构建直接失败。
 */

/** 概念按展示分类分区，分区顺序跟随概念顺序（首个出现的概念所属分类在前） */
export function groupConcepts(concepts: ConceptView[]): Array<{ id: string; label: string; emoji: string; concepts: ConceptView[] }> {
  const buckets = new Map<string, { id: string; label: string; emoji: string; concepts: ConceptView[] }>();
  for (const c of concepts) {
    let b = buckets.get(c.categoryId);
    if (!b) {
      b = { id: c.categoryId, label: c.categoryLabel, emoji: c.emoji, concepts: [] };
      buckets.set(c.categoryId, b);
    }
    b.concepts.push(c);
  }
  return [...buckets.values()];
}
