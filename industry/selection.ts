/**
 * 选题标准与门槛（know-how 外置：调整"什么算重要"改这里，不改代码）。
 * 理念（借鉴 AIHOT）：预筛宽进严拦（只拦明确噪声）；质量判断交给打分阶段。
 */
import type { HeatConfig, PrefilterConfig, Thresholds } from "@jyc/core";

/** 分级入选门槛：双次打分均分须 ≥ 门槛（机构/游资/达人 65，普通用户 76，偏严） */
export const THRESHOLDS: Thresholds = {
  T1_5: 65,
  T2: 76,
};

export const PREFILTER: PrefilterConfig = {
  oldItemHours: 48,
  nearDupWindowHours: 14 * 24,
  nearDupJaccard: 0.72,
  sameAuthorExempt: true,
  blockKeywords: [
    "配资",
    "加群",
    "进群",
    "入群",
    "客服",
    "薇信",
    "威信",
    "私信我",
    "私聊我",
    "收费",
    "荐股服",
    "带单",
    "内部群",
    "直播间福利",
    "开户返",
    "指导老师",
    "实盘大赛报名",
  ],
  maxCandidatesPerRun: 80,
};

/** 热度计算（按事件不按帖） */
export const HEAT: HeatConfig = {
  uniqueWindowHours: 48,
  decayHours: 24,
  weights: { like: 1, reply: 4, forward: 3 },
};

/**
 * 打分内容偏好（用于 industry/prompts/score.md；调整优先级改提示词）：
 * 高分项：题材/产业链事件、个股深度逻辑、市场情绪与复盘；
 * 低权重：政策与宏观（除非直接改变板块预期）。
 */
export const SCORE_PREFERENCE = {
  high: [
    "题材/产业链事件（新题材发酵、产业链催化、事件驱动）",
    "个股深度逻辑（基本面变化、业绩、订单、股权变动）",
    "市场情绪与复盘（连板梯队、情绪周期、资金流向）",
  ],
  low: ["政策与宏观（默认低权重，除非直接改变板块预期）"],
};
