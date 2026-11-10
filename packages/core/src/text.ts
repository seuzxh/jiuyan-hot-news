/** 文本工具：标题归一化与 2-gram Jaccard 相似度 */

/** 归一化：仅保留中英文与数字，小写（去空白/标点/emoji） */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, "")
    .trim();
}

/** 字符 2-gram 集合（长度 <2 时退化为单字集合） */
export function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  if (s.length <= 2) {
    set.add(s);
    return set;
  }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/** Jaccard 相似度（2-gram） */
export function jaccard(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}
