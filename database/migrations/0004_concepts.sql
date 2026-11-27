-- 概念层：把窗口内事件按"产业逻辑链"归成概念，每个概念一张逻辑卡
-- （结论 + 因果链 + 标的角色 + 风险）。LLM 负责归类与写作，帖数/热度由代码计算；每次推送前重建当日记录。
CREATE TABLE IF NOT EXISTS concepts (
  id TEXT PRIMARY KEY,              -- '{dateKey}:c{nn}'
  date_key TEXT NOT NULL,           -- 北京日期 YYYY-MM-DD
  rank INTEGER NOT NULL DEFAULT 0,  -- 展示顺序（非盘面类在前，帖数多者在前）
  title TEXT NOT NULL,              -- 概念名
  category_id TEXT NOT NULL,
  category_label TEXT NOT NULL,
  emoji TEXT NOT NULL,
  takeaway TEXT NOT NULL,           -- 一句话结论
  chain_json TEXT NOT NULL,         -- 因果链 [环节, …]
  stocks_json TEXT NOT NULL,        -- [{name, role}] 标的及其在链条中的环节
  risk TEXT,                        -- 分歧/风险（NULL 或空串 = 无）
  event_ids_json TEXT NOT NULL,     -- 支撑该概念的帖子（汇总帖可同时属于多个概念）
  event_count INTEGER NOT NULL DEFAULT 0,
  heat_total REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_concepts_date ON concepts(date_key, rank);
