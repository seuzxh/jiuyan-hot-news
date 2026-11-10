/**
 * 预筛阶段（纯规则，不调 LLM）：宽进严拦。
 * 拦截顺序：关键词 → 旧文归档 → 跨作者近似重复；同作者系列帖豁免。
 */
import type { PrefilterConfig } from "../config.js";
import { hoursBetween } from "../time.js";
import { jaccard, normalizeTitle } from "../text.js";

export interface PrefilterItem {
  id: string;
  title: string;
  excerpt: string;
  authorName: string;
  /** ISO8601 */
  publishedAt: string;
  metrics: { like: number; reply: number; forward: number };
}

export type DecisionStatus = "candidate" | "blocked" | "archived_old";

export interface PrefilterDecision {
  id: string;
  status: DecisionStatus;
  reason?: string;
}

/** 互动参与度排序键（与 HEAT.weights 缺省一致：赞1/评4/转3） */
export function engagement(m: PrefilterItem["metrics"]): number {
  return m.like + m.reply * 4 + m.forward * 3;
}

/**
 * 对一批 new 条目做预筛判定。
 * @param items 本批待判条目（任意顺序，内部先按互动降序处理，保证重复中强者存活）
 * @param pool 近窗口内已处理条目（跨轮去重比对池）
 */
export function prefilterBatch(
  items: PrefilterItem[],
  pool: PrefilterItem[],
  cfg: PrefilterConfig,
  nowIso: string,
): PrefilterDecision[] {
  const windowStart = new Date(Date.parse(nowIso) - cfg.nearDupWindowHours * 3600_000).toISOString();
  const poolNorm = pool
    .filter((p) => p.publishedAt >= windowStart)
    .map((p) => ({ item: p, norm: normalizeTitle(p.title) }));

  const ordered = [...items].sort((a, b) => engagement(b.metrics) - engagement(a.metrics));
  const decisions: PrefilterDecision[] = [];
  const accepted: Array<{ item: PrefilterItem; norm: string }> = [];

  for (const it of ordered) {
    const norm = normalizeTitle(it.title);
    const hay = (it.title + it.excerpt).toLowerCase();

    // 1. 关键词拦截
    const kw = cfg.blockKeywords.find((k) => hay.includes(k));
    if (kw) {
      decisions.push({ id: it.id, status: "blocked", reason: `keyword:${kw}` });
      continue;
    }

    // 2. 旧文归档（首见距发布超阈值，只归档不进当天）
    if (hoursBetween(it.publishedAt, nowIso) > cfg.oldItemHours) {
      decisions.push({ id: it.id, status: "archived_old", reason: `older_than_${cfg.oldItemHours}h` });
      continue;
    }

    // 3. 近似重复：比对池 + 本批已接受项；同作者豁免
    const dupOf = (candidates: Array<{ item: PrefilterItem; norm: string }>): string | null => {
      for (const c of candidates) {
        if (cfg.sameAuthorExempt && c.item.authorName === it.authorName) continue;
        if (c.norm.length > 0 && jaccard(norm, c.norm) >= cfg.nearDupJaccard) return c.item.id;
      }
      return null;
    };
    const dupPool = dupOf(poolNorm);
    if (dupPool) {
      decisions.push({ id: it.id, status: "blocked", reason: `dup_of:${dupPool}` });
      continue;
    }
    const dupBatch = dupOf(accepted);
    if (dupBatch) {
      decisions.push({ id: it.id, status: "blocked", reason: `dup_of:${dupBatch}` });
      continue;
    }

    accepted.push({ item: it, norm });
    decisions.push({ id: it.id, status: "candidate" });
  }

  // 4. 候选上限：溢出的保持 new（下轮再评）
  const kept = new Set(
    decisions
      .filter((d) => d.status === "candidate")
      .slice(0, cfg.maxCandidatesPerRun)
      .map((d) => d.id),
  );
  return decisions.filter((d) => d.status !== "candidate" || kept.has(d.id));
}
