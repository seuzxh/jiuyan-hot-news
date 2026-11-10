/** 管线配置类型（具体值在 industry/selection.ts，属 know-how 外置） */

export interface PrefilterConfig {
  /** 首见超此时长的旧文只归档（旧文不刷屏） */
  oldItemHours: number;
  /** 近似去重回看窗口（小时） */
  nearDupWindowHours: number;
  /** 标题 2-gram Jaccard 阈值，≥ 视为近似重复 */
  nearDupJaccard: number;
  /** 同作者系列帖（如"盘前纪要"日更）豁免去重，交给聚簇阶段 */
  sameAuthorExempt: boolean;
  /** 拦截关键词（标题或摘要命中即拦） */
  blockKeywords: string[];
  /** 每轮送入打分的候选上限 */
  maxCandidatesPerRun: number;
}

export interface HeatConfig {
  /** 每帖在窗口内只计一次的窗口（小时） */
  uniqueWindowHours: number;
  /** 超过此时长的帖子互动数减半 */
  decayHours: number;
  /** 各互动行为权重 */
  weights: { readonly like: number; readonly reply: number; readonly forward: number };
}

/** 分级门槛：双次打分均分须 ≥ 门槛 */
export type Thresholds = Record<"T1_5" | "T2", number>;
