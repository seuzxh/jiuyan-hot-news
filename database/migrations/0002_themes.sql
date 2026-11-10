-- 题材层：同题材事件归类 + 催化逻辑综述 + Top5 概念股（每次推送前由 theme 阶段重建当日记录）
CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,              -- '{dateKey}:{categoryId}'
  date_key TEXT NOT NULL,           -- 北京日期 YYYY-MM-DD
  category_id TEXT NOT NULL,
  category_label TEXT NOT NULL,
  emoji TEXT NOT NULL,
  logic TEXT,                       -- LLM 催化逻辑综述（NULL = 待写/单事件）
  top_stocks_json TEXT NOT NULL DEFAULT '[]',
  event_ids_json TEXT NOT NULL DEFAULT '[]',
  event_count INTEGER NOT NULL DEFAULT 0,
  heat_total REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_themes_date ON themes(date_key, heat_total);
