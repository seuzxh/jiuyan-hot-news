/** LLM 阶段的任务/结果契约（API 模式与 agent-handoff 模式共用） */

export type LlmStage = "score" | "cluster" | "write" | "theme";

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
}

export interface LlmResult<TOutput> {
  version: 1;
  stage: LlmStage;
  batch: string;
  outputs: TOutput[];
}
