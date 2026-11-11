/** LLM 阶段的任务/结果契约（API 模式与 agent-handoff 模式共用） */

export type LlmStage = "score" | "cluster" | "write" | "theme" | "ask-intent" | "ask-aggregate";

// ---------- score ----------

export interface ScoreItemInput {
  id: string;
  title: string;
  excerpt: string;
  stocks: string[];
  authorBadge: string | null;
  authorTier: string;
  publishedAt: string;
  like: number;
  reply: number;
  forward: number;
  boards: string[];
}

/** 单轮打分输出（API 模式每轮一组；handoff 模式合并为双分） */
export interface ScorePassOutput {
  id: string;
  score: number;
  industry: string;
  concepts: string[];
  driver: string;
}

/** 双次打分合并输出 */
export interface ScoreDualOutput {
  id: string;
  score1: number;
  score2: number;
  industry: string;
  concepts: string[];
  driver: string;
}

// ---------- cluster ----------

export interface ClusterGroupInput {
  groupId: string;
  members: Array<{ id: string; title: string; stocks: string[]; driver: string; publishedAt: string }>;
}

export interface ClusterGroupOutput {
  groupId: string;
  sameEvent: boolean;
  reason?: string;
}

// ---------- write ----------

export interface WriteEventInput {
  eventId: string;
  representative: { title: string; excerpt: string; authorName: string; stocks: string[] };
  members: Array<{ title: string; excerpt: string }>;
}

export interface WriteEventOutput {
  eventId: string;
  eventTitle: string;
  summary: string;
  reason: string;
}

// ---------- theme ----------

export interface ThemeTaskInput {
  themeId: string;
  label: string;
  events: Array<{ title: string; summary: string; heat: number; stocks: string[] }>;
}

export interface ThemeOutput {
  themeId: string;
  logic: string;
}

// ---------- ask-intent（关键词问股·段①） ----------

export interface AskIntentInput {
  keyword: string;
  /** 窗口覆盖北京日期内 themes 的 {label, logic}（主线综述背景） */
  themesContext: Array<{ label: string; logic: string }>;
  /** taxonomy 命中类目的 conceptKeywords（概念词兜底扩展源） */
  taxonomyHints: string[];
}

export interface AskIntentOutput {
  keyword: string;
  kind: "个股" | "概念题材" | "模糊";
  /** 一句话意图理解（段④意图假设行） */
  intent: string;
  assumption: string;
  /** 身份词（全称/简称/代码/别名）/ 叙事词（独占产品叙事）分层 */
  expandedKeywords: { identity: string[]; narrative: string[] };
  /** 意图股票池，仅作路 A（stocks_json 精确召回）输入 */
  stocks: string[];
  /** 修正 chips：2-3 个备选意图 */
  altInterpretations?: Array<{ label: string; hint: string }>;
}

// ---------- ask-aggregate（关键词问股·段③，R1 摘要级 / R2 全文级同一 schema） ----------

export interface AskAggregateInput {
  id: string;
  title: string;
  /** R1 = 列表页摘要（~250 字）；R2 = 详情页全文 */
  text: string;
  stocks: string[];
  url: string;
  publishedAt: string;
  status: string;
  scoreAvg: number | null;
  /** 所属事件标题（路 C 回链时附） */
  eventTitle?: string;
}

export interface AskKeyPoint {
  point: string;
  /** 来源 items.id（段间统一主键口径） */
  sourceIds: string[];
  /** 事件/话术去重说明（哪些帖合并、依据） */
  mergedFrom?: string;
  /** A=主标的直接资讯；B=以主标的为锚的映射/对标帖 */
  form: "A" | "B";
  /** B 类必填：帖主推标的（主客体标注） */
  subjects?: string[];
  /** 信息分层：无出处数字不得进 timeline */
  infoLayers: Array<"事件" | "研报观点" | "UGC推测">;
  /** excerpt 截断丢关键信息 → 进深挖名单 */
  infoIncomplete?: boolean;
}

export interface AskAggregateOutput {
  keyPoints: AskKeyPoint[];
  relatedStocks: Array<{ name: string; reason: string }>;
  /** time = 北京时间展示串 */
  timeline: Array<{ time: string; text: string }>;
  /** ≤120 字，结论→驱动与边际变化→参与提示 */
  conclusion: string;
  gaps: string[];
  rejected: Array<{ id: string; reason: string }>;
  /** 仅 R1 产出：深挖名单（Top 3-5 的 items.id）；R2 不需要 */
  detailIds?: string[];
}

// ---------- 任务/结果文件 ----------

export interface LlmTask<TStage extends LlmStage, TInput> {
  version: 1;
  stage: TStage;
  batch: string;
  promptFile: string;
  prompt: string;
  input: TInput[];
  /** agent 应把结果写到该文件 */
  outputFile: string;
  agentInstructions: string;
  /** 阶段私有上下文（如 ask 任务携带 askId 供 consume 回填定位行） */
  meta?: Record<string, unknown>;
}

export interface LlmResult<TOutput> {
  version: 1;
  stage: LlmStage;
  batch: string;
  outputs: TOutput[];
}
