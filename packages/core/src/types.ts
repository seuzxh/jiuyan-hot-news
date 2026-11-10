/** 领域类型：信源条目与管线状态 */

/** 作者分级（借鉴 AIHOT 的 T1/T1_5/T2，UGC 社区无官方一手，从 T1_5 起步） */
export type AuthorTier = "T1_5" | "T2";

export interface ItemMetrics {
  /** 转发 */
  forward: number;
  /** 评论 */
  reply: number;
  /** 点赞 */
  like: number;
}

/** 信源适配器产出的归一化条目（入库前） */
export interface RawItem {
  sourceId: string;
  extId: string;
  url: string;
  title: string;
  excerpt: string;
  authorName: string;
  authorUrl?: string;
  authorBadge?: string;
  authorTier: AuthorTier;
  /** ISO8601 UTC */
  publishedAt: string;
  stocks: string[];
  metrics: ItemMetrics;
  /** 出现的板块（如 square_publish） */
  boards: string[];
}

export type ItemStatus =
  | "new" // 已采集未处理
  | "candidate" // 预筛通过，待打分
  | "selected" // 过门槛，已入选
  | "rejected" // 打分未过门槛
  | "archived_old" // 首见超 48h 的旧文，只归档
  | "blocked"; // 预筛拦截（广告/低信息/近似重复）
